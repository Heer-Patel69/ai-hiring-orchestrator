// =============================================
// HIREMINDS CENTRAL INTERVIEW ORCHESTRATOR
// Decoupled Pipeline: STT -> Context -> Groq LLM -> TTS
// =============================================

import { LLMProvider, llmProvider, ChatMessage } from "./llm-provider.ts";
import { SpeechToTextProvider, TextToSpeechProvider, bhashiniSTT, bhashiniTTS } from "./bhashini-services.ts";

export interface CandidateContext {
  name?: string;
  skills?: string[];
  experienceYears?: number;
  education?: string[];
  projects?: string[];
  githubHighlights?: string[];
  resumeSummary?: string;
  previousScores?: Array<{ agentName: string; score: number }>;
}

export interface JobContext {
  title: string;
  field?: string;
  requiredSkills: string[];
  description?: string;
  toughnessLevel?: "easy" | "medium" | "hard" | "expert";
  companyQuestions?: string[];
}

export interface InterviewSessionContext {
  candidate: CandidateContext;
  job: JobContext;
  currentPhase?: "warmup" | "technical" | "scenario" | "candidate_questions" | "closing";
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  currentQuestionIndex?: number;
}

export class InterviewOrchestrator {
  private stt: SpeechToTextProvider;
  private llm: LLMProvider;
  private tts: TextToSpeechProvider;

  constructor(
    stt: SpeechToTextProvider = bhashiniSTT,
    llm: LLMProvider = llmProvider,
    tts: TextToSpeechProvider = bhashiniTTS
  ) {
    this.stt = stt;
    this.llm = llm;
    this.tts = tts;
  }

  /**
   * Builds the centralized, strict interviewer system prompt adhering to all professional guidelines
   */
  public buildSystemPrompt(ctx: InterviewSessionContext): string {
    const { candidate, job, currentPhase = "technical" } = ctx;

    return `You are Alex, an expert Senior Technical Interviewer conducting a live, professional interview for the role of ${job.title}.
Your demeanor is warm, professional, encouraging, yet intellectually rigorous.

ROLE & REQUIREMENTS:
- Position: ${job.title} (${job.field || "Technology"})
- Difficulty Level: ${job.toughnessLevel || "medium"}
- Required Job Skills: ${job.requiredSkills.join(", ") || "Core Software Engineering"}
${job.description ? `- Job Summary: ${job.description.slice(0, 300)}` : ""}
${job.companyQuestions?.length ? `- Mandatory Company Assessment Questions: ${job.companyQuestions.join(" | ")}` : ""}

CANDIDATE DOSSIER:
- Candidate Name: ${candidate.name || "Candidate"}
- Experience: ${candidate.experienceYears !== undefined ? `${candidate.experienceYears} years` : "Not specified"}
- Verified Candidate Skills: ${candidate.skills?.join(", ") || "Technical background"}
${candidate.projects?.length ? `- Candidate Notable Projects: ${candidate.projects.slice(0, 3).join("; ")}` : ""}
${candidate.githubHighlights?.length ? `- GitHub Highlights: ${candidate.githubHighlights.slice(0, 2).join("; ")}` : ""}
${candidate.resumeSummary ? `- Resume Summary: ${candidate.resumeSummary.slice(0, 250)}` : ""}

CURRENT INTERVIEW PHASE: ${currentPhase.toUpperCase()}

CORE INTERVIEWER DIRECTIVES (STRICT COMPLIANCE REQUIRED):
1. Ask exactly ONE question at a time.
2. Keep spoken responses concise (2 to 3 sentences maximum) so the candidate can speak.
3. Do NOT lecture, monologue, or explain concepts unprompted.
4. Do NOT reveal the correct answers or give away solutions during the interview.
5. Do NOT disclose internal scores, evaluation percentages, or grading metrics to the candidate.
6. Ask adaptive follow-up questions:
   - If the candidate gives a strong answer: probe deeper into edge cases, internals, or scalability trade-offs.
   - If the candidate gives an incomplete or vague answer: ask for specific clarification or a concrete example.
   - If the candidate mentions a specific tool or project from their experience: bridge to that experience with a relevant technical question.
   - If the candidate struggles heavily: provide a gentle nudge or shift gracefully without demoralizing them.
7. Avoid repeating questions or covering topics already addressed in previous turns.
8. Stay strictly relevant to the job requirements and candidate technical background.
9. Sound conversational, natural, and human.
10. NEVER state that you are an AI model, LLM, Groq, or mention any internal APIs or infrastructure.
11. If the candidate gives a very short, unclear, or silent response, politely say: "I couldn't catch that clearly. Could you elaborate on that?"
12. NEVER hallucinate or invent candidate experience, companies, or degrees that are not explicitly present in the candidate dossier.
13. When asking coding challenges, describe the problem simply in 2 sentences and instruct the candidate to explain their thought process.`;
  }

  /**
   * Generates the initial tailored greeting and opening question
   */
  public async generateOpening(ctx: InterviewSessionContext): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(ctx);
    const userPrompt = `Generate a warm, professional opening greeting for ${ctx.candidate.name || "the candidate"}.
Briefly introduce yourself as the interviewer for the ${ctx.job.title} position, make them feel at ease, and ask the first focused technical icebreaker question related to ${ctx.job.requiredSkills[0] || "their background"}.
Keep your response to 2-3 spoken sentences max.`;

    const response = await this.llm.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.6,
      maxTokens: 150,
    });

    return response.content.trim();
  }

  /**
   * Transcribes candidate audio and executes an adaptive response turn
   */
  public async processAudioTurn(
    audioBase64: string,
    ctx: InterviewSessionContext,
    language = "en"
  ): Promise<{ transcript: string; replyText: string; audioBase64: string }> {
    // 1. STT
    let transcript = await this.stt.transcribe(audioBase64, language);
    if (!transcript || transcript.trim().length === 0) {
      const fallbackReply = "Sorry, I couldn't hear that clearly. Could you repeat your answer?";
      const audioReply = await this.tts.synthesize(fallbackReply, language);
      return {
        transcript: "",
        replyText: fallbackReply,
        audioBase64: audioReply,
      };
    }

    // 2. Add to conversation history
    const conversationMessages: ChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(ctx) },
      ...ctx.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: transcript },
    ];

    // 3. Groq LLM Turn
    const llmRes = await this.llm.chat({
      messages: conversationMessages,
      temperature: 0.5,
      maxTokens: 180,
    });

    const replyText = llmRes.content.trim();

    // 4. TTS
    const audioReply = await this.tts.synthesize(replyText, language);

    return {
      transcript,
      replyText,
      audioBase64: audioReply,
    };
  }

  /**
   * Generates a stream of responses for low-latency live web client
   */
  public async streamInterviewResponse(ctx: InterviewSessionContext): Promise<ReadableStream<Uint8Array>> {
    const systemPrompt = this.buildSystemPrompt(ctx);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...ctx.history.map((h) => ({ role: h.role, content: h.content })),
    ];

    return await this.llm.chatStream({
      messages,
      temperature: 0.4,
      maxTokens: 250,
    });
  }
}

export const interviewOrchestrator = new InterviewOrchestrator();
