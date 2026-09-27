import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { groqKeyManager } from "../_shared/groq-key-manager.ts";
import { interviewOrchestrator, InterviewSessionContext } from "../_shared/interview-orchestrator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InterviewMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface InterviewRequest {
  messages: InterviewMessage[];
  applicationId?: string;
  durationSeconds?: number;
  remainingSeconds?: number;
  jobField?: string;
  toughnessLevel?: "easy" | "medium" | "hard" | "expert" | string;
  customQuestions?: string[];
  currentQuestionIndex?: number;
  candidateScore?: number;
  jobTitle?: string;
  requiredSkills?: string[];
  experienceLevel?: string;
  candidateName?: string;
  candidateSkills?: string[];
  resumeSummary?: string;
}

// Detect if candidate is explicitly signaling to conclude the interview
function isEndingConversation(message: string): boolean {
  const endPhrases = [
    "end the interview", "finish the interview", "i want to conclude",
    "that's all from my side", "let's end here", "wrap up the interview",
    "goodbye and thanks", "i am done with the interview"
  ];
  const lowerMessage = message.toLowerCase().trim();
  return endPhrases.some(phrase => lowerMessage.includes(phrase));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as InterviewRequest;
    const {
      messages = [],
      applicationId,
      durationSeconds = 120,
      remainingSeconds,
      jobField = "Software Engineering",
      toughnessLevel = "medium",
      customQuestions = [],
      currentQuestionIndex,
      jobTitle = "Software Engineer",
      requiredSkills = [],
      candidateName,
      candidateSkills = [],
      resumeSummary,
    } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let authoritativeRemaining = remainingSeconds;
    let resolvedCandidateName = candidateName;
    let resolvedCandidateSkills = candidateSkills;
    let resolvedProjects: any[] = [];
    let resolvedExperience: any[] = [];
    let resolvedResumeSummary = resumeSummary;
    let resolvedEducation: any[] = [];
    let resolvedJobTitle = jobTitle;
    let resolvedJobDescription = "";
    let resolvedRequiredSkills = requiredSkills;
    let resolvedResponsibilities: string[] = [];
    let resolvedField = jobField;
    let resolvedToughness = toughnessLevel;
    let resolvedRoundNumber = 1;

    // Load server-authoritative application, candidate, job, and round context
    if (applicationId) {
      const now = Date.now();

      const { data: appData, error: appError } = await supabase
        .from("applications")
        .select(`
          id,
          candidate_id,
          job_id,
          current_round,
          started_at,
          duration_seconds,
          expires_at,
          status,
          interview_context_snapshot,
          jobs(id, title, description, field, requirements, responsibilities, toughness_level, experience_level)
        `)
        .eq("id", applicationId)
        .maybeSingle();

      if (appError) {
        console.warn("[interview-agent] Error fetching application context:", appError);
      }

      if (appData) {
        resolvedRoundNumber = (appData.current_round || 0) + 1;

        // Server-enforced countdown timer check & initialization
        if (!appData.started_at || !appData.expires_at) {
          const startedAt = new Date(now).toISOString();
          const expiresAt = new Date(now + durationSeconds * 1000).toISOString();
          await supabase
            .from("applications")
            .update({
              started_at: startedAt,
              duration_seconds: durationSeconds,
              expires_at: expiresAt,
              status: "interviewing",
            })
            .eq("id", applicationId);

          authoritativeRemaining = durationSeconds;
        } else {
          const expiryTime = new Date(appData.expires_at).getTime();
          authoritativeRemaining = Math.max(0, Math.floor((expiryTime - now) / 1000));

          if (now >= expiryTime) {
            const closingText = "Our scheduled interview time has concluded. Thank you for taking the time to speak with me today. Your responses have been submitted for evaluation.";

            await supabase.from("interview_transcripts").insert({
              application_id: applicationId,
              role: "ai",
              content: closingText,
              phase: "closing",
              timestamp_ms: now,
            });

            return new Response(
              `data: ${JSON.stringify({ choices: [{ delta: { content: closingText } }] })}\n\ndata: [DONE]\n\n`,
              {
                headers: {
                  ...corsHeaders,
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                },
              }
            );
          }
        }

        // Persist candidate message to transcript
        const latestUserMsg = [...messages].reverse().find(m => m.role === "user");
        if (latestUserMsg && latestUserMsg.content.trim()) {
          await supabase.from("interview_transcripts").insert({
            application_id: applicationId,
            role: "candidate",
            content: latestUserMsg.content.trim(),
            phase: `round_${resolvedRoundNumber}`,
            timestamp_ms: now,
          });
        }

        // Load or restore authoritative Interview Context Snapshot
        if (appData.interview_context_snapshot && typeof appData.interview_context_snapshot === "object") {
          const snap = appData.interview_context_snapshot as any;
          if (snap.candidate?.fullName) resolvedCandidateName = snap.candidate.fullName;
          if (snap.candidate?.skills?.length) resolvedCandidateSkills = snap.candidate.skills;
          if (snap.candidate?.projects?.length) resolvedProjects = snap.candidate.projects;
          if (snap.candidate?.workExperience?.length) resolvedExperience = snap.candidate.workExperience;
          if (snap.candidate?.summary) resolvedResumeSummary = snap.candidate.summary;
          if (snap.candidate?.education) resolvedEducation = snap.candidate.education;

          if (snap.job?.title) resolvedJobTitle = snap.job.title;
          if (snap.job?.description) resolvedJobDescription = snap.job.description;
          if (snap.job?.requiredSkills?.length) resolvedRequiredSkills = snap.job.requiredSkills;
          if (snap.job?.responsibilities?.length) resolvedResponsibilities = snap.job.responsibilities;
          if (snap.job?.field) resolvedField = snap.job.field;
          if (snap.job?.toughnessLevel) resolvedToughness = snap.job.toughnessLevel;
        } else {
          // Fetch candidate profile, user profile, and round details
          const [candProfileRes, profileRes, jobRoundRes] = await Promise.all([
            supabase
              .from("candidate_profiles")
              .select("full_name, summary, skills, technical_skills, work_experience, projects, education, certifications, experience_years, github_url, linkedin_url, location")
              .eq("user_id", appData.candidate_id)
              .maybeSingle(),
            supabase
              .from("profiles")
              .select("full_name, email")
              .eq("user_id", appData.candidate_id)
              .maybeSingle(),
            supabase
              .from("job_rounds")
              .select("round_type, duration_minutes, passing_score")
              .eq("job_id", appData.job_id)
              .eq("round_number", resolvedRoundNumber)
              .maybeSingle(),
          ]);

          const cand = candProfileRes.data;
          const prof = profileRes.data;
          const job = appData.jobs as any;

          resolvedCandidateName =
            cand?.full_name?.trim() ||
            prof?.full_name?.trim() ||
            (prof?.email ? prof.email.split("@")[0] : undefined) ||
            candidateName ||
            "Candidate";

          resolvedCandidateSkills =
            (Array.isArray(cand?.skills) && cand.skills.length > 0 ? cand.skills : undefined) ||
            (Array.isArray(cand?.technical_skills) && cand.technical_skills.length > 0 ? cand.technical_skills : undefined) ||
            candidateSkills;

          resolvedProjects = Array.isArray(cand?.projects) ? cand.projects : [];
          resolvedExperience = Array.isArray(cand?.work_experience) ? cand.work_experience : [];
          resolvedResumeSummary = cand?.summary || resumeSummary || "";
          resolvedEducation = Array.isArray(cand?.education) ? cand.education : [];

          if (job) {
            resolvedJobTitle = job.title || resolvedJobTitle;
            resolvedJobDescription = job.description || "";
            resolvedField = job.field || resolvedField;
            resolvedToughness = job.toughness_level ? String(job.toughness_level) : resolvedToughness;
            if (Array.isArray(job.requirements) && job.requirements.length > 0) {
              resolvedRequiredSkills = job.requirements;
            }
            if (Array.isArray(job.responsibilities)) {
              resolvedResponsibilities = job.responsibilities;
            }
          }

          // Build and persist snapshot
          const snapshot = {
            candidate: {
              id: appData.candidate_id,
              fullName: resolvedCandidateName,
              summary: resolvedResumeSummary,
              location: cand?.location || "",
              experienceYears: cand?.experience_years,
              skills: resolvedCandidateSkills,
              workExperience: resolvedExperience,
              projects: resolvedProjects,
              education: resolvedEducation,
              github: cand?.github_url || "",
              linkedin: cand?.linkedin_url || "",
            },
            job: {
              id: appData.job_id,
              title: resolvedJobTitle,
              description: resolvedJobDescription,
              requiredSkills: resolvedRequiredSkills,
              responsibilities: resolvedResponsibilities,
              field: resolvedField,
              toughnessLevel: resolvedToughness,
            },
            round: {
              number: resolvedRoundNumber,
              type: jobRoundRes.data?.round_type || "Technical Screening",
              durationMinutes: jobRoundRes.data?.duration_minutes,
              passingScore: jobRoundRes.data?.passing_score || 60,
            },
            createdAt: new Date().toISOString(),
          };

          try {
            await supabase
              .from("applications")
              .update({ interview_context_snapshot: snapshot })
              .eq("id", applicationId);
          } catch (snapErr) {
            console.warn("Failed to persist interview context snapshot:", snapErr);
          }
        }

        // Context telemetry log (PART 17)
        console.log(`[interview-agent] Interview context initialized:
  sessionId: ${applicationId}
  candidateId: ${appData.candidate_id}
  candidateNameResolved: ${!!resolvedCandidateName && resolvedCandidateName !== "Candidate"} (${resolvedCandidateName})
  resumeLoaded: ${!!(resolvedCandidateSkills?.length || resolvedProjects?.length || resolvedExperience?.length)}
  projectsCount: ${resolvedProjects?.length || 0}
  workExpCount: ${resolvedExperience?.length || 0}
  jobTitleLoaded: ${!!resolvedJobTitle} (${resolvedJobTitle})
  jobDescriptionLoaded: ${!!resolvedJobDescription}
  requiredSkillsCount: ${resolvedRequiredSkills?.length || 0}
  roundLoaded: true (Round ${resolvedRoundNumber})`);
      }
    }

    const lastMessage = messages[messages.length - 1];
    const candidateEnding = lastMessage?.role === "user" && isEndingConversation(lastMessage.content);

    // Build rich, structured context with server timer constraints
    const ctx: InterviewSessionContext = {
      candidate: {
        name: resolvedCandidateName,
        fullName: resolvedCandidateName,
        skills: resolvedCandidateSkills.length > 0 ? resolvedCandidateSkills : resolvedRequiredSkills,
        resumeSummary: resolvedResumeSummary,
        projects: resolvedProjects,
        workExperience: resolvedExperience,
        education: resolvedEducation,
      },
      job: {
        title: resolvedJobTitle,
        field: resolvedField,
        requiredSkills: resolvedRequiredSkills.length > 0 ? resolvedRequiredSkills : [resolvedField],
        description: resolvedJobDescription,
        responsibilities: resolvedResponsibilities,
        toughnessLevel: resolvedToughness,
        companyQuestions: customQuestions,
      },
      history: messages.map((m) => ({ role: m.role, content: m.content })),
      currentQuestionIndex,
      durationSeconds,
      remainingSeconds: authoritativeRemaining,
      roundOrder: resolvedRoundNumber,
    };

    let systemPrompt = interviewOrchestrator.buildSystemPrompt(ctx);

    if (candidateEnding) {
      systemPrompt += `\n\nCANDIDATE CONCLUSION REQUEST:
The candidate wishes to finish the interview. Give a polite, warm, 2-sentence closing statement thanking them for their time and wishing them luck with the hiring process. Do NOT reveal scores or outcomes.`;
    }

    // Stream using Groq Key Manager with auto-failover
    const result = await groqKeyManager.execute({
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.4,
      max_tokens: 300,
      stream: true,
      timeoutMs: 30000,
    });

    if (!result.ok || !result.stream) {
      console.warn(`[interview-agent] Groq stream execution failed: ${result.error}`);
      return new Response(
        JSON.stringify({
          error: result.error || "AI service is temporarily busy. Please retry shortly.",
          status: result.status,
        }),
        {
          status: result.status === 429 ? 429 : 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Return the SSE stream directly to the frontend
    return new Response(result.stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error in interview-agent:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
