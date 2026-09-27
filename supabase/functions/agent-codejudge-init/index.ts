// =============================================
// AGENT 3: CODE JUDGE — Problem Generation
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
    const { data: application } = await supabase
      .from("applications")
      .select(`*, job:jobs!applications_job_id_fkey(*)`)
      .eq("id", application_id)
      .single();

    if (!application) {
      throw new Error("Application not found");
    }

    const job = application.job;
    const roundConfig = job.round_config?.coding || {
      num_problems: 3,
      passing_score: 55,
      time_limit_minutes: 90,
    };

    // Check if problems already exist for this job
    const { data: existingProblems } = await supabase
      .from("coding_problems")
      .select("id")
      .eq("job_id", job.id)
      .limit(1);

    if (existingProblems && existingProblems.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Problems already generated for this job",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate coding problems using AI
    const problems = await generateCodingProblems(
      job,
      roundConfig.num_problems
    );

    // Store problems in database
    const problemsToInsert = problems.map((p: any) => ({
      job_id: job.id,
      title: p.title,
      description: p.description,
      input_format: p.input_format,
      output_format: p.output_format,
      constraints: p.constraints,
      examples: p.examples,
      test_cases: p.test_cases,
      hidden_test_cases: p.hidden_test_cases,
      difficulty: p.difficulty,
      expected_time_complexity: p.expected_time_complexity,
      expected_space_complexity: p.expected_space_complexity,
      hints: p.hints,
      time_limit_minutes: getDifficultyTimeLimit(p.difficulty),
    }));

    const { error: insertError } = await supabase
      .from("coding_problems")
      .insert(problemsToInsert);

    if (insertError) {
      throw new Error(`Failed to store problems: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Coding problems generated successfully",
        problems_count: problems.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Code Judge init error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getDifficultyTimeLimit(difficulty: string): number {
  const limits: Record<string, number> = {
    easy: 20,
    medium: 30,
    hard: 40,
    expert: 50,
  };
  return limits[difficulty] || 30;
}

async function generateCodingProblems(
  job: any,
  numProblems: number
) {
  const toughnessLevel = job.toughness_level || 3;
  const field = job.field || "software development";
  const skills = (job.skills_required || []).join(", ") || "algorithms, data structures";

  const prompt = `Generate ${numProblems} coding interview problems for a ${field} position.

JOB TITLE: ${job.title}
REQUIRED SKILLS: ${skills}
TOUGHNESS LEVEL: ${toughnessLevel}/5

Generate a mix of:
- 1 Easy/Medium algorithm problem
- 1 Medium/Hard data structure problem
- 1 Hard/Expert system design or optimization problem

For each problem, provide a JSON object:
{
  "title": "Problem Title",
  "description": "Full problem description with context",
  "input_format": "Description of input format",
  "output_format": "Description of expected output",
  "constraints": "Time/space constraints and input limits",
  "examples": [
    {"input": "example input", "output": "expected output", "explanation": "why this is correct"}
  ],
  "test_cases": [
    {"input": "test input", "expected_output": "output"}
  ],
  "hidden_test_cases": [
    {"input": "hidden test", "expected_output": "output", "is_hidden": true}
  ],
  "difficulty": "easy" | "medium" | "hard" | "expert",
  "expected_time_complexity": "O(n)",
  "expected_space_complexity": "O(1)",
  "hints": ["hint 1", "hint 2"]
}

Problems should be:
- Clear and unambiguous
- Have at least 3 visible and 5 hidden test cases
- Cover edge cases (empty input, large numbers, etc.)
- Be solvable in the time limit
- Test real-world problem-solving skills

Return a JSON array of problem objects.`;

  try {
    const res = await llmProvider.chat({
      messages: [
        {
          role: "system",
          content: "You are an expert coding interview designer. Create challenging but fair problems. Always respond with valid JSON array.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    const parsed = llmProvider.parseJSON(res.content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error("Failed to generate coding problems via Groq:", e);
  }

  // Return default problems if parsing fails
  return generateDefaultProblems(numProblems);
}

function generateDefaultProblems(count: number) {
  const templates = [
    {
      title: "Two Sum",
      description: "Given an array of integers and a target sum, find two numbers that add up to the target.",
      difficulty: "easy",
      expected_time_complexity: "O(n)",
      expected_space_complexity: "O(n)",
    },
    {
      title: "Validate Binary Search Tree",
      description: "Given a binary tree, determine if it is a valid binary search tree.",
      difficulty: "medium",
      expected_time_complexity: "O(n)",
      expected_space_complexity: "O(h)",
    },
    {
      title: "LRU Cache",
      description: "Design and implement a Least Recently Used (LRU) cache with O(1) operations.",
      difficulty: "hard",
      expected_time_complexity: "O(1)",
      expected_space_complexity: "O(capacity)",
    },
  ];

  return templates.slice(0, count).map((t) => ({
    ...t,
    input_format: "See problem description",
    output_format: "See problem description",
    constraints: "1 <= n <= 10^5",
    examples: [{ input: "sample", output: "result", explanation: "Example" }],
    test_cases: [{ input: "test", expected_output: "output" }],
    hidden_test_cases: [{ input: "hidden", expected_output: "output", is_hidden: true }],
    hints: ["Think about the time complexity"],
  }));
}
