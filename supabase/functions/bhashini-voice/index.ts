import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUTH_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";
const DEFAULT_PIPELINE_ID = "64392f96daac500b55c543cd"; // MeitY / AI4Bharat pipeline

type Task = "asr" | "tts";

interface PipelineConfig {
  callbackUrl: string;
  authHeaderName: string;
  authHeaderValue: string;
  serviceId: string;
  samplingRate?: number;
  fetchedAt: number;
}

// In-memory cache so we skip the (slow) pipeline-config round trip on every request.
const configCache = new Map<string, PipelineConfig>();
const CACHE_TTL_MS = 30 * 60 * 1000;

async function getPipelineConfig(task: Task, language: string): Promise<PipelineConfig> {
  const cacheKey = `${task}:${language}`;
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const userId = Deno.env.get("BHASHINI_USER_ID");
  const ulcaApiKey = Deno.env.get("BHASHINI_ULCA_API_KEY");
  const pipelineId = Deno.env.get("BHASHINI_PIPELINE_ID") || DEFAULT_PIPELINE_ID;

  if (!userId || !ulcaApiKey) {
    throw new Error("Bhashini credentials are not configured (BHASHINI_USER_ID / BHASHINI_ULCA_API_KEY)");
  }

  const body: Record<string, unknown> = {
    pipelineTasks: [
      task === "asr"
        ? { taskType: "asr", config: { language: { sourceLanguage: language } } }
        : { taskType: "tts", config: { language: { sourceLanguage: language } } },
    ],
    pipelineRequestConfig: { pipelineId },
  };

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      userID: userId,
      ulcaApiKey: ulcaApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bhashini pipeline config failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const pipelineTask = data?.pipelineResponseConfig?.[0];
  const serviceId = pipelineTask?.config?.[0]?.serviceId;
  const inference = data?.pipelineInferenceAPIEndPoint;

  if (!serviceId || !inference?.callbackUrl) {
    throw new Error("Bhashini pipeline config response missing serviceId or callbackUrl");
  }

  const config: PipelineConfig = {
    callbackUrl: inference.callbackUrl,
    authHeaderName: inference.inferenceApiKey?.name ?? "Authorization",
    authHeaderValue: inference.inferenceApiKey?.value ?? "",
    serviceId,
    samplingRate: pipelineTask?.config?.[0]?.modelProcessingType?.samplingRate,
    fetchedAt: Date.now(),
  };

  configCache.set(cacheKey, config);
  return config;
}

async function callInference(cfg: PipelineConfig, payload: unknown) {
  const res = await fetch(cfg.callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [cfg.authHeaderName]: cfg.authHeaderValue,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bhashini inference failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      action,
      audioContent,
      text,
      language = "en",
      gender = "female",
      samplingRate = 16000,
    } = await req.json();

    if (action === "asr") {
      if (!audioContent) throw new Error("audioContent (base64 wav) is required for ASR");
      const cfg = await getPipelineConfig("asr", language);
      const result = await callInference(cfg, {
        pipelineTasks: [
          {
            taskType: "asr",
            config: {
              language: { sourceLanguage: language },
              serviceId: cfg.serviceId,
              audioFormat: "wav",
              samplingRate,
livenessCheck: false,
            },
          },
        ],
        inputData: { audio: [{ audioContent }] },
      });

      const transcript = result?.pipelineResponse?.[0]?.output?.[0]?.source ?? "";
      return new Response(JSON.stringify({ transcript }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "tts") {
      if (!text) throw new Error("text is required for TTS");
      const cfg = await getPipelineConfig("tts", language);
      const result = await callInference(cfg, {
        pipelineTasks: [
          {
            taskType: "tts",
            config: {
              language: { sourceLanguage: language },
              serviceId: cfg.serviceId,
              gender,
              samplingRate: 22050,
            },
          },
        ],
        inputData: { input: [{ source: text }] },
      });

      const audioBase64 = result?.pipelineResponse?.[0]?.audio?.[0]?.audioContent ?? "";
      return new Response(JSON.stringify({ audioContent: audioBase64 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unknown action. Use 'asr' or 'tts'.");
  } catch (error) {
    console.error("bhashini-voice error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
