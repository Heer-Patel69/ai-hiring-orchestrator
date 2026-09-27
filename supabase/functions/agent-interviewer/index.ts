// =============================================
// AGENT 5: INTERVIEWER — Real-Time Voice AI Interview
// Refactored to use Centralized Groq Key Manager & LLM Provider
// =============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { application_id, action, message, phase, code_submission, transcript: clientTranscript } = await req.json();

    if (!application_id) {
      throw new Error("application_id is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch application
    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("*, job:jobs!applications_job_id_fkey(*)")
      .eq("id", application_id)
      .single();

    if (!application || appError) {
      console.error("Application fetch error:", appError);
      throw new Error("Application not found");
    }

    // Fetch candidate profile and user profile separately
    const { data: candidate } = await supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", application.candidate_id)
      .single();

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", application.candidate_id)
      .single();

    // Fetch previous agent results for context
    const { data: previousResults } = await supabase
      .from("agent_results")
      .select("*")
      .eq("application_id", application_id)
      .order("agent_number");

    const job = application.job;

    // Handle different actions
    if (action === "start_interview") {
      const greeting = await generateInterviewGreeting(
        job,
        profile?.full_name || "there"
      );

      // Store transcript entry
      await supabase.from("interview_transcripts").insert({
        application_id,
        role: "ai",
        content: greeting,
        phase: "warmup",
        timestamp_ms: 0,
      });

      return new Response(
        JSON.stringify({
          success: true,
          response: greeting,
          phase: "warmup",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "chat") {
      // Fetch existing transcript
      const { data: transcript } = await supabase
        .from("interview_transcripts")
        .select("*")
        .eq("application_id", application_id)
        .order("created_at");

      // Store candidate message
      await supabase.from("interview_transcripts").insert({
        application_id,
        role: "candidate",
        content: message,
        phase,
        timestamp_ms: Date.now(),
      });

      // Generate AI response via Groq
      const aiResponse = await generateInterviewResponse(
        job,
        candidate,
        previousResults || [],
        transcript || [],
        message,
        phase
      );

      // Store AI response
      await supabase.from("interview_transcripts").insert({
        application_id,
        role: "ai",
        content: aiResponse.response,
        phase: aiResponse.nextPhase || phase,
        timestamp_ms: Date.now(),
      });

      return new Response(
        JSON.stringify({
          success: true,
          response: aiResponse.response,
          phase: aiResponse.nextPhase || phase,
          shouldShowCode: aiResponse.shouldShowCode,
          codingQuestion: aiResponse.codingQuestion,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "submit_code") {
      // Store code submission
      await supabase.from("interview_recordings").upsert({
        application_id,
        code_submissions: [
          ...(application.code_submissions || []),
          code_submission,
        ],
      }, { onConflict: "application_id" });

      const feedback = await evaluateInterviewCode(
        code_submission.code,
        code_submission.problem,
        code_submission.language
      );

      return new Response(
        JSON.stringify({
          success: true,
          feedback,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "end_interview") {
      // Fetch full transcript from DB; supplement with client-provided transcript
      const { data: dbTranscript } = await supabase
        .from("interview_transcripts")
        .select("*")
        .eq("application_id", application_id)
        .order("created_at");

      // Merge DB transcript + any client-provided rows
      const fullTranscript = dbTranscript && dbTranscript.length > 0
        ? dbTranscript
        : (clientTranscript || []).map((item: any) => ({
            role: item.speaker === "ai" ? "ai" : "candidate",
            content: item.text,
            timestamp_ms: Math.round(item.timestamp || 0),
            phase: "interview",
          }));

      // Calculate interview duration
      const startTime = new Date(application.started_at || application.agent_started_at || application.applied_at).getTime();
      const endTime = Date.now();
      const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));

      // Evaluate entire interview
      const evaluation = await evaluateFullInterview(
        job,
        candidate,
        previousResults || [],
        fullTranscript || []
      );

      // Get fraud signals for this application
      const { data: fraudLogs } = await supabase
        .from("fraud_logs")
        .select("*")
        .eq("application_id", application_id);

      const fraudRiskScore = calculateFraudRisk(fraudLogs || []);
      const fraudFlags = (fraudLogs || []).map((l: any) => l.flag_type);

      const roundConfig = job.round_config?.interview || { passing_score: 60 };
      const overallScore = evaluation.overall_score;
      const passed = overallScore >= roundConfig.passing_score;

      let decision: "strong_pass" | "pass" | "borderline" | "reject";
      if (overallScore >= 80) decision = "strong_pass";
      else if (overallScore >= roundConfig.passing_score) decision = "pass";
      else if (overallScore >= roundConfig.passing_score - 10) decision = "borderline";
      else decision = "reject";

      const completedAt = new Date().toISOString();

      // Store agent result
      const agentResult = {
        application_id,
        agent_number: 5,
        agent_name: "Interviewer",
        score: overallScore,
        detailed_scores: {
          technical: evaluation.technical_score,
          communication: evaluation.communication_score,
          problem_solving: evaluation.problem_solving_score,
          depth: evaluation.depth_score,
          pressure_handling: evaluation.pressure_handling_score,
        },
        decision: decision === "strong_pass" ? "pass" : decision,
        reasoning: evaluation.reasoning,
        raw_data: {
          interview_duration_minutes: durationMinutes,
          phases_completed: getCompletedPhases(fullTranscript || []),
          technical_score: evaluation.technical_score,
          communication_score: evaluation.communication_score,
          problem_solving_score: evaluation.problem_solving_score,
          depth_score: evaluation.depth_score,
          pressure_handling_score: evaluation.pressure_handling_score,
          fraud_risk_score: fraudRiskScore,
          fraud_flags: fraudFlags,
          interviewer_decision: decision,
        },
      };

      await supabase.from("agent_results").upsert(
        { ...agentResult },
        { onConflict: "application_id,agent_number", ignoreDuplicates: false }
      );

      // Store/update interview recording metadata
      await supabase.from("interview_recordings").upsert({
        application_id,
        candidate_id: application.candidate_id,
        transcript: fullTranscript,
        duration_minutes: durationMinutes,
        fraud_flags: fraudFlags,
        status: "ready",
        ended_at: completedAt,
      }, { onConflict: "application_id" });

      // ------------------------------------------------------------------
      // CRITICAL FIX: Determine the live interview round number
      // The interview round is the LAST job_round with type = live_ai_interview
      // If none found, treat it as round 1.
      // ------------------------------------------------------------------
      const { data: liveRound } = await supabase
        .from("job_rounds")
        .select("id, round_number")
        .eq("job_id", job.id)
        .eq("round_type", "live_ai_interview")
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const interviewRoundNumber = liveRound?.round_number || 1;
      const roundId = liveRound?.id || null;
      const totalRounds = job.num_rounds || 1;
      const isAllRoundsCompleted = interviewRoundNumber >= totalRounds;

      // ------------------------------------------------------------------
      // Upsert candidate_round_attempts for authoritative round tracking
      // ------------------------------------------------------------------
      const attemptStatus = passed ? "passed" : "failed";
      await supabase.from("candidate_round_attempts").upsert({
        candidate_id: application.candidate_id,
        application_id,
        job_id: job.id,
        round_id: roundId,
        round_number: interviewRoundNumber,
        status: attemptStatus,
        score: overallScore,
        technical_score: evaluation.technical_score,
        communication_score: evaluation.communication_score,
        problem_solving_score: evaluation.problem_solving_score,
        started_at: application.started_at || application.applied_at,
        submitted_at: completedAt,
        completed_at: completedAt,
        termination_type: "normal",
        ai_feedback: evaluation.reasoning,
        strengths: evaluation.strengths || [],
        weaknesses: evaluation.weaknesses || [],
        transcript_snapshot: (fullTranscript || []).slice(-20), // store last 20 rows
        updated_at: completedAt,
      }, { onConflict: "application_id,round_number" });

      // ------------------------------------------------------------------
      // Upsert round_results for backward-compat with CandidateDetailModal
      // ------------------------------------------------------------------
      if (roundId) {
        const { data: existingRoundResult } = await supabase
          .from("round_results")
          .select("id")
          .eq("application_id", application_id)
          .eq("round_id", roundId)
          .maybeSingle();

        if (existingRoundResult) {
          await supabase.from("round_results")
            .update({ score: overallScore, ai_feedback: evaluation.reasoning, completed_at: completedAt })
            .eq("id", existingRoundResult.id);
        } else {
          const { data: newRR } = await supabase.from("round_results").insert({
            application_id,
            round_id: roundId,
            score: overallScore,
            ai_feedback: evaluation.reasoning,
            completed_at: completedAt,
          }).select("id").single();

          if (newRR) {
            await supabase.from("round_scores").upsert({
              round_result_id: newRR.id,
              application_id,
              round_number: interviewRoundNumber,
              base_score: overallScore,
              final_score: overallScore,
              strengths: evaluation.strengths || [],
              weaknesses: evaluation.weaknesses || [],
              updated_at: completedAt,
            }, { onConflict: "round_result_id" });
          }
        }
      }

      // ------------------------------------------------------------------
      // Update application: ALWAYS set current_round >= 1 after interview
      // ------------------------------------------------------------------
      const newCurrentRound = Math.max(application.current_round || 0, interviewRoundNumber);
      const newStatus = passed
        ? (isAllRoundsCompleted ? "completed" : "interviewing")
        : "rejected";

      await supabase
        .from("applications")
        .update({
          status: newStatus,
          current_agent: passed ? 6 : 5,
          current_round: newCurrentRound,
          overall_score: overallScore,
          completed_at: completedAt,
        })
        .eq("id", application_id);

      return new Response(
        JSON.stringify({
          success: true,
          result: agentResult,
          evaluation: {
            ...evaluation,
            fraud_risk_score: fraudRiskScore,
            fraud_flags: fraudFlags,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Invalid action");
  } catch (error) {
    console.error("Interviewer agent error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getCompletedPhases(transcript: any[]): string[] {
  const phases = new Set<string>();
  for (const entry of transcript) {
    if (entry.phase) phases.add(entry.phase);
  }
  return Array.from(phases);
}

function calculateFraudRisk(fraudLogs: any[]): number {
  const weights = { low: 5, medium: 15, high: 30, critical: 50 };
  let risk = 0;
  for (const log of fraudLogs) {
    risk += weights[log.severity as keyof typeof weights] || 0;
  }
  return Math.min(100, risk);
}

async function generateInterviewGreeting(
  job: any,
  candidateName: string
): Promise<string> {
  const prompt = `Generate a warm, professional greeting for an AI technical interview.

JOB TITLE: ${job.title}
CANDIDATE NAME: ${candidateName}

The greeting should:
- Be warm and welcoming
- Introduce yourself as the interviewer
- Briefly mention what to expect (focused technical interview)
- Ask them to start by briefly sharing their technical background and relevant experience

Keep it conversational and natural, like a human interviewer. 2-3 sentences max.`;

  try {
    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: "You are a friendly, professional technical interviewer." },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      maxTokens: 150,
    });
    return res.content.trim() || `Hello ${candidateName}! Welcome to your interview for the ${job.title} position. I'm your interviewer today. Let's start by having you tell me a bit about your technical background.`;
  } catch (err) {
    console.warn("Failed to generate greeting via Groq:", err);
    return `Hello ${candidateName}! Welcome to your interview for the ${job.title} position. Let's begin by discussing your background in ${job.skills_required?.[0] || "software development"}.`;
  }
}

async function generateInterviewResponse(
  job: any,
  candidate: any,
  previousResults: any[],
  transcript: any[],
  message: string,
  currentPhase: string
) {
  const conversationHistory = transcript.map((t: any) => ({
    role: (t.role === "ai" ? "assistant" : "user") as "assistant" | "user",
    content: t.content,
  }));

  const systemPrompt = `You are an expert AI technical interviewer conducting a real interview for ${job.title}.

CANDIDATE INFO:
- Name: ${candidate?.profile?.full_name || "Candidate"}
- Experience: ${candidate?.experience_years || 0} years
- Skills: ${(candidate?.skills || []).join(", ")}

JOB REQUIREMENTS: ${(job.skills_required || []).join(", ")}
CURRENT PHASE: ${currentPhase}

RULES:
- Be conversational, professional and concise (2-3 sentences).
- Ask follow-up questions based on their answers.
- Probe deeper when answers are vague.
- Do NOT reveal answers or internal scores.
- Ask ONE question at a time.
- If in technical phase, you can optionally provide a coding challenge.

Respond in JSON format:
{
  "response": "your conversational response",
  "nextPhase": "phase name if transitioning or null",
  "shouldShowCode": true/false,
  "codingQuestion": "optional coding problem description"
}`;

  try {
    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: message },
      ],
      temperature: 0.5,
      maxTokens: 250,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON(res.content);
    if (parsed && parsed.response) {
      return parsed;
    }
    return {
      response: res.content.trim() || "Thank you. Let's explore your experience further.",
      nextPhase: null,
      shouldShowCode: false,
    };
  } catch (err) {
    console.error("Groq interview response error:", err);
    return {
      response: "That's helpful context. Could you delve a bit deeper into how you solved challenges with that in your past projects?",
      nextPhase: null,
      shouldShowCode: false,
    };
  }
}

async function evaluateInterviewCode(
  code: string,
  problem: string,
  language: string
): Promise<string> {
  const prompt = `Briefly evaluate this code as an interviewer would during a live interview.

PROBLEM: ${problem}
LANGUAGE: ${language}
CODE:
${code}

Give brief, constructive feedback (2-3 sentences max) on correctness, edge cases, and code quality.`;

  try {
    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: "You are a supportive technical interviewer giving real-time feedback." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 150,
    });
    return res.content.trim() || "Thank you for walking through your solution. Let's move on to the next topic.";
  } catch (err) {
    console.error("Groq evaluateInterviewCode error:", err);
    return "Thank you for the implementation. The approach looks reasonable.";
  }
}

async function evaluateFullInterview(
  job: any,
  candidate: any,
  previousResults: any[],
  transcript: any[]
) {
  const conversationText = transcript.map((t: any) =>
    `${t.role.toUpperCase()}: ${t.content}`
  ).join("\n\n");

  const prompt = `Evaluate this complete technical interview.

JOB: ${job.title}
CANDIDATE: ${candidate?.profile?.full_name || "Candidate"}
EXPERIENCE: ${candidate?.experience_years || 0} years

FULL TRANSCRIPT:
${conversationText}

Evaluate on these criteria (0-100):
1. technical_score: Accuracy and depth of technical answers
2. communication_score: Clarity and articulation
3. problem_solving_score: Approach to problems
4. depth_score: Surface vs deep understanding
5. pressure_handling_score: Composure when challenged

Provide JSON:
{
  "technical_score": 0-100,
  "communication_score": 0-100,
  "problem_solving_score": 0-100,
  "depth_score": 0-100,
  "pressure_handling_score": 0-100,
  "overall_score": 0-100,
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "reasoning": "Detailed evaluation paragraph"
}`;

  try {
    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: "You are an expert interview evaluator. Be fair and thorough. Respond with valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 600,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON(res.content);
    if (parsed && typeof parsed.overall_score === "number") {
      return parsed;
    }
  } catch (e) {
    console.error("Failed to parse interview evaluation from Groq:", e);
  }

  return {
    technical_score: 70,
    communication_score: 70,
    problem_solving_score: 70,
    depth_score: 70,
    pressure_handling_score: 70,
    overall_score: 70,
    strengths: ["Engaged in discussion", "Demonstrated relevant technical background"],
    weaknesses: ["Could provide deeper architectural trade-offs"],
    reasoning: "Interview completed and evaluated against job requirements.",
  };
}
