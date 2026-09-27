import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateRequest {
  applicationId?: string;
  field?: string;
  jobDescription?: string;
  requiredSkills?: string[];
  toughnessLevel?: number | string;
  numQuestions?: number;
}

interface RawMCQ {
  question: string;
  options: string[];
  correctAnswer: string;
  skill?: string;
  difficulty?: string;
  explanation?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as GenerateRequest;
    const {
      field = "Software Engineering",
      jobDescription,
      requiredSkills = [],
      toughnessLevel = 3,
      numQuestions = 5,
    } = body;

    const difficultyMap: Record<string, string> = {
      "1": "easy",
      "2": "easy to medium",
      "3": "medium",
      "4": "medium to hard",
      "5": "hard to expert",
      easy: "easy",
      medium: "medium",
      hard: "hard",
      expert: "expert",
    };

    const diffString = difficultyMap[String(toughnessLevel)] || "medium";
    const skillsList = requiredSkills.length > 0 ? requiredSkills.join(", ") : field;

    const prompt = `You are an expert technical assessor creating multiple-choice questions for candidate evaluation.

JOB FIELD: ${field}
RELEVANT SKILLS: ${skillsList}
${jobDescription ? `JOB DESCRIPTION: ${jobDescription.slice(0, 300)}` : ""}
DIFFICULTY: ${diffString}
NUMBER OF QUESTIONS: ${numQuestions}

Generate exactly ${numQuestions} high-quality, practical MCQs that test real-world technical competency.

For each question, output:
- question: Clear technical problem or scenario
- options: Array of 4 distinct answers
- correctAnswer: The exact matching string from options that is correct
- skill: The specific skill/topic tested (e.g. React, SQL, Algorithms)
- difficulty: "easy" | "medium" | "hard" | "expert"
- explanation: Concise 1-2 sentence explanation of why the answer is correct

Return ONLY valid JSON matching this schema:
{
  "questions": [
    {
      "question": "Which HTTP method is typically idempotent?",
      "options": ["POST", "PUT", "PATCH", "CONNECT"],
      "correctAnswer": "PUT",
      "skill": "REST APIs",
      "difficulty": "medium",
      "explanation": "PUT is defined by HTTP specifications as idempotent because repeating the request results in the same resource state."
    }
  ]
}`;

    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: "You are a professional technical exam author. Always output valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 2000,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON<{ questions: RawMCQ[] }>(res.content);
    const rawQuestions = parsed?.questions || [];

    // Validate and format structured output for client compatibility
    const validatedQuestions = rawQuestions.map((q, idx) => {
      const options = Array.isArray(q.options) && q.options.length === 4
        ? q.options
        : ["Option A", "Option B", "Option C", "Option D"];

      let correctIndex = options.indexOf(q.correctAnswer);
      if (correctIndex === -1) {
        correctIndex = 0; // Default fallback to first option
      }

      return {
        id: `mcq-${idx + 1}-${Date.now()}`,
        question: q.question || `Technical question #${idx + 1}`,
        options,
        correctAnswer: q.correctAnswer || options[0],
        correctAnswers: [correctIndex],
        type: "single" as const,
        skill: q.skill || field,
        topic: q.skill || field,
        difficulty: q.difficulty || "medium",
        explanation: q.explanation || "Correct answer based on standard engineering principles.",
        points: q.difficulty === "expert" ? 4 : q.difficulty === "hard" ? 3 : 2,
        timeLimit: 60,
      };
    });

    return new Response(
      JSON.stringify({ questions: validatedQuestions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[generate-mcq-questions] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to generate MCQs",
        questions: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
