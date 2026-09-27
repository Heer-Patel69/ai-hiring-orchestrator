// =============================================
// AGENT 1: GATEKEEPER — Resume Screening Agent
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

    // Fetch application with candidate and job data
    const { data: application, error: appError } = await supabase
      .from("applications")
      .select(`
        *,
        candidate:candidate_profiles!applications_candidate_id_fkey(
          *,
          profile:profiles!candidate_profiles_user_id_fkey(*)
        ),
        job:jobs!applications_job_id_fkey(*)
      `)
      .eq("id", application_id)
      .single();

    if (appError || !application) {
      throw new Error(`Application not found: ${appError?.message}`);
    }

    const candidate = application.candidate;
    const job = application.job;
    const profile = candidate?.profile;

    // Update status to screening
    await supabase
      .from("applications")
      .update({ status: "screening", current_agent: 1 })
      .eq("id", application_id);

    // ===== STEP 1: Resume Analysis =====
    let resumeScore = 50; // Default score
    let extractedData = {
      skills: candidate?.skills || [],
      experience_years: candidate?.experience_years || 0,
      education: candidate?.education || [],
      projects: candidate?.projects || [],
      certifications: candidate?.certifications || [],
    };

    // If we have resume URL, analyze it with AI
    if (candidate?.resume_url) {
      try {
        const resumeAnalysis = await analyzeResumeWithAI(
          job,
          extractedData,
          candidate
        );
        resumeScore = resumeAnalysis.match_score;
        extractedData = {
          ...extractedData,
          ...resumeAnalysis.extracted_data,
        };
      } catch (e) {
        console.error("Resume analysis error:", e);
      }
    }

    // ===== STEP 2: GitHub Score (use existing or recalculate) =====
    const githubScore = candidate?.github_score || 0;

    // ===== STEP 3: LinkedIn Validation =====
    const linkedinValidated = candidate?.linkedin_url
      ? candidate.linkedin_url.includes("linkedin.com/in/")
      : false;

    // ===== STEP 4: Identity Verification =====
    // For now, check if verification_status is verified or pending
    const identityVerified = ["verified", "pending"].includes(
      candidate?.verification_status || ""
    );

    // ===== STEP 5: Calculate Overall Score =====
    const overallScore =
      resumeScore * 0.5 + githubScore * 0.3 + (linkedinValidated ? 10 : 0) + (identityVerified ? 10 : 0);

    // ===== STEP 6: Make Decision =====
    let decision: "pass" | "reject" | "borderline" = "reject";
    let reasoning = "";

    if (overallScore >= 60 && identityVerified) {
      decision = "pass";
      reasoning = `Strong candidate profile. Resume match: ${resumeScore}%, GitHub activity: ${githubScore}%. Identity verified. Proceeding to MCQ assessment.`;
    } else if (overallScore >= 40 && identityVerified) {
      decision = "borderline";
      reasoning = `Moderate match. Resume score: ${resumeScore}%, GitHub: ${githubScore}%. Flagged for closer review but proceeding.`;
    } else if (!identityVerified) {
      decision = "reject";
      reasoning = `Identity verification incomplete. Please complete verification to proceed.`;
    } else {
      decision = "reject";
      reasoning = `Profile does not meet minimum requirements. Resume match: ${resumeScore}%, GitHub: ${githubScore}%. We recommend gaining more relevant experience.`;
    }

    // Store agent result
    const agentResult = {
      application_id,
      agent_number: 1,
      agent_name: "Gatekeeper",
      score: overallScore,
      detailed_scores: {
        resume_match: resumeScore,
        github_activity: githubScore,
        linkedin_validation: linkedinValidated ? 100 : 0,
        identity_verification: identityVerified ? 100 : 0,
      },
      decision,
      reasoning,
      raw_data: {
        extracted_data: extractedData,
        resume_match_score: resumeScore,
        github_score: githubScore,
        linkedin_validated: linkedinValidated,
        identity_verified: identityVerified,
      },
    };

    await supabase.from("agent_results").insert(agentResult);

    // Update application status based on decision
    if (decision === "pass" || decision === "borderline") {
      await supabase
        .from("applications")
        .update({
          status: "mcq",
          current_agent: 2,
          agent_started_at: new Date().toISOString(),
        })
        .eq("id", application_id);

      // Trigger Agent 2 (Quizmaster) - generate questions
      await supabase.functions.invoke("agent-quizmaster-init", {
        body: { application_id },
      });
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
        next_agent: decision === "pass" || decision === "borderline" ? 2 : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Gatekeeper error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function analyzeResumeWithAI(
  job: any,
  existingData: any,
  candidate: any
) {
  const prompt = `You are an expert HR resume screener. Analyze this candidate for the job position.

JOB TITLE: ${job.title}
JOB DESCRIPTION: ${job.description}
REQUIRED SKILLS: ${(job.skills_required || []).join(", ")}
EXPERIENCE LEVEL: ${job.experience_level || "mid"}

CANDIDATE PROFILE:
- Name: ${candidate.profile?.full_name || "Unknown"}
- Skills: ${(existingData.skills || []).join(", ")}
- Experience: ${existingData.experience_years || 0} years
- GitHub: ${candidate.github_url || "Not provided"}
- LinkedIn: ${candidate.linkedin_url || "Not provided"}

Provide a JSON response with:
1. match_score: 0-100 (how well candidate matches job requirements)
2. extracted_data: { skills: [], experience_years: number, key_strengths: [], improvement_areas: [] }
3. analysis: Brief explanation of the match`;

  try {
    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: "You are an expert HR resume analyzer. Always respond with valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON(res.content);
    if (parsed) return parsed;
  } catch (e) {
    console.error("Failed to parse AI response in screenResume:", e);
  }

  // Default response if parsing fails
  return {
    match_score: 50,
    extracted_data: existingData,
    analysis: "Unable to fully analyze resume.",
  };
}
