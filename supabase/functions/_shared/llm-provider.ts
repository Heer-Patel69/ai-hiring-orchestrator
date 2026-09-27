// =============================================
// LLM PROVIDER ABSTRACTION
// Pluggable provider interface allowing seamless swaps
// =============================================

import { groqKeyManager, GroqExecuteOptions, GroqExecuteResult } from "./groq-key-manager.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequestOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" | "text" };
  timeoutMs?: number;
}

export interface LLMResponse {
  content: string;
  keyUsed: string;
  durationMs: number;
  model: string;
  status: number;
}

export interface LLMProvider {
  chat(options: LLMRequestOptions): Promise<LLMResponse>;
  chatStream(options: LLMRequestOptions): Promise<ReadableStream<Uint8Array>>;
  parseJSON<T = any>(content: string): T | null;
}

export class GroqLLMProvider implements LLMProvider {
  public async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    const result = await groqKeyManager.execute({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      response_format: options.responseFormat,
      stream: false,
      timeoutMs: options.timeoutMs,
    });

    if (!result.ok || !result.data) {
      throw new Error(result.error || `Groq request failed with status ${result.status}`);
    }

    const content = result.data?.choices?.[0]?.message?.content || "";
    return {
      content,
      keyUsed: result.keyUsed,
      durationMs: result.durationMs,
      model: result.data?.model || groqKeyManager.getModel(),
      status: result.status,
    };
  }

  public async chatStream(options: LLMRequestOptions): Promise<ReadableStream<Uint8Array>> {
    const result = await groqKeyManager.execute({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      timeoutMs: options.timeoutMs,
    });

    if (!result.ok || !result.stream) {
      throw new Error(result.error || `Groq stream failed with status ${result.status}`);
    }

    return result.stream;
  }

  public parseJSON<T = any>(content: string): T | null {
    if (!content) return null;
    try {
      // First try direct parse
      return JSON.parse(content);
    } catch {
      // Fallback: extract markdown codeblock or first outer braces/brackets
      try {
        const markdownMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (markdownMatch) {
          return JSON.parse(markdownMatch[1]);
        }
        const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        console.warn("[GroqLLMProvider] Failed to parse JSON from response:", err);
      }
    }
    return null;
  }
}

export const llmProvider: LLMProvider = new GroqLLMProvider();
