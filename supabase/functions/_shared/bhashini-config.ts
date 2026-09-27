// =============================================
// BHASHINI CENTRALIZED CONFIGURATION & LANGUAGE REGISTRY
// =============================================

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  asrSupported: boolean;
  ttsSupported: boolean;
}

export const BHASHINI_LANGUAGES: Record<string, SupportedLanguage> = {
  en: { code: "en", name: "English", nativeName: "English", asrSupported: true, ttsSupported: true },
  hi: { code: "hi", name: "Hindi", nativeName: "हिन्दी", asrSupported: true, ttsSupported: true },
  gu: { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", asrSupported: true, ttsSupported: true },
  mr: { code: "mr", name: "Marathi", nativeName: "मराठी", asrSupported: true, ttsSupported: true },
  ta: { code: "ta", name: "Tamil", nativeName: "தமிழ்", asrSupported: true, ttsSupported: true },
  te: { code: "te", name: "Telugu", nativeName: "తెలుగు", asrSupported: true, ttsSupported: true },
  bn: { code: "bn", name: "Bengali", nativeName: "বাংলা", asrSupported: true, ttsSupported: true },
  kn: { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", asrSupported: true, ttsSupported: true },
  ml: { code: "ml", name: "Malayalam", nativeName: "മലയാളം", asrSupported: true, ttsSupported: true },
  pa: { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", asrSupported: true, ttsSupported: true },
  or: { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", asrSupported: true, ttsSupported: true },
  as: { code: "as", name: "Assamese", nativeName: "অসমীয়া", asrSupported: true, ttsSupported: true },
};

export function getBhashiniCredentials() {
  const userId =
    Deno.env.get("BHASHINI_USER_ID") ||
    Deno.env.get("BHASHINI_UDYAT_KEY") ||
    "";

  const apiKey =
    Deno.env.get("BHASHINI_INFERENCE_KEY") ||
    Deno.env.get("BHASHINI_ULCA_API_KEY") ||
    "";

  const pipelineId =
    Deno.env.get("BHASHINI_PIPELINE_ID") ||
    "64392f96daac500b55c543cd"; // Standard MeitY / AI4Bharat pipeline

  return {
    userId: userId.trim(),
    apiKey: apiKey.trim(),
    pipelineId: pipelineId.trim(),
    isConfigured: Boolean(userId.trim() && apiKey.trim()),
  };
}

export function normalizeLanguageCode(lang?: string): string {
  if (!lang) return "en";
  const cleaned = lang.toLowerCase().trim().slice(0, 2);
  return BHASHINI_LANGUAGES[cleaned] ? cleaned : "en";
}
