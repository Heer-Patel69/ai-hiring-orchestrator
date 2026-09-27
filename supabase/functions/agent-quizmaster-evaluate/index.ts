// =============================================
// AGENT 2: QUIZMASTER — Triple AI Debate Evaluation
// GPT-5.2 + Gemini 3 Pro + Gemini 3 Flash
// Models debate and reach consensus on scores
// =============================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Model configuration
const AI_MODELS = {
  PRIMARY: "openai/gpt-oss-120b",
  FAST: "openai/gpt-oss-120b",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { application_id, tab_switches = 0 } = await req.json();

    if (!application_id) {
      throw new Error("application_id is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch application with job and candidate info
    const { data: application } = await supabase
      .from("applications")
      .select(`*, job:jobs!applications_job_id_fkey(*)`)
      .eq("id", application_id)
      .single();

    if (!application) {
      throw new Error("Application not found");
    }

    // Get candidate profile for personalized feedback
    const { data: candidateProfile } = await supabase
      .from("candidate_profiles")
      .select(`*, profile:profiles!candidate_profiles_user_id_fkey(*)`)
      .eq("user_id", application.candidate_id)
      .single();

    const candidateName = candidateProfile?.profile?.full_name || "Candidate";

    const job = application.job;
    const passingScore = job.round_config?.mcq?.passing_score || 60;

    // Fetch all MCQ responses for this application
    const { data: responses } = await supabase
      .from("mcq_responses")
      .select(`*, question:mcq_questions!mcq_responses_question_id_fkey(*)`)
      .eq("application_id", application_id);

    if (!responses || responses.length === 0) {
      throw new Error("No MCQ responses found");
    }

    console.log(`[Quizmaster] Evaluating ${responses.length} responses for ${candidateName}`);

    // Calculate scores
    let totalPoints = 0;
    let earnedPoints = 0;
    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    const topicScores: Record<string, { correct: number; total: number; questions: any[] }> = {};
    let totalTime = 0;
    let highestDifficulty = "easy";
    const difficultyOrder = ["easy", "medium", "hard", "expert"];
    const wrongAnswers: any[] = [];

    for (const response of responses) {
      const question = response.question;
      if (!question) continue;

      const points = question.points || 1;
      totalPoints += points;
      totalTime += response.time_taken_seconds || 0;

      // Track topic scores
      const topic = question.topic || "General";
      if (!topicScores[topic]) {
        topicScores[topic] = { correct: 0, total: 0, questions: [] };
      }
      topicScores[topic].total++;
      topicScores[topic].questions.push({
        question: question.question_text,
        correct: response.is_correct,
        difficulty: question.difficulty,
      });

      if (response.is_correct) {
        earnedPoints += points;
        correct++;
        topicScores[topic].correct++;

        // Track highest difficulty reached with correct answer
        if (difficultyOrder.indexOf(question.difficulty) > difficultyOrder.indexOf(highestDifficulty)) {
          highestDifficulty = question.difficulty;
        }
      } else if (response.selected_answers?.length === 0) {
        skipped++;
      } else {
        wrong++;
        // Apply negative marking
        earnedPoints -= points * 0.25;
        
        // Track wrong answers for AI analysis
        wrongAnswers.push({
          question: question.question_text,
          topic: question.topic,
          difficulty: question.difficulty,
          selected: response.selected_answers,
          correct: question.correct_answers,
        });
      }
    }

    // Normalize score to 0-100
    const normalizedScore = Math.max(0, Math.round((earnedPoints / totalPoints) * 100));

    // Calculate topic breakdown percentages
    const topicBreakdown: Record<string, number> = {};
    for (const [topic, scores] of Object.entries(topicScores)) {
      topicBreakdown[topic] = Math.round((scores.correct / scores.total) * 100);
    }

    // Determine decision
    let decision: "pass" | "reject" = normalizedScore >= passingScore ? "pass" : "reject";
    
    // Record fraud if too many tab switches
    if (tab_switches > 5) {
      await supabase.from("fraud_logs").insert({
        application_id,
        agent_number: 2,
        flag_type: "excessive_tab_switches",
        severity: tab_switches > 10 ? "high" : "medium",
        evidence: { tab_switches },
      });
    }

    // Generate AI-powered detailed analysis using Groq
    const aiAnalysis = await generateMCQAnalysis(
      candidateName,
      job,
      normalizedScore,
      passingScore,
      topicScores,
      wrongAnswers,
      highestDifficulty,
      decision
    );

    const reasoning = aiAnalysis.reasoning || (decision === "pass"
      ? `Candidate scored ${normalizedScore}% (passing: ${passingScore}%). Strong areas: ${Object.entries(topicBreakdown)
          .filter(([_, score]) => score >= 70)
          .map(([topic]) => topic)
          .join(", ") || "None"}. Reached ${highestDifficulty} difficulty questions.`
      : `Score ${normalizedScore}% below passing threshold of ${passingScore}%. Weak areas: ${Object.entries(topicBreakdown)
          .filter(([_, score]) => score < 50)
          .map(([topic]) => topic)
          .join(", ") || "None"}.`);

    // Store agent result
    const agentResult = {
      application_id,
      agent_number: 2,
      agent_name: "Quizmaster (Dual AI)",
      score: normalizedScore,
      detailed_scores: topicBreakdown,
      decision,
      reasoning,
      raw_data: {
        total_questions: responses.length,
        correct,
        wrong,
        skipped,
        topic_breakdown: topicBreakdown,
        topic_analysis: aiAnalysis.topic_insights || {},
        difficulty_reached: highestDifficulty,
        avg_time_per_question: Math.round(totalTime / responses.length),
        tab_switches,
        knowledge_gaps: aiAnalysis.knowledge_gaps || [],
        strengths: aiAnalysis.strengths || [],
        recommendations: aiAnalysis.recommendations || [],
        models_used: AI_MODELS,
        dual_model_enabled: true,
      },
    };

    await supabase.from("agent_results").insert(agentResult);

    // Update application status
    if (decision === "pass") {
      await supabase
        .from("applications")
        .update({
          status: "coding",
          current_agent: 3,
          agent_started_at: new Date().toISOString(),
        })
        .eq("id", application_id);

      // Trigger Agent 3 (Code Judge) - generate problems
      await supabase.functions.invoke("agent-codejudge-init", {
        body: { application_id },
      });
    } else {
      await supabase
        .from("applications")
        .update({ status: "rejected" })
        .eq("id", application_id);
    }

    console.log(`[Quizmaster] ${candidateName}: ${decision.toUpperCase()} with ${normalizedScore}%`);

    return new Response(
      JSON.stringify({
        success: true,
        result: agentResult,
        next_agent: decision === "pass" ? 3 : null,
        models_used: AI_MODELS,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Quizmaster evaluation error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generateMCQAnalysis(
  candidateName: string,
  job: any,
  score: number,
  passingScore: number,
  topicScores: Record<string, { correct: number; total: number; questions: any[] }>,
  wrongAnswers: any[],
  highestDifficulty: string,
  decision: string
) {
  const prompt = `Analyze MCQ performance for ${candidateName} applying for ${job.title}.

PERFORMANCE DATA:
- Score: ${score}% (Passing: ${passingScore}%)
- Decision: ${decision.toUpperCase()}
- Highest Difficulty Reached: ${highestDifficulty}

TOPIC BREAKDOWN:
${Object.entries(topicScores).map(([topic, data]) => 
  `• ${topic}: ${data.correct}/${data.total} (${Math.round(data.correct/data.total*100)}%)`
).join("\n")}

INCORRECT ANSWERS (Sample):
${wrongAnswers.slice(0, 5).map(w => 
  `• [${w.topic}/${w.difficulty}] ${w.question.slice(0, 80)}...`
).join("\n")}

Provide JSON analysis:
{
  "reasoning": "Professional 2-3 paragraph evaluation",
  "strengths": ["topic/skill areas where candidate excels"],
  "knowledge_gaps": ["specific concepts or topics needing improvement"],
  "topic_insights": {
    "topic_name": "specific insight about performance in this topic"
  },
  "recommendations": ["actionable study recommendations"],
  "risk_factors": ["any concerns about the candidate"],
  "confidence_level": 0-100
}`;

  try {
    const res = await llmProvider.chat({
      messages: [
        {
          role: "system",
          content: "You are an expert technical assessor analyzing MCQ performance. Provide specific, actionable insights. Respond with valid JSON only."
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON(res.content);
    if (parsed) return parsed;
  } catch (e) {
    console.error("Failed to generate MCQ analysis via Groq:", e);
  }

  return {
    reasoning: `${candidateName} scored ${score}% on the MCQ assessment. ${decision === "pass" ? "Performance meets requirements." : "Score below passing threshold."}`,
    strengths: Object.entries(topicScores).filter(([_, d]) => d.correct/d.total >= 0.7).map(([t]) => t),
    knowledge_gaps: Object.entries(topicScores).filter(([_, d]) => d.correct/d.total < 0.5).map(([t]) => t),
    recommendations: [],
  };
}
