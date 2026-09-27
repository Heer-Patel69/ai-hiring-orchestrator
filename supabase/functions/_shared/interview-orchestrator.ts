// =============================================
// HIREMINDS CENTRAL INTERVIEW ORCHESTRATOR
// Decoupled Pipeline: STT -> Context -> Groq LLM -> TTS
// =============================================

import { LLMProvider, llmProvider, ChatMessage } from "./llm-provider.ts";
import { SpeechToTextProvider, TextToSpeechProvider, bhashiniSTT, bhashiniTTS } from "./bhashini-services.ts";

export interface CandidateContext {
  id?: string;
  name?: string;
  fullName?: string;
  skills?: string[];
  experienceYears?: number | string;
  education?: Array<string | Record<string, any>>;
  projects?: Array<string | Record<string, any>>;
  workExperience?: Array<string | Record<string, any>>;
  githubHighlights?: string[];
  resumeSummary?: string;
  summary?: string;
  location?: string;
  github?: string;
  linkedin?: string;
  previousScores?: Array<{ agentName: string; score: number }>;
}

export interface JobContext {
  id?: string;
  title: string;
  field?: string;
  requiredSkills: string[];
  preferredSkills?: string[];
  description?: string;
  responsibilities?: string[];
  experienceLevel?: string;
  toughnessLevel?: "easy" | "medium" | "hard" | "expert" | string;
  companyQuestions?: string[];
}

export interface InterviewSessionContext {
  candidate: CandidateContext;
  job: JobContext;
  currentPhase?: "warmup" | "technical" | "scenario" | "candidate_questions" | "closing";
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  currentQuestionIndex?: number;
  durationSeconds?: number;
  remainingSeconds?: number;
  roundTitle?: string;
  roundOrder?: number;
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
    const candidateDisplayName = candidate.fullName || candidate.name || "Candidate";

    let timeBudgetInstructions = "";
    if (ctx.durationSeconds) {
      const durationMin = Math.round(ctx.durationSeconds / 60);
      let questionBudget = "5 to 7 concise questions total";
      if (ctx.durationSeconds <= 120) {
        questionBudget = "2 to 3 very concise questions total";
      } else if (ctx.durationSeconds <= 300) {
        questionBudget = "3 to 4 concise questions total";
      }
      timeBudgetInstructions += `\nTIME MANAGEMENT & QUESTION BUDGET:
- Configured Round Duration: ${ctx.durationSeconds} seconds (~${durationMin} min).
- Strict Question Budget: ${questionBudget}.`;
    }

    if (ctx.remainingSeconds !== undefined) {
      timeBudgetInstructions += `\n- Authoritative Remaining Time: ${ctx.remainingSeconds} seconds.`;
      if (ctx.remainingSeconds <= 30) {
        timeBudgetInstructions += `\nCRITICAL TIME LIMIT: There are only ${ctx.remainingSeconds} seconds remaining! DO NOT start another technical question. Conclude gracefully with a warm, professional 2-sentence closing statement thanking them for their time.`;
      }
    }

    // Format formatted projects list
    let formattedProjects = "None specified";
    if (Array.isArray(candidate.projects) && candidate.projects.length > 0) {
      formattedProjects = candidate.projects.map((p) => {
        if (typeof p === "string") return p;
        const name = p.name || p.title || "Project";
        const desc = p.description ? ` (${p.description})` : "";
        const techs = Array.isArray(p.technologies) ? ` [Tech: ${p.technologies.join(", ")}]` : "";
        return `${name}${desc}${techs}`;
      }).slice(0, 4).join(" | ");
    }

    // Format work experience list
    let formattedExperience = "None specified";
    if (Array.isArray(candidate.workExperience) && candidate.workExperience.length > 0) {
      formattedExperience = candidate.workExperience.map((w) => {
        if (typeof w === "string") return w;
        const role = w.role || w.title || "Software Engineer";
        const company = w.company ? ` at ${w.company}` : "";
        const desc = w.description ? ` - ${w.description.slice(0, 100)}` : "";
        return `${role}${company}${desc}`;
      }).slice(0, 3).join(" | ");
    }

    const summaryText = candidate.resumeSummary || candidate.summary || "";

    return `You are the AI interviewer for HireMinds.
You are interviewing ${candidateDisplayName} for the role of ${job.title}.

You have access to:
- The candidate's real parsed resume, verified skills, and project history
- The job title, complete job description, and required skills
- The current interview round and remaining duration
- The previous answers given in THIS interview session

POSITION & JOB REQUIREMENTS:
- Job Title: ${job.title} (${job.field || "Technology"})
- Difficulty / Toughness: ${job.toughnessLevel || "medium"}
- Required Job Skills: ${job.requiredSkills.join(", ") || "Core Software Engineering"}
${job.preferredSkills?.length ? `- Preferred Skills: ${job.preferredSkills.join(", ")}` : ""}
${job.description ? `- Complete Job Description: ${job.description.slice(0, 500)}` : ""}
${job.responsibilities?.length ? `- Key Responsibilities: ${job.responsibilities.slice(0, 3).join("; ")}` : ""}
${job.companyQuestions?.length ? `- Mandatory Company Questions: ${job.companyQuestions.join(" | ")}` : ""}

CANDIDATE DOSSIER:
- Candidate Name: ${candidateDisplayName}
- Experience Level: ${candidate.experienceYears ? `${candidate.experienceYears} years` : "Not specified"}
- Verified Candidate Skills: ${candidate.skills?.join(", ") || "Technical background"}
- Candidate Projects: ${formattedProjects}
- Work Experience History: ${formattedExperience}
${summaryText ? `- Professional Summary: ${summaryText.slice(0, 300)}` : ""}
${timeBudgetInstructions}

CURRENT INTERVIEW PHASE: ${currentPhase.toUpperCase()}

INTERVIEW QUESTION STRATEGY & DIRECTIVES:
1. NEVER ASK GENERIC QUESTIONS like "Tell me about yourself" when resume-specific or job-specific questions are available.
2. ASK RESUME-SPECIFIC QUESTIONS: Directly reference projects, tools, or architectures claimed in the candidate's resume (e.g. "I noticed you built ${formattedProjects.split(" | ")[0] || "a project"}. How did you structure that application and handle state management?").
3. ASK INTELLIGENT FOLLOW-UPS: Analyze the candidate's previous response in THIS session. If they answered X, probe into how they handled failure cases, edge cases, security, or performance trade-offs.
4. ASK ONE QUESTION AT A TIME. Keep spoken responses concise (2 to 3 sentences maximum) so the candidate can answer.
5. DO NOT lecture, explain concepts unprompted, or give away the solution.
6. DO NOT disclose internal scoring logic, ratings, or grading percentages.
7. NEVER invent or hallucinate candidate claims, companies, or degrees not in the candidate dossier.
8. Adapt to the remaining time: keep questions focused and do not start a long new question when less than 30 seconds remain.`;
  }

  /**
   * Generates the initial tailored greeting and opening question
   */
  public async generateOpening(ctx: InterviewSessionContext): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(ctx);
    const candidateName = ctx.candidate.fullName || ctx.candidate.name || "there";
    const userPrompt = `Generate a warm, professional opening greeting for ${candidateName}.
Briefly introduce yourself as the interviewer for the ${ctx.job.title} position, make them feel comfortable, and ask the first focused technical question directly referencing their relevant background or required skill (${ctx.job.requiredSkills[0] || "their technical experience"}).
Keep your response to 2-3 spoken sentences maximum.`;

    const response = await this.llm.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
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
      const fallbackReply = "I couldn't hear that clearly. Could you please repeat your answer?";
      const audioReply = await this.tts.synthesize(fallbackReply, language);
      return {
        transcript: "",
        replyText: fallbackReply,
        audioBase64: audioReply,
      };
    }

    // 2. Add to history & generate next question
    const systemPrompt = this.buildSystemPrompt(ctx);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...ctx.history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: transcript },
    ];

    const response = await this.llm.chat({
      messages,
      temperature: 0.4,
      maxTokens: 200,
    });

    const replyText = response.content.trim();

    // 3. TTS
    const audioBase64Reply = await this.tts.synthesize(replyText, language);

    return {
      transcript,
      replyText,
      audioBase64: audioBase64Reply,
    };
  }
}

export const interviewOrchestrator = new InterviewOrchestrator();
