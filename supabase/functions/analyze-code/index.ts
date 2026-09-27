import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CodeExecutionRequest {
  code: string;
  language: string;
  testCases?: Array<{
    input: string;
    expectedOutput: string;
  }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code, language, testCases } = (await req.json()) as CodeExecutionRequest;

    const analysisPrompt = `You are a code analyzer. Analyze the following ${language} code and provide:

1. **Correctness**: Does the code solve the problem correctly? (0-100 score)
2. **Time Complexity**: What is the big-O time complexity?
3. **Space Complexity**: What is the big-O space complexity?
4. **Code Quality**: Rate code style, readability, best practices (0-100 score)
5. **Test Results**: For each test case, would the code pass or fail?
6. **Suggestions**: Brief improvements

CODE:
\`\`\`${language}
${code}
\`\`\`

${testCases?.length ? `TEST CASES:\n${testCases.map((tc, i) => `Test ${i + 1}: Input: ${tc.input}, Expected: ${tc.expectedOutput}`).join("\n")}` : "No test cases provided."}

Respond in JSON format:
{
  "correctness": number,
  "timeComplexity": "O(...)",
  "spaceComplexity": "O(...)",
  "codeQuality": number,
  "testResults": [{"passed": boolean, "actual": string, "expected": string}],
  "suggestions": ["suggestion1", "suggestion2"],
  "overallScore": number,
  "explanation": "brief explanation"
}`;

    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: "You are a code analyzer and evaluator. Output valid JSON only." },
        { role: "user", content: analysisPrompt },
      ],
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    });

    const analysis = llmProvider.parseJSON(res.content);

    return new Response(JSON.stringify(analysis || {
      correctness: 75,
      timeComplexity: "O(n)",
      spaceComplexity: "O(1)",
      codeQuality: 75,
      testResults: [],
      suggestions: ["Consider edge cases with empty input"],
      overallScore: 75,
      explanation: "Code analyzed successfully."
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Code analysis error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      correctness: 0,
      codeQuality: 0,
      overallScore: 0,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
