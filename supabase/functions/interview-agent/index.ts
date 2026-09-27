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
  toughnessLevel?: "easy" | "medium" | "hard" | "expert";
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
      candidateScore,
      jobTitle = "Software Engineer",
      requiredSkills = [],
      experienceLevel,
      candidateName,
      candidateSkills = [],
      resumeSummary,
    } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let authoritativeRemaining = remainingSeconds;

    // Check server-authoritative timer if applicationId provided
    if (applicationId) {
      const { data: app } = await supabase
        .from("applications")
        .select("started_at, duration_seconds, expires_at, status")
        .eq("id", applicationId)
        .maybeSingle();

      const now = Date.now();

      if (app) {
        if (!app.started_at || !app.expires_at) {
          // Initialize server timer on first turn
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
          // Calculate remaining seconds strictly from server timestamp
          const expiryTime = new Date(app.expires_at).getTime();
          authoritativeRemaining = Math.max(0, Math.floor((expiryTime - now) / 1000));

          // If expired, reject new question and end interview
          if (now >= expiryTime) {
            const closingText = "Our scheduled interview time has concluded. Thank you for taking the time to speak with me today. Your responses have been submitted for evaluation.";
            
            // Persist closing transcript
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
      }

      // Persist the candidate's latest message to transcript
      const latestUserMsg = [...messages].reverse().find(m => m.role === "user");
      if (latestUserMsg) {
        await supabase.from("interview_transcripts").insert({
          application_id: applicationId,
          role: "candidate",
          content: latestUserMsg.content,
          phase: "technical",
          timestamp_ms: now,
        });
      }
    }

    const lastMessage = messages[messages.length - 1];
    const candidateEnding = lastMessage?.role === "user" && isEndingConversation(lastMessage.content);

    // Build rich, structured context with server timer constraints
    const ctx: InterviewSessionContext = {
      candidate: {
        name: candidateName,
        skills: candidateSkills.length > 0 ? candidateSkills : requiredSkills,
        resumeSummary,
      },
      job: {
        title: jobTitle,
        field: jobField,
        requiredSkills: requiredSkills.length > 0 ? requiredSkills : [jobField],
        toughnessLevel: toughnessLevel,
        companyQuestions: customQuestions,
      },
      history: messages.map((m) => ({ role: m.role, content: m.content })),
      currentQuestionIndex,
      durationSeconds,
      remainingSeconds: authoritativeRemaining,
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
