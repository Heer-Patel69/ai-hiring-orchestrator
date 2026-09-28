import crypto from "node:crypto";
import express from "express";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildInterviewPrompt } from "./prompt.js";

const VERSION = "1.0.0";
const DEFAULT_GROQ_URL = "https://api.groq.com/openai/v1";
const BHASHINI_AUTH_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";
const DEFAULT_BHASHINI_PIPELINE_ID = "64392f96daac500b55c543cd";
const pipelineCache = new Map();
const groqHealth = new Map();

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function splitOrigins(value) {
  return String(value || "").split(",").map((item) => item.trim().replace(/\/$/, "")).filter(Boolean);
}

export function loadConfig(env = process.env) {
  const appEnv = env.APP_ENV?.trim() || "development";
  const configuredOrigins = new Set([
    ...splitOrigins(env.CORS_ORIGINS),
    ...splitOrigins(env.FRONTEND_URL),
  ]);
  if (appEnv !== "production") {
    configuredOrigins.add("http://localhost:5173");
    configuredOrigins.add("http://localhost:8080");
  }
  if (appEnv === "production" && configuredOrigins.size === 0) {
    throw new Error("CORS_ORIGINS or FRONTEND_URL is required in production");
  }

  const groqKeys = Object.keys(env)
    .filter((key) => /^GROQ_API_KEY(_\d+)?$/.test(key) && env[key]?.trim())
    .sort((a, b) => Number(a.split("_").at(-1) || 1) - Number(b.split("_").at(-1) || 1))
    .map((key) => ({ id: key, value: env[key].trim() }));

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  if (!supabaseUrl) throw new Error("Missing required environment variable: SUPABASE_URL (or VITE_SUPABASE_URL)");

  const supabasePublishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabasePublishableKey) throw new Error("Missing required environment variable: SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY)");

  const supabaseSecretKey = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseSecretKey) throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)");

  return {
    appEnv,
    port: Number(env.PORT || 10000),
    allowedOrigins: configuredOrigins,
    databaseUrl: required(env, "DATABASE_URL"),
    dbPoolMax: Math.max(1, Math.min(10, Number(env.DB_POOL_MAX || 5))),
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey,
    groqKeys,
    groqModel: env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
    groqBaseUrl: (env.GROQ_BASE_URL?.trim() || DEFAULT_GROQ_URL).replace(/\/$/, ""),
    bhashiniUserId: env.BHASHINI_UDYAT_KEY?.trim() || env.BHASHINI_USER_ID?.trim() || "",
    bhashiniApiKey: env.BHASHINI_INFERENCE_KEY?.trim() || env.BHASHINI_ULCA_API_KEY?.trim() || "",
    bhashiniPipelineId: env.BHASHINI_PIPELINE_ID?.trim() || DEFAULT_BHASHINI_PIPELINE_ID,
  };
}

function log(level, event, fields = {}) {
  const safeFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safeFields }));
}

function apiError(res, status, code, message, requestId) {
  return res.status(status).json({ error: { code, message, requestId } });
}

function bearerToken(req) {
  const match = req.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function normalizeLanguage(language) {
  const supported = new Set(["en", "hi", "gu", "mr", "ta", "te", "bn", "kn", "ml", "pa", "or", "as"]);
  const normalized = String(language || "en").toLowerCase().trim().slice(0, 2);
  return supported.has(normalized) ? normalized : "en";
}

function isEndingConversation(message) {
  const normalized = String(message || "").toLowerCase();
  return ["end the interview", "finish the interview", "i want to conclude", "wrap up the interview"].some((phrase) => normalized.includes(phrase));
}

function availableGroqKeys(config) {
  const now = Date.now();
  return config.groqKeys.filter((key) => {
    const state = groqHealth.get(key.id);
    return !state || state.retryAt <= now;
  });
}

async function callGroq(config, payload, requestId) {
  const keys = availableGroqKeys(config);
  if (keys.length === 0) throw Object.assign(new Error("All Groq keys are temporarily unavailable"), { status: 503 });

  for (const key of keys) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch(`${config.groqBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key.value}`, "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        groqHealth.delete(key.id);
        return response;
      }
      if (response.status === 401 || response.status === 403) {
        groqHealth.set(key.id, { retryAt: Number.MAX_SAFE_INTEGER, status: "invalid" });
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const retrySeconds = Math.min(300, Math.max(20, Number(response.headers.get("retry-after") || 30)));
        groqHealth.set(key.id, { retryAt: Date.now() + retrySeconds * 1000, status: "cooldown" });
        continue;
      }
      const detail = await response.text();
      throw Object.assign(new Error(`Groq rejected the request (${response.status}): ${detail.slice(0, 160)}`), { status: response.status });
    } catch (error) {
      clearTimeout(timer);
      if (error?.status && error.status < 500) throw error;
      groqHealth.set(key.id, { retryAt: Date.now() + 20_000, status: "unavailable" });
    }
  }
  throw Object.assign(new Error("AI service is temporarily unavailable"), { status: 503 });
}

async function getBhashiniPipeline(config, task, language) {
  if (!config.bhashiniUserId || !config.bhashiniApiKey) {
    throw Object.assign(new Error("Bhashini is not configured"), { status: 503 });
  }
  const cacheKey = `${task}:${language}`;
  const cached = pipelineCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(BHASHINI_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", userID: config.bhashiniUserId, ulcaApiKey: config.bhashiniApiKey },
    body: JSON.stringify({
      pipelineTasks: [{ taskType: task, config: { language: { sourceLanguage: language } } }],
      pipelineRequestConfig: { pipelineId: config.bhashiniPipelineId },
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  if (!response.ok) throw Object.assign(new Error(`Bhashini configuration failed (${response.status})`), { status: 502 });
  const data = await response.json();
  const taskConfig = data?.pipelineResponseConfig?.[0]?.config?.[0];
  const endpoint = data?.pipelineInferenceAPIEndPoint;
  if (!taskConfig?.serviceId || !endpoint?.callbackUrl) {
    throw Object.assign(new Error("Bhashini returned an incomplete pipeline configuration"), { status: 502 });
  }
  const result = {
    callbackUrl: endpoint.callbackUrl,
    authHeaderName: endpoint.inferenceApiKey?.name || "Authorization",
    authHeaderValue: endpoint.inferenceApiKey?.value || "",
    serviceId: taskConfig.serviceId,
    fetchedAt: Date.now(),
  };
  pipelineCache.set(cacheKey, result);
  return result;
}

async function callBhashini(config, task, language, input, samplingRate, gender) {
  const pipeline = await getBhashiniPipeline(config, task, language);
  const body = task === "asr"
    ? {
        pipelineTasks: [{ taskType: "asr", config: { language: { sourceLanguage: language }, serviceId: pipeline.serviceId, audioFormat: "wav", samplingRate, livenessCheck: false } }],
        inputData: { audio: [{ audioContent: input }] },
      }
    : {
        pipelineTasks: [{ taskType: "tts", config: { language: { sourceLanguage: language }, serviceId: pipeline.serviceId, gender, samplingRate: 22050 } }],
        inputData: { input: [{ source: input }] },
      };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const response = await fetch(pipeline.callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", [pipeline.authHeaderName]: pipeline.authHeaderValue },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  if (!response.ok) throw Object.assign(new Error(`Bhashini inference failed (${response.status})`), { status: 502 });
  return response.json();
}

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().trim().min(1).max(10_000),
});

const interviewSchema = z.object({
  messages: z.array(messageSchema).max(100).default([]),
  applicationId: z.string().uuid(),
  durationSeconds: z.number().int().min(30).max(14_400).default(120),
  remainingSeconds: z.number().int().min(0).max(14_400).optional(),
  currentQuestionIndex: z.number().int().min(0).max(100).optional(),
  jobField: z.string().max(160).optional(),
  toughnessLevel: z.string().max(40).optional(),
  jobTitle: z.string().max(200).optional(),
  candidateName: z.string().max(200).optional(),
});

const voiceSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), language: z.string().optional() }),
  z.object({ action: z.literal("asr"), audioContent: z.string().min(20).max(28_000_000), language: z.string().optional(), samplingRate: z.number().int().min(8000).max(48000).default(16000) }),
  z.object({ action: z.literal("tts"), text: z.string().trim().min(1).max(5000), language: z.string().optional(), gender: z.enum(["female", "male"]).default("female") }),
]);

export function createApp(config) {
  const app = express();
  const cleanDbUrl = (config.databaseUrl || "")
    .replace(/([?&])sslmode=[^&]+(&|$)/, "$1")
    .replace(/[?&]$/, "");

  const pool = new Pool({
    connectionString: cleanDbUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: config.databaseUrl.includes("supabase.co") || config.databaseUrl.includes("sslmode=")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  const admin = createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicClient = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } });

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const requestId = req.get("x-request-id") || crypto.randomUUID();
    req.requestId = requestId;
    res.set("x-request-id", requestId);
    res.set("x-content-type-options", "nosniff");
    res.set("referrer-policy", "no-referrer");
    next();
  });
  app.use((req, res, next) => {
    const origin = req.get("origin")?.replace(/\/$/, "");
    if (origin && !config.allowedOrigins.has(origin)) {
      return apiError(res, 403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed", req.requestId);
    }
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "authorization, content-type, x-request-id");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "28mb" }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok", database: "configured", version: VERSION, timestamp: new Date().toISOString(), requestId: req.requestId });
  });

  app.get("/ready", async (req, res) => {
    try {
      await pool.query("select 1 as ready");
      const dependencies = {
        database: "ok",
        supabase: "configured",
        groq: config.groqKeys.length > 0 ? "configured" : "missing",
        bhashini: config.bhashiniUserId && config.bhashiniApiKey ? "configured" : "missing",
      };
      const ready = dependencies.groq === "configured" && dependencies.bhashini === "configured";
      return res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", dependencies, timestamp: new Date().toISOString(), requestId: req.requestId });
    } catch (error) {
      log("error", "READINESS_FAILED", { requestId: req.requestId, message: error.message });
      return res.status(503).json({ status: "not_ready", dependencies: { database: "unavailable" }, timestamp: new Date().toISOString(), requestId: req.requestId });
    }
  });

  app.use("/api", async (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return apiError(res, 401, "AUTH_REQUIRED", "A valid Supabase access token is required", req.requestId);
    const { data, error } = await publicClient.auth.getUser(token);
    if (error || !data.user) return apiError(res, 401, "INVALID_TOKEN", "The authentication token is invalid or expired", req.requestId);
    req.user = data.user;
    next();
  });

  app.post("/api/interview-agent", async (req, res) => {
    const parsed = interviewSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid request", req.requestId);
    const input = parsed.data;
    try {
      const { data: application, error: appError } = await admin
        .from("applications")
        .select("id,candidate_id,job_id,current_round,started_at,duration_seconds,expires_at,status,interview_context_snapshot,jobs(id,title,description,field,required_skills,toughness_level,experience_level)")
        .eq("id", input.applicationId)
        .eq("candidate_id", req.user.id)
        .maybeSingle();
      if (appError) throw appError;
      if (!application) return apiError(res, 404, "APPLICATION_NOT_FOUND", "The application was not found or is not accessible", req.requestId);

      const now = Date.now();
      let remainingSeconds = input.remainingSeconds;
      if (!application.started_at || !application.expires_at) {
        const expiresAt = new Date(now + input.durationSeconds * 1000).toISOString();
        const { error } = await admin.from("applications").update({ started_at: new Date(now).toISOString(), duration_seconds: input.durationSeconds, expires_at: expiresAt, status: "interviewing" }).eq("id", application.id).eq("candidate_id", req.user.id);
        if (error) throw error;
        remainingSeconds = input.durationSeconds;
      } else {
        remainingSeconds = Math.max(0, Math.floor((new Date(application.expires_at).getTime() - now) / 1000));
      }

      if (remainingSeconds <= 0) {
        const closing = "Our scheduled interview time has concluded. Thank you for your time; your responses have been submitted for evaluation.";
        res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: closing } }] })}\n\ndata: [DONE]\n\n`);
      }

      const roundNumber = (application.current_round || 0) + 1;
      let snapshot = application.interview_context_snapshot;
      if (!snapshot || typeof snapshot !== "object") {
        const [candidateResult, profileResult, roundResult] = await Promise.all([
          admin.from("candidate_profiles").select("full_name,summary,skills,technical_skills,work_experience,projects,education,experience_years").eq("user_id", req.user.id).maybeSingle(),
          admin.from("profiles").select("full_name,email").eq("user_id", req.user.id).maybeSingle(),
          admin.from("job_rounds").select("round_type,duration_minutes").eq("job_id", application.job_id).eq("round_number", roundNumber).maybeSingle(),
        ]);
        const candidate = candidateResult.data || {};
        const profile = profileResult.data || {};
        const job = application.jobs || {};
        snapshot = {
          candidate: {
            id: req.user.id,
            fullName: candidate.full_name?.trim() || profile.full_name?.trim() || profile.email?.split("@")[0] || input.candidateName || "Candidate",
            summary: candidate.summary || "",
            skills: candidate.skills?.length ? candidate.skills : candidate.technical_skills || [],
            workExperience: candidate.work_experience || [],
            projects: candidate.projects || [],
            education: candidate.education || [],
            experienceYears: candidate.experience_years,
          },
          job: {
            id: application.job_id,
            title: job.title || input.jobTitle || "Software Engineer",
            description: job.description || "",
            field: job.field || input.jobField || "Technology",
            requiredSkills: Array.isArray(job.required_skills) ? job.required_skills : [],
            responsibilities: [],
            toughnessLevel: String(job.toughness_level || input.toughnessLevel || "medium"),
          },
          round: { number: roundNumber, type: roundResult.data?.round_type || "Technical Screening", durationMinutes: roundResult.data?.duration_minutes, passingScore: 60 },
          createdAt: new Date().toISOString(),
        };
        const { error } = await admin.from("applications").update({ interview_context_snapshot: snapshot }).eq("id", application.id).eq("candidate_id", req.user.id);
        if (error) log("warn", "INTERVIEW_CONTEXT_SAVE_FAILED", { requestId: req.requestId, applicationId: application.id });
      }

      const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
      if (latestUserMessage) {
        const { error } = await admin.from("interview_transcripts").insert({ application_id: application.id, role: "candidate", content: latestUserMessage.content, phase: `round_${roundNumber}`, timestamp_ms: now });
        if (error) log("warn", "TRANSCRIPT_SAVE_FAILED", { requestId: req.requestId, applicationId: application.id });
      }

      let systemPrompt = buildInterviewPrompt({ candidate: snapshot.candidate, job: snapshot.job, durationSeconds: input.durationSeconds, remainingSeconds, roundNumber });
      if (latestUserMessage && isEndingConversation(latestUserMessage.content)) {
        systemPrompt += "\nThe candidate asked to end. Ask one short reason, allow them to decline, and request confirmation before finalization.";
      }
      log("info", "INTERVIEW_CONTEXT_READY", { requestId: req.requestId, candidateId: req.user.id, applicationId: application.id, roundNumber });
      const upstream = await callGroq(config, { model: config.groqModel, messages: [{ role: "system", content: systemPrompt }, ...input.messages], temperature: 0.4, max_tokens: 300, stream: true }, req.requestId);
      res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
      for await (const chunk of upstream.body) res.write(chunk);
      res.end();
    } catch (error) {
      log("error", "INTERVIEW_AGENT_FAILED", { requestId: req.requestId, candidateId: req.user.id, applicationId: input.applicationId, message: error.message });
      if (!res.headersSent) return apiError(res, error.status || 500, "INTERVIEW_AGENT_FAILED", error.status ? error.message : "The interviewer could not process this request", req.requestId);
      res.end();
    }
  });

  app.post("/api/bhashini-voice", async (req, res) => {
    const parsed = voiceSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid request", req.requestId);
    const input = parsed.data;
    const language = normalizeLanguage(input.language);
    try {
      if (input.action === "status") {
        return res.json({ configured: Boolean(config.bhashiniUserId && config.bhashiniApiKey), language, requestId: req.requestId });
      }
      if (input.action === "asr") {
        const data = await callBhashini(config, "asr", language, input.audioContent, input.samplingRate, "female");
        const transcript = String(data?.pipelineResponse?.[0]?.output?.[0]?.source || "").trim();
        return res.json({ transcript, fallbackPrompt: transcript ? null : "Sorry, I couldn't hear that clearly. Could you repeat your answer?", requestId: req.requestId });
      }
      const cleanText = input.text.replace(/```[\s\S]*?```/g, " code block ").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
      const data = await callBhashini(config, "tts", language, cleanText, 22050, input.gender);
      return res.json({ audioContent: data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent || "", requestId: req.requestId });
    } catch (error) {
      log("error", "BHASHINI_REQUEST_FAILED", { requestId: req.requestId, candidateId: req.user.id, action: input.action, message: error.message });
      return apiError(res, error.status || 500, "BHASHINI_REQUEST_FAILED", error.status ? error.message : "The speech service could not process this request", req.requestId);
    }
  });

  app.use((req, res) => apiError(res, 404, "NOT_FOUND", "Route not found", req.requestId));
  app.use((error, req, res, _next) => {
    log("error", "UNHANDLED_REQUEST_ERROR", { requestId: req.requestId, message: error.message });
    if (error?.type === "entity.too.large") return apiError(res, 413, "PAYLOAD_TOO_LARGE", "Request payload is too large", req.requestId);
    return apiError(res, 500, "INTERNAL_ERROR", "An unexpected server error occurred", req.requestId);
  });

  return { app, pool };
}
