/**
 * Direct Groq LLM Service for AI Hiring Orchestrator
 * Calls the Groq OpenAI-compatible API directly using user-configured Groq API keys,
 * ensuring immediate usage metrics on the Groq Dashboard and minimal latency.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const FALLBACK_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

export interface GroqChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function getGroqApiKey(): string {
  return (import.meta.env.VITE_GROQ_API_KEY || "").trim();
}

export function getGroqModel(): string {
  return (
    import.meta.env.VITE_GROQ_MODEL ||
    DEFAULT_MODEL
  ).trim();
}

export async function askGroqStream(
  messages: GroqChatMessage[],
  onChunk: (chunk: string, fullText: string) => void,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error("No Groq API key available in client environment");
  }

  const primaryModel = options?.model || getGroqModel();
  const candidateModels = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));

  let lastError: Error | null = null;
  for (const model of candidateModels) {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          reasoning_format: "hidden",
          temperature: options?.temperature ?? 0.6,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Groq API error (${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body from Groq stream");

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta;
            const textChunk = delta?.content || delta?.reasoning;
            if (textChunk) {
              fullText += textChunk;
              onChunk(textChunk, fullText);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      if (fullText.trim().length > 0) {
        return fullText;
      }
    } catch (err: any) {
      console.warn(`Groq streaming failed with model ${model}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to receive stream from Groq");
}

export async function askGroq(
  messages: GroqChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error("No Groq API key available in client environment");
  }

  const primaryModel = options?.model || getGroqModel();
  const candidateModels = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));

  let lastError: Error | null = null;
  for (const model of candidateModels) {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          reasoning_format: "hidden",
          temperature: options?.temperature ?? 0.6,
          max_tokens: options?.maxTokens ?? 1024,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Groq API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0]?.message;
      const result = (choice?.content || choice?.reasoning || "").trim();
      if (result.length > 0) {
        return result;
      }
    } catch (err: any) {
      console.warn(`Groq completion failed with model ${model}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to receive response from Groq");
}
