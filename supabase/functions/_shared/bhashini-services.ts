// =============================================
// BHASHINI STT & TTS ISOLATED SERVICES
// Production-grade Speech-to-Text and Text-to-Speech
// =============================================

import { getBhashiniCredentials, normalizeLanguageCode } from "./bhashini-config.ts";

export interface SpeechToTextProvider {
  transcribe(audioBase64: string, language?: string, samplingRate?: number): Promise<string>;
}

export interface TextToSpeechProvider {
  synthesize(text: string, language?: string, gender?: "female" | "male"): Promise<string>;
}

interface PipelineConfig {
  callbackUrl: string;
  authHeaderName: string;
  authHeaderValue: string;
  serviceId: string;
  samplingRate?: number;
  fetchedAt: number;
}

const AUTH_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";
const configCache = new Map<string, PipelineConfig>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function getPipelineConfig(task: "asr" | "tts", language: string): Promise<PipelineConfig> {
  const normLang = normalizeLanguageCode(language);
  const cacheKey = `${task}:${normLang}`;
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const { userId, apiKey, pipelineId, isConfigured } = getBhashiniCredentials();
  if (!isConfigured) {
    throw new Error("Bhashini credentials are not configured (BHASHINI_UDYAT_KEY / BHASHINI_INFERENCE_KEY)");
  }

  const body = {
    pipelineTasks: [
      task === "asr"
        ? { taskType: "asr", config: { language: { sourceLanguage: normLang } } }
        : { taskType: "tts", config: { language: { sourceLanguage: normLang } } },
    ],
    pipelineRequestConfig: { pipelineId },
  };

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      userID: userId,
      ulcaApiKey: apiKey,
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
    throw new Error("Bhashini pipeline config missing serviceId or callbackUrl");
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

export class BhashiniSTTService implements SpeechToTextProvider {
  public async transcribe(audioBase64: string, language = "en", samplingRate = 16000): Promise<string> {
    if (!audioBase64) {
      throw new Error("audioContent (base64) is required for speech-to-text");
    }

    const normLang = normalizeLanguageCode(language);

    try {
      const cfg = await getPipelineConfig("asr", normLang);
      const startTime = Date.now();

      const res = await fetch(cfg.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [cfg.authHeaderName]: cfg.authHeaderValue,
        },
        body: JSON.stringify({
          pipelineTasks: [
            {
              taskType: "asr",
              config: {
                language: { sourceLanguage: normLang },
                serviceId: cfg.serviceId,
                audioFormat: "wav",
                samplingRate,
                livenessCheck: false,
              },
            },
          ],
          inputData: { audio: [{ audioContent: audioBase64 }] },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BhashiniSTT] Inference error ${res.status}: ${errorText.slice(0, 200)}`);
        return "";
      }

      const result = await res.json();
      const transcript = (result?.pipelineResponse?.[0]?.output?.[0]?.source ?? "").trim();
      const durationMs = Date.now() - startTime;
      console.log(`[BhashiniSTT] ASR transcribed in ${durationMs}ms [chars: ${transcript.length}]`);
      return transcript;
    } catch (err: any) {
      console.error("[BhashiniSTT] Error during transcription:", err);
      // Return empty transcript so caller can invoke graceful retry prompt
      return "";
    }
  }
}

export class BhashiniTTSService implements TextToSpeechProvider {
  public async synthesize(text: string, language = "en", gender: "female" | "male" = "female"): Promise<string> {
    const cleanText = text
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/[*_`#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText) return "";

    const normLang = normalizeLanguageCode(language);

    try {
      const cfg = await getPipelineConfig("tts", normLang);
      const startTime = Date.now();

      const res = await fetch(cfg.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [cfg.authHeaderName]: cfg.authHeaderValue,
        },
        body: JSON.stringify({
          pipelineTasks: [
            {
              taskType: "tts",
              config: {
                language: { sourceLanguage: normLang },
                serviceId: cfg.serviceId,
                gender,
                samplingRate: 22050,
              },
            },
          ],
          inputData: { input: [{ source: cleanText }] },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BhashiniTTS] Inference error ${res.status}: ${errorText.slice(0, 200)}`);
        return "";
      }

      const result = await res.json();
      const audioBase64 = result?.pipelineResponse?.[0]?.audio?.[0]?.audioContent ?? "";
      const durationMs = Date.now() - startTime;
      console.log(`[BhashiniTTS] TTS synthesized in ${durationMs}ms [audio len: ${audioBase64.length}]`);
      return audioBase64;
    } catch (err: any) {
      console.error("[BhashiniTTS] Error during synthesis:", err);
      return "";
    }
  }
}

export const bhashiniSTT = new BhashiniSTTService();
export const bhashiniTTS = new BhashiniTTSService();
