// =============================================
// GROQ KEY MANAGER & HEALTH GOVERNOR
// Multi-Key Round-Robin, Automatic Failover, Cooldown & Concurrency Safety
// =============================================

export type KeyStatus = "ACTIVE" | "RATE_LIMITED" | "INVALID" | "TEMPORARILY_UNAVAILABLE";

export interface KeyHealthState {
  keyId: string;           // Masked identifier e.g. gsk_****64eW
  rawKey: string;          // Full key used only for Authorization headers
  status: KeyStatus;
  cooldownUntil: number;   // Timestamp (ms)
  failureCount: number;
  lastUsed: number;        // Timestamp (ms)
  lastError?: string;
  sourceEnv: string;       // e.g. GROQ_API_KEY_1
}

export interface GroqExecuteOptions {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: { type: "json_object" | "text" };
  timeoutMs?: number;
}

export interface GroqExecuteResult {
  ok: boolean;
  status: number;
  data?: any;
  stream?: ReadableStream<Uint8Array>;
  keyUsed: string;         // Masked key ID
  durationMs: number;
  error?: string;
}

class GroqKeyManagerService {
  private keys: KeyHealthState[] = [];
  private roundRobinIndex = 0;
  private defaultModel: string;
  private baseUrl: string;
  private initialized = false;

  constructor() {
    this.defaultModel = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
    this.baseUrl = Deno.env.get("GROQ_BASE_URL") || "https://api.groq.com/openai/v1";
    this.initializeKeys();
  }

  /**
   * Discovers and registers all GROQ_API_KEY_* from environment variables
   */
  public initializeKeys(): void {
    const discoveredKeys: KeyHealthState[] = [];
    const envVars = Deno.env.toObject ? Deno.env.toObject() : {};

    // 1. Scan numbered keys: GROQ_API_KEY_1, GROQ_API_KEY_2, etc.
    const keyEnvNames = Object.keys(envVars)
      .filter((k) => /^GROQ_API_KEY(_\d+)?$/i.test(k))
      .sort();

    // If Deno.env.toObject didn't catch or on edge platform, also probe up to 10 indices
    if (keyEnvNames.length === 0) {
      for (let i = 1; i <= 10; i++) {
        const val = Deno.env.get(`GROQ_API_KEY_${i}`);
        if (val && val.trim().length > 0) {
          discoveredKeys.push(this.createKeyState(`GROQ_API_KEY_${i}`, val.trim()));
        }
      }
      const single = Deno.env.get("GROQ_API_KEY");
      if (single && single.trim().length > 0 && !discoveredKeys.some((k) => k.rawKey === single.trim())) {
        discoveredKeys.push(this.createKeyState("GROQ_API_KEY", single.trim()));
      }
    } else {
      for (const name of keyEnvNames) {
        const val = envVars[name];
        if (val && val.trim().length > 0) {
          discoveredKeys.push(this.createKeyState(name, val.trim()));
        }
      }
    }

    this.keys = discoveredKeys;
    this.initialized = true;
    console.log(`[GroqKeyManager] Initialized ${this.keys.length} Groq API keys.`);
  }

  private maskKey(key: string): string {
    if (!key) return "unknown";
    if (key.length <= 10) return `${key.slice(0, 3)}****`;
    const prefix = key.slice(0, 4);
    const suffix = key.slice(-4);
    return `${prefix}****${suffix}`;
  }

  private createKeyState(sourceEnv: string, rawKey: string): KeyHealthState {
    return {
      keyId: this.maskKey(rawKey),
      rawKey,
      status: "ACTIVE",
      cooldownUntil: 0,
      failureCount: 0,
      lastUsed: 0,
      sourceEnv,
    };
  }

  public getModel(): string {
    return Deno.env.get("GROQ_MODEL") || this.defaultModel;
  }

  public getBaseUrl(): string {
    return Deno.env.get("GROQ_BASE_URL") || this.baseUrl;
  }

  /**
   * Health snapshot for monitoring/admin
   */
  public getStatusSnapshot() {
    this.refreshCooldowns();
    return {
      totalKeys: this.keys.length,
      activeKeys: this.keys.filter((k) => k.status === "ACTIVE").length,
      rateLimitedKeys: this.keys.filter((k) => k.status === "RATE_LIMITED").length,
      invalidKeys: this.keys.filter((k) => k.status === "INVALID").length,
      unavailableKeys: this.keys.filter((k) => k.status === "TEMPORARILY_UNAVAILABLE").length,
      model: this.getModel(),
      keys: this.keys.map((k) => ({
        keyId: k.keyId,
        source: k.sourceEnv,
        status: k.status,
        failureCount: k.failureCount,
        lastUsed: k.lastUsed ? new Date(k.lastUsed).toISOString() : null,
        cooldownRemainingSec: Math.max(0, Math.round((k.cooldownUntil - Date.now()) / 1000)),
        lastError: k.lastError || null,
      })),
    };
  }

  private refreshCooldowns(): void {
    const now = Date.now();
    for (const key of this.keys) {
      if (
        (key.status === "RATE_LIMITED" || key.status === "TEMPORARILY_UNAVAILABLE") &&
        key.cooldownUntil > 0 &&
        now >= key.cooldownUntil
      ) {
        key.status = "ACTIVE";
        key.cooldownUntil = 0;
        console.log(`[GroqKeyManager] Key ${key.keyId} cooldown expired. Marked ACTIVE.`);
      }
    }
  }

  /**
   * Selects an ordered list of candidate keys starting with round-robin among ACTIVE keys
   */
  private getCandidateKeys(): KeyHealthState[] {
    this.refreshCooldowns();

    if (this.keys.length === 0) {
      this.initializeKeys();
    }

    const healthy = this.keys.filter((k) => k.status === "ACTIVE");
    if (healthy.length === 0) return [];

    // Distribute evenly via round-robin
    const startIndex = this.roundRobinIndex % healthy.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % 10000;

    const ordered: KeyHealthState[] = [];
    for (let i = 0; i < healthy.length; i++) {
      ordered.push(healthy[(startIndex + i) % healthy.length]);
    }
    return ordered;
  }

  /**
   * Executes a Groq completion or stream with automatic failover and cooldown management
   */
  public async execute(options: GroqExecuteOptions): Promise<GroqExecuteResult> {
    const candidateKeys = this.getCandidateKeys();

    if (candidateKeys.length === 0) {
      console.warn("[GroqKeyManager] No active Groq keys available. All keys rate-limited or unconfigured.");
      return {
        ok: false,
        status: 429,
        keyUsed: "none",
        durationMs: 0,
        error: "AI service is temporarily busy. Please retry shortly.",
      };
    }

    const model = options.model || this.getModel();
    const endpoint = `${this.getBaseUrl()}/chat/completions`;
    const timeoutMs = options.timeoutMs || 35000;

    // Try each available key at most once per request
    for (let i = 0; i < candidateKeys.length; i++) {
      const keyState = candidateKeys[i];
      const startTime = Date.now();
      keyState.lastUsed = startTime;

      console.log(`[GroqKeyManager] Attempting request using key ${keyState.keyId} (attempt ${i + 1}/${candidateKeys.length}) [model: ${model}]`);

      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const bodyPayload: Record<string, unknown> = {
          model,
          messages: options.messages,
          temperature: options.temperature ?? 0.3,
          stream: options.stream ?? false,
        };

        if (options.max_tokens) {
          bodyPayload.max_tokens = options.max_tokens;
        }

        if (options.response_format) {
          bodyPayload.response_format = options.response_format;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${keyState.rawKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTime;

        // 1. Success
        if (res.ok) {
          keyState.failureCount = 0;
          keyState.lastError = undefined;

          if (options.stream) {
            return {
              ok: true,
              status: res.status,
              stream: res.body as ReadableStream<Uint8Array>,
              keyUsed: keyState.keyId,
              durationMs,
            };
          }

          const json = await res.json();
          return {
            ok: true,
            status: res.status,
            data: json,
            keyUsed: keyState.keyId,
            durationMs,
          };
        }

        // 2. Handle HTTP 429: Rate limit hit
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get("Retry-After") || res.headers.get("x-ratelimit-reset-requests");
          let cooldownMs = 60000; // Default 60s
          if (retryAfterHeader) {
            const parsed = parseFloat(retryAfterHeader);
            if (!isNaN(parsed) && parsed > 0) {
              cooldownMs = Math.min(parsed * 1000, 300000);
            }
          }

          keyState.status = "RATE_LIMITED";
          keyState.cooldownUntil = Date.now() + cooldownMs;
          keyState.failureCount += 1;
          keyState.lastError = `Rate limit (429). Cooldown for ${Math.round(cooldownMs / 1000)}s`;

          console.warn(`[GroqKeyManager] Key ${keyState.keyId} RATE_LIMITED (429). Setting cooldown for ${Math.round(cooldownMs / 1000)}s. Failing over to next key.`);
          continue; // Try next key
        }

        // 3. Handle 401 / 403: Authentication or Invalid Key
        if (res.status === 401 || res.status === 403) {
          keyState.status = "INVALID";
          keyState.cooldownUntil = Infinity;
          keyState.lastError = `Authentication failed (${res.status}). Marked INVALID.`;
          console.error(`[GroqKeyManager] Key ${keyState.keyId} INVALID (HTTP ${res.status}). Marked permanently INVALID.`);
          continue; // Try next key
        }

        // 4. Other 5xx / 503 / 500 error
        const errText = await res.text();
        keyState.failureCount += 1;
        keyState.lastError = `Server error ${res.status}: ${errText.slice(0, 150)}`;
        console.warn(`[GroqKeyManager] Key ${keyState.keyId} failed with ${res.status}. Error: ${errText.slice(0, 150)}`);

        if (res.status >= 500) {
          keyState.status = "TEMPORARILY_UNAVAILABLE";
          keyState.cooldownUntil = Date.now() + 30000; // 30s cooldown
        }

        continue; // Try next key
      } catch (err: any) {
        clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTime;
        const isAbort = err?.name === "AbortError";
        keyState.failureCount += 1;
        keyState.lastError = isAbort ? "Request timed out" : (err?.message || "Network error");

        console.warn(`[GroqKeyManager] Network/Timeout error on key ${keyState.keyId}: ${keyState.lastError}. Failing over.`);

        if (isAbort) {
          keyState.status = "TEMPORARILY_UNAVAILABLE";
          keyState.cooldownUntil = Date.now() + 20000;
        }

        continue; // Try next key
      }
    }

    // All candidate keys failed
    console.error("[GroqKeyManager] All available Groq keys failed or rate-limited for this request.");
    return {
      ok: false,
      status: 503,
      keyUsed: "exhausted",
      durationMs: 0,
      error: "AI service is temporarily busy. Please retry shortly.",
    };
  }
}

export const groqKeyManager = new GroqKeyManagerService();
