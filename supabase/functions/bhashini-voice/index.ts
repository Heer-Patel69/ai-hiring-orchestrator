import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { bhashiniSTT, bhashiniTTS } from "../_shared/bhashini-services.ts";
import { getBhashiniCredentials, normalizeLanguageCode } from "../_shared/bhashini-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const normLang = normalizeLanguageCode(language);

    // 1. Health / Config check
    if (action === "status") {
      const creds = getBhashiniCredentials();
      return new Response(
        JSON.stringify({
          configured: creds.isConfigured,
          userIdConfigured: Boolean(creds.userId),
          apiKeyConfigured: Boolean(creds.apiKey),
          pipelineId: creds.pipelineId,
          language: normLang,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Speech-to-Text (ASR)
    if (action === "asr") {
      if (!audioContent) {
        return new Response(
          JSON.stringify({ error: "audioContent (base64) is required for ASR" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const transcript = await bhashiniSTT.transcribe(audioContent, normLang, samplingRate);

      return new Response(
        JSON.stringify({
          transcript: transcript || "",
          fallbackPrompt: transcript ? null : "Sorry, I couldn't hear that clearly. Could you repeat your answer?",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Text-to-Speech (TTS)
    if (action === "tts") {
      if (!text) {
        return new Response(
          JSON.stringify({ error: "text is required for TTS" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const audioContent = await bhashiniTTS.synthesize(text, normLang, gender);

      return new Response(
        JSON.stringify({ audioContent }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'asr', 'tts', or 'status'." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[bhashini-voice] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error in Bhashini voice service",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
