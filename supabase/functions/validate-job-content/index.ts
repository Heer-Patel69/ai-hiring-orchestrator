import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ValidationRequest {
  field: "title" | "description" | "skills" | "full";
  content: string;
  context?: {
    jobField?: string;
    experienceLevel?: string;
    existingJobs?: string[];
  };
}

interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100 completeness score
  suggestions: {
    type: "spelling" | "grammar" | "content" | "seo" | "format" | "warning";
    message: string;
    position?: { start: number; end: number };
    suggestion?: string;
    severity: "low" | "medium" | "high";
  }[];
  duplicateWarning?: {
    isDuplicate: boolean;
    similarTitle?: string;
    similarity?: number;
  };
  seoScore?: number;
  readabilityScore?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { field, content, context }: ValidationRequest = await req.json();

    if (!content || content.trim().length === 0) {
      return new Response(
        JSON.stringify({
          isValid: false,
          score: 0,
          suggestions: [
            {
              type: "content",
              message: "This field is required",
              severity: "high",
            },
          ],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are an expert job listing validator. Analyze the provided job content and return a JSON validation result.

For the "${field}" field, check:
1. Spelling errors - identify misspelled words
2. Grammar issues - identify grammatical problems
3. Content quality - is it clear, professional, and complete?
4. SEO optimization - does it use relevant keywords?
5. Format issues - proper capitalization, punctuation
6. Inappropriate content - any discriminatory or offensive language

Return a JSON object with this EXACT structure:
{
  "isValid": boolean,
  "score": number (0-100 completeness/quality score),
  "suggestions": [
    {
      "type": "spelling" | "grammar" | "content" | "seo" | "format" | "warning",
      "message": "description of the issue",
      "suggestion": "suggested fix if applicable",
      "severity": "low" | "medium" | "high"
    }
  ],
  "seoScore": number (0-100),
  "readabilityScore": number (0-100)
}

Be strict but helpful. Focus on actionable improvements.`;

    const userPrompt = field === "full"
      ? `Validate this complete job listing:\n\n${content}\n\nContext: Job field is ${context?.jobField || "not specified"}, experience level is ${context?.experienceLevel || "not specified"}.${context?.existingJobs?.length ? `\n\nExisting job titles to check for duplicates: ${context.existingJobs.join(", ")}` : ""}`
      : `Validate this job ${field}:\n\n"${content}"${context?.jobField ? `\n\nJob field: ${context.jobField}` : ""}${context?.existingJobs?.length && field === "title" ? `\n\nCheck if similar to existing jobs: ${context.existingJobs.join(", ")}` : ""}`;

    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      responseFormat: { type: "json_object" },
    });

    const aiResponse = res.content || "";
    let validationResult: ValidationResult;
    try {
      // Extract JSON from response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        validationResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch {
      // Fallback basic validation
      validationResult = {
        isValid: content.length >= 10,
        score: Math.min(100, Math.max(20, content.length)),
        suggestions: [],
        seoScore: 70,
        readabilityScore: 70,
      };
    }

    // Add duplicate check for titles
    if (field === "title" && context?.existingJobs?.length) {
      const normalizedTitle = content.toLowerCase().trim();
      const similar = context.existingJobs.find((job) => {
        const normalizedJob = job.toLowerCase().trim();
        return (
          normalizedJob === normalizedTitle ||
          normalizedJob.includes(normalizedTitle) ||
          normalizedTitle.includes(normalizedJob)
        );
      });

      if (similar) {
        validationResult.duplicateWarning = {
          isDuplicate: true,
          similarTitle: similar,
          similarity: 90,
        };
        validationResult.suggestions.push({
          type: "warning",
          message: `Similar job title exists: "${similar}"`,
          severity: "medium",
          suggestion: "Consider using a more unique title",
        });
      }
    }

    return new Response(JSON.stringify(validationResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Validation error:", error);
    return new Response(
      JSON.stringify({
        isValid: true, // Don't block on error
        score: 50,
        suggestions: [],
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
