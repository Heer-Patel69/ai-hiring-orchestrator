// =============================================
// AGENT 2: QUIZMASTER — MCQ Generation & Initialization
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
    const { application_id } = await req.json();

    if (!application_id) {
      throw new Error("application_id is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch application with job data
    const { data: application, error: appError } = await supabase
      .from("applications")
      .select(`
        *,
        job:jobs!applications_job_id_fkey(*)
      `)
      .eq("id", application_id)
      .single();

    if (appError || !application) {
      throw new Error(`Application not found: ${appError?.message}`);
    }

    const job = application.job;
    const roundConfig = job.round_config?.mcq || {
      num_questions: 25,
      passing_score: 60,
      time_limit_minutes: 45,
    };

    // Check if questions already exist for this job
    const { data: existingQuestions } = await supabase
      .from("mcq_questions")
      .select("id")
      .eq("job_id", job.id)
      .limit(1);

    if (existingQuestions && existingQuestions.length > 0) {
      // Questions already generated
      return new Response(
        JSON.stringify({
          success: true,
          message: "Questions already generated for this job",
          questions_count: existingQuestions.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate MCQ questions using AI
    const questions = await generateMCQQuestions(
      job,
      roundConfig.num_questions
    );

    // Store questions in database
    const questionsToInsert = questions.map((q: any) => ({
      job_id: job.id,
      question_text: q.question_text,
      question_type: q.question_type || "single",
      options: q.options,
      correct_answers: q.correct_answers,
      difficulty: q.difficulty,
      topic: q.topic,
      points: getDifficultyPoints(q.difficulty),
      time_limit_seconds: getDifficultyTimeLimit(q.difficulty),
      explanation: q.explanation,
    }));

    const { error: insertError } = await supabase
      .from("mcq_questions")
      .insert(questionsToInsert);

    if (insertError) {
      throw new Error(`Failed to store questions: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "MCQ questions generated successfully",
        questions_count: questions.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Quizmaster init error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getDifficultyPoints(difficulty: string): number {
  const points: Record<string, number> = {
    easy: 1,
    medium: 2,
    hard: 3,
    expert: 5,
  };
  return points[difficulty] || 1;
}

function getDifficultyTimeLimit(difficulty: string): number {
  const limits: Record<string, number> = {
    easy: 30,
    medium: 45,
    hard: 60,
    expert: 90,
  };
  return limits[difficulty] || 45;
}

async function generateMCQQuestions(
  job: any,
  numQuestions: number
) {
  const toughnessLevel = job.toughness_level || 3;
  const field = job.field || "software development";
  const skills = (job.skills_required || []).join(", ") || "programming, problem solving";

  const difficultyDistribution = getDifficultyDistribution(toughnessLevel, numQuestions);

  const prompt = `Generate ${numQuestions} MCQ questions for a ${field} job interview.

JOB TITLE: ${job.title}
REQUIRED SKILLS: ${skills}
TOUGHNESS LEVEL: ${toughnessLevel}/5

Generate questions with this distribution:
- Easy: ${difficultyDistribution.easy} questions
- Medium: ${difficultyDistribution.medium} questions
- Hard: ${difficultyDistribution.hard} questions
- Expert: ${difficultyDistribution.expert} questions

For each question, provide a JSON object with:
{
  "question_text": "The question",
  "question_type": "single" | "multiple" | "true_false",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correct_answers": [0], // Array of correct option indices (0-based)
  "difficulty": "easy" | "medium" | "hard" | "expert",
  "topic": "Topic category",
  "explanation": "Why this answer is correct"
}

Cover various topics relevant to ${field}:
- Core concepts and fundamentals
- Problem-solving scenarios
- Best practices
- Common pitfalls
- Real-world applications

Return a JSON array of question objects. Make questions challenging but fair.`;

  try {
    const res = await llmProvider.chat({
      messages: [
        {
          role: "system",
          content: "You are an expert technical interviewer. Generate high-quality MCQ questions. Always respond with valid JSON array.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    const parsed = llmProvider.parseJSON(res.content);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray((parsed as any).questions)) return (parsed as any).questions;
  } catch (e) {
    console.error("Failed to parse AI response:", e);
  }

  // Return default questions if parsing fails
  return generateDefaultQuestions(numQuestions);
}

function getDifficultyDistribution(toughness: number, total: number) {
  // Higher toughness = more hard/expert questions
  const distributions: Record<number, { easy: number; medium: number; hard: number; expert: number }> = {
    1: { easy: 0.5, medium: 0.3, hard: 0.15, expert: 0.05 },
    2: { easy: 0.35, medium: 0.4, hard: 0.2, expert: 0.05 },
    3: { easy: 0.2, medium: 0.4, hard: 0.3, expert: 0.1 },
    4: { easy: 0.1, medium: 0.3, hard: 0.4, expert: 0.2 },
    5: { easy: 0.05, medium: 0.2, hard: 0.45, expert: 0.3 },
  };

  const dist = distributions[toughness] || distributions[3];
  return {
    easy: Math.round(total * dist.easy),
    medium: Math.round(total * dist.medium),
    hard: Math.round(total * dist.hard),
    expert: Math.round(total * dist.expert),
  };
}

function generateDefaultQuestions(count: number) {
  // Fallback questions if AI fails
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push({
      question_text: `Sample question ${i + 1}: What is the correct approach?`,
      question_type: "single",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correct_answers: [0],
      difficulty: i < count / 4 ? "easy" : i < count / 2 ? "medium" : i < (count * 3) / 4 ? "hard" : "expert",
      topic: "General",
      explanation: "This is a sample question.",
    });
  }
  return questions;
}
