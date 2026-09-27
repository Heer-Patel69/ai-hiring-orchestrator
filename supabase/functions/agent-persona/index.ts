// =============================================
// AGENT 4: PERSONA — Behavioral Assessment
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
    const { application_id, action, response_text, question_index } = await req.json();

    if (!application_id) {
      throw new Error("application_id is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch application with job and candidate
    const { data: application } = await supabase
      .from("applications")
      .select(`
        *,
        job:jobs!applications_job_id_fkey(*),
        candidate:candidate_profiles!applications_candidate_id_fkey(
          *,
          profile:profiles!candidate_profiles_user_id_fkey(*)
        )
      `)
      .eq("id", application_id)
      .single();

    if (!application) {
      throw new Error("Application not found");
    }

    const job = application.job;
    const candidate = application.candidate;
    const roundConfig = job.round_config?.behavioral || {
      num_questions: 10,
      passing_score: 50,
    };

    // Handle different actions
    if (action === "generate_questions") {
      const questions = await generateBehavioralQuestions(
        job,
        candidate,
        roundConfig.num_questions
      );

      return new Response(
        JSON.stringify({ success: true, questions }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "evaluate_response") {
      // Evaluate a single response
      const { data: existingResponses } = await supabase
        .from("behavioral_responses")
        .select("*")
        .eq("application_id", application_id);

      const question = existingResponses?.[question_index]?.question;
      
      const evaluation = await evaluateResponse(
        question,
        response_text,
        job,
        candidate
      );

      // Store response
      await supabase.from("behavioral_responses").insert({
        application_id,
        question: question || `Question ${question_index + 1}`,
        response_text,
        ai_evaluation: evaluation,
        scores: evaluation.scores,
      });

      return new Response(
        JSON.stringify({ success: true, evaluation }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "generate_followup") {
      const followUp = await generateFollowUp(
        response_text,
        job
      );

      return new Response(
        JSON.stringify({ success: true, followUp }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "finalize") {
      // Final evaluation
      const { data: allResponses } = await supabase
        .from("behavioral_responses")
        .select("*")
        .eq("application_id", application_id);

      if (!allResponses || allResponses.length === 0) {
        throw new Error("No behavioral responses found");
      }

      // Calculate aggregate scores
      const aggregateScores = {
        communication_clarity: 0,
        depth_of_response: 0,
        self_awareness: 0,
        teamwork: 0,
        problem_solving: 0,
        cultural_fit: 0,
        emotional_intelligence: 0,
        confidence: 0,
      };

      for (const response of allResponses) {
        const scores = response.scores || {};
        for (const [key, value] of Object.entries(scores)) {
          if (key in aggregateScores) {
            aggregateScores[key as keyof typeof aggregateScores] += (value as number) / allResponses.length;
          }
        }
      }

      // Round scores
      for (const key of Object.keys(aggregateScores)) {
        aggregateScores[key as keyof typeof aggregateScores] = Math.round(
          aggregateScores[key as keyof typeof aggregateScores]
        );
      }

      // Calculate overall score
      const overallScore = Math.round(
        Object.values(aggregateScores).reduce((a, b) => a + b, 0) / Object.keys(aggregateScores).length
      );

      const decision: "pass" | "reject" = overallScore >= roundConfig.passing_score ? "pass" : "reject";

      const strengths = Object.entries(aggregateScores)
        .filter(([_, score]) => score >= 70)
        .map(([key]) => formatScoreName(key));

      const weaknesses = Object.entries(aggregateScores)
        .filter(([_, score]) => score < 50)
        .map(([key]) => formatScoreName(key));

      const reasoning = decision === "pass"
        ? `Behavioral assessment passed with ${overallScore}% overall. Strengths: ${strengths.join(", ") || "Balanced profile"}. ${allResponses.length} questions answered.`
        : `Behavioral score ${overallScore}% below threshold. Areas needing improvement: ${weaknesses.join(", ") || "Overall engagement"}.`;

      // Store agent result
      const agentResult = {
        application_id,
        agent_number: 4,
        agent_name: "Persona",
        score: overallScore,
        detailed_scores: aggregateScores,
        decision,
        reasoning,
        raw_data: {
          questions_asked: allResponses.length,
          evaluation: aggregateScores,
          transcript: allResponses.map((r: any) => ({
            question: r.question,
            response: r.response_text,
            scores: r.scores,
          })),
        },
      };

      await supabase.from("agent_results").insert(agentResult);

      // Update application status
      if (decision === "pass") {
        await supabase
          .from("applications")
          .update({
            status: "interview",
            current_agent: 5,
            agent_started_at: new Date().toISOString(),
          })
          .eq("id", application_id);
      } else {
        await supabase
          .from("applications")
          .update({ status: "rejected" })
          .eq("id", application_id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          result: agentResult,
          next_agent: decision === "pass" ? 5 : null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Invalid action");
  } catch (error) {
    console.error("Persona agent error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function formatScoreName(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

async function generateBehavioralQuestions(
  job: any,
  candidate: any,
  numQuestions: number
) {
  const experienceLevel = job.experience_level || "mid";
  const field = job.field || "software development";

  const prompt = `Generate ${numQuestions} behavioral interview questions for a ${field} ${experienceLevel}-level position.

JOB TITLE: ${job.title}
CANDIDATE EXPERIENCE: ${candidate?.experience_years || 0} years

Generate a mix of:
- STAR method questions (Situation, Task, Action, Result)
- Scenario-based questions
- Ethical dilemma questions
- Leadership/teamwork questions
- Conflict resolution questions

For each question, provide:
{
  "question": "The behavioral question",
  "type": "star" | "scenario" | "ethical" | "leadership" | "conflict",
  "follow_ups": ["potential follow-up question 1", "follow-up 2"],
  "evaluation_criteria": ["what to look for in the answer"]
}

Make questions appropriate for the experience level:
- Fresher: Focus on academic projects, internships, potential
- Mid: Balance of past experience and growth
- Senior: Leadership, mentoring, strategic thinking

Return a JSON array.`;

  try {
    const content = await llmProvider.chat(
      [
        {
          role: "system",
          content: "You are an expert behavioral interviewer. Generate thoughtful, probing questions. Respond with valid JSON array.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.7 }
    );

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse questions:", e);
  }

  // Default questions
  return [
    { question: "Tell me about a challenging project you worked on.", type: "star", follow_ups: ["What was your specific role?"] },
    { question: "How do you handle disagreements with teammates?", type: "conflict", follow_ups: ["Give me a specific example."] },
    { question: "Describe a time you had to learn something new quickly.", type: "star", follow_ups: ["What was the outcome?"] },
  ];
}

async function evaluateResponse(
  question: string,
  response: string,
  job: any,
  candidate: any
) {
  const prompt = `Evaluate this behavioral interview response.

QUESTION: ${question}

CANDIDATE'S RESPONSE:
${response}

Evaluate on these criteria (0-100 each):
1. communication_clarity: Is the answer clear and well-structured?
2. depth_of_response: Does it have specific examples vs vague generalities?
3. self_awareness: Does candidate acknowledge learnings and growth areas?
4. teamwork: Does candidate show collaboration or just individual focus?
5. problem_solving: Is there structured thinking in approach?
6. cultural_fit: Does the response align with professional values?
7. emotional_intelligence: Shows empathy, maturity, handling pressure?
8. confidence: Based on language used and conviction

Provide JSON:
{
  "scores": {
    "communication_clarity": 0-100,
    "depth_of_response": 0-100,
    "self_awareness": 0-100,
    "teamwork": 0-100,
    "problem_solving": 0-100,
    "cultural_fit": 0-100,
    "emotional_intelligence": 0-100,
    "confidence": 0-100
  },
  "feedback": "Brief constructive feedback",
  "strengths": ["strength 1", "strength 2"],
  "areas_for_improvement": ["area 1", "area 2"]
}`;

  try {
    const content = await llmProvider.chat(
      [
        {
          role: "system",
          content: "You are an expert behavioral interviewer. Evaluate responses fairly and constructively. Respond with valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.3 }
    );

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse evaluation:", e);
  }

  // Default evaluation
  return {
    scores: {
      communication_clarity: 60,
      depth_of_response: 60,
      self_awareness: 60,
      teamwork: 60,
      problem_solving: 60,
      cultural_fit: 60,
      emotional_intelligence: 60,
      confidence: 60,
    },
    feedback: "Response evaluated.",
    strengths: [],
    areas_for_improvement: [],
  };
}

async function generateFollowUp(response: string, job: any) {
  const prompt = `Based on this interview response, generate a natural follow-up question to dig deeper.

RESPONSE: ${response}

Generate a conversational follow-up that:
- Probes for more specifics if the answer was vague
- Explores the impact or outcome if not mentioned
- Asks about learnings or what they'd do differently

Respond with just the follow-up question, nothing else.`;

  try {
    const content = await llmProvider.chat(
      [
        { role: "system", content: "You are a conversational interviewer. Be warm but probing." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.7 }
    );

    return content || "Can you tell me more about that?";
  } catch (e) {
    console.error("Failed to generate follow-up:", e);
    return "Can you tell me more about that?";
  }
}
