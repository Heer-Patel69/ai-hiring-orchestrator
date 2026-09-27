/**
 * Canonical Candidate Identity Resolution System
 * 
 * Strict resolution order:
 * 1. candidate_profiles.full_name
 * 2. profiles.full_name
 * 3. parsed resume fullName
 * 4. auth user metadata full_name / display_name
 * 5. verified email local-part prefix as last fallback
 * 6. "Candidate" (only when absolutely nothing exists)
 * 
 * NEVER returns random phone suffixes like "Candidate (2555)".
 */

import { supabase } from "@/integrations/supabase/client";

export interface CandidateIdentitySource {
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
  fullName?: string | null;
  displayName?: string | null;
  raw_user_meta_data?: {
    full_name?: string | null;
    name?: string | null;
  } | null;
}

export interface CandidateIdentityOptions {
  profile?: CandidateIdentitySource | null;
  candidateProfile?: CandidateIdentitySource | null;
  resumeData?: { fullName?: string | null } | null;
  fallbackEmail?: string | null;
}

export function formatEmailPrefix(email?: string | null): string {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return "";
  }
  const prefix = email.split("@")[0].trim();
  if (!prefix) return "";

  // Split on dots, underscores, dashes
  const parts = prefix.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return prefix;

  // Capitalize each part
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Universal resolver: supports both options object and positional arguments.
 * Ensures caller NEVER gets "Candidate" due to argument shape mismatch.
 */
export function getCandidateDisplayName(
  profileOrOptions?: CandidateIdentitySource | CandidateIdentityOptions | null,
  candidateProfile?: CandidateIdentitySource | null,
  resumeData?: { fullName?: string | null } | null,
  fallbackEmail?: string | null
): string {
  let profile: CandidateIdentitySource | null | undefined;
  let candProfile: CandidateIdentitySource | null | undefined = candidateProfile;
  let resume: { fullName?: string | null } | null | undefined = resumeData;
  let emailFallback: string | null | undefined = fallbackEmail;

  if (profileOrOptions && typeof profileOrOptions === "object") {
    // Check if passed as an options object { profile, candidateProfile, resumeData, fallbackEmail }
    if ("profile" in profileOrOptions || "candidateProfile" in profileOrOptions) {
      const opts = profileOrOptions as CandidateIdentityOptions;
      profile = opts.profile;
      candProfile = opts.candidateProfile ?? candProfile;
      resume = opts.resumeData ?? resume;
      emailFallback = opts.fallbackEmail ?? emailFallback;
    } else {
      profile = profileOrOptions as CandidateIdentitySource;
    }
  }

  // 1. candidate_profiles table full_name
  if (candProfile?.full_name && typeof candProfile.full_name === "string") {
    const trimmed = candProfile.full_name.trim();
    if (trimmed.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(trimmed)) {
      return trimmed;
    }
  }

  // 2. profiles table full_name
  if (profile?.full_name && typeof profile.full_name === "string") {
    const trimmed = profile.full_name.trim();
    if (trimmed.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(trimmed)) {
      return trimmed;
    }
  }

  // 3. Parsed resume fullName
  if (resume?.fullName && typeof resume.fullName === "string") {
    const trimmed = resume.fullName.trim();
    if (trimmed.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(trimmed)) {
      return trimmed;
    }
  }

  // 4. Authenticated account display name or metadata
  const metaName =
    profile?.raw_user_meta_data?.full_name ||
    profile?.raw_user_meta_data?.name ||
    profile?.displayName ||
    profile?.name;
  if (metaName && typeof metaName === "string") {
    const trimmed = metaName.trim();
    if (trimmed.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(trimmed)) {
      return trimmed;
    }
  }

  // 5. Verified email prefix as last fallback
  const emailCandidate = profile?.email || candProfile?.email || emailFallback;
  if (emailCandidate) {
    const formatted = formatEmailPrefix(emailCandidate);
    if (formatted.length > 0) {
      return formatted;
    }
  }

  // 6. Default fallback (NEVER a phone number slice)
  return "Candidate";
}

/**
 * Authoritative async resolver: queries database to resolve the real candidate name
 * Priority: candidate_profiles -> profiles -> user metadata -> email -> "Candidate"
 */
export async function resolveCandidateIdentity(candidateId: string): Promise<string> {
  if (!candidateId) return "Candidate";

  try {
    const [candProfileRes, profileRes] = await Promise.all([
      supabase
        .from("candidate_profiles")
        .select("full_name")
        .eq("user_id", candidateId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", candidateId)
        .maybeSingle(),
    ]);

    const candName = candProfileRes.data?.full_name?.trim();
    if (candName && candName.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(candName)) {
      return candName;
    }

    const profName = profileRes.data?.full_name?.trim();
    if (profName && profName.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(profName)) {
      return profName;
    }

    if (profileRes.data?.email) {
      const emailName = formatEmailPrefix(profileRes.data.email);
      if (emailName) return emailName;
    }
  } catch (err) {
    console.warn("Error resolving candidate identity from database:", err);
  }

  return "Candidate";
}

/**
 * Standardize round progress string e.g. 1/5, 2/5
 */
export function formatRoundProgress(currentRound: number, totalRounds: number): string {
  const safeTotal = Math.max(1, totalRounds || 1);
  const safeCurrent = Math.min(Math.max(0, currentRound || 0), safeTotal);
  return `${safeCurrent}/${safeTotal}`;
}
