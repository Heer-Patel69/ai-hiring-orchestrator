/**
 * Canonical Candidate Identity Resolution System
 * 
 * Strict resolution order:
 * 1. candidate profile full_name (from profiles.full_name or candidate_profiles.full_name)
 * 2. parsed resume fullName
 * 3. authenticated account display name
 * 4. verified email prefix as last fallback
 * 5. only if absolutely nothing exists: "Candidate"
 * 
 * NEVER returns random phone suffixes like "Candidate (2555)".
 */

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

export function getCandidateDisplayName(
  profile?: CandidateIdentitySource | null,
  candidateProfile?: CandidateIdentitySource | null,
  resumeData?: { fullName?: string | null } | null,
  fallbackEmail?: string | null
): string {
  // 1. Candidate profile full_name (profiles table)
  if (profile?.full_name && typeof profile.full_name === "string") {
    const trimmed = profile.full_name.trim();
    if (trimmed.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(trimmed)) {
      return trimmed;
    }
  }

  // 1b. candidate_profiles table full_name
  if (candidateProfile?.full_name && typeof candidateProfile.full_name === "string") {
    const trimmed = candidateProfile.full_name.trim();
    if (trimmed.length > 0 && !/^Candidate\s*\(\d+\)$/i.test(trimmed)) {
      return trimmed;
    }
  }

  // 2. Parsed resume fullName
  if (resumeData?.fullName && typeof resumeData.fullName === "string") {
    const trimmed = resumeData.fullName.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  // 3. Authenticated account display name or metadata
  const metaName =
    profile?.raw_user_meta_data?.full_name ||
    profile?.raw_user_meta_data?.name ||
    profile?.displayName;
  if (metaName && typeof metaName === "string") {
    const trimmed = metaName.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  // 4. Verified email prefix as last fallback
  const emailCandidate = profile?.email || candidateProfile?.email || fallbackEmail;
  if (emailCandidate) {
    const formatted = formatEmailPrefix(emailCandidate);
    if (formatted.length > 0) {
      return formatted;
    }
  }

  // 5. Default fallback (NEVER a phone number slice)
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
