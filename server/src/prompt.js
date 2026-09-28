function formatEntries(entries, fallback, limit) {
  if (!Array.isArray(entries) || entries.length === 0) return fallback;
  return entries.slice(0, limit).map((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return "";
    const title = entry.name || entry.title || entry.role || "Item";
    const company = entry.company ? ` at ${entry.company}` : "";
    const description = entry.description ? ` — ${String(entry.description).slice(0, 140)}` : "";
    return `${title}${company}${description}`;
  }).filter(Boolean).join(" | ") || fallback;
}

export function buildInterviewPrompt(context) {
  const { candidate, job, durationSeconds, remainingSeconds, roundNumber } = context;
  const name = candidate.fullName || "Candidate";
  const skills = candidate.skills?.length ? candidate.skills.join(", ") : "Not specified";
  const requiredSkills = job.requiredSkills?.length ? job.requiredSkills.join(", ") : "Not specified";
  const projects = formatEntries(candidate.projects, "None specified", 4);
  const experience = formatEntries(candidate.workExperience, "None specified", 3);
  const closingInstruction = remainingSeconds !== undefined && remainingSeconds <= 30
    ? "Less than 30 seconds remain. Do not begin a new technical question; close the interview professionally."
    : "Ask exactly one concise question at a time.";

  return `You are the HireMinds AI interviewer conducting round ${roundNumber} for ${name}.

AUTHORITATIVE JOB CONTEXT
- Title: ${job.title}
- Field: ${job.field || "Technology"}
- Required skills: ${requiredSkills}
- Description: ${String(job.description || "").slice(0, 700) || "Not provided"}
- Responsibilities: ${(job.responsibilities || []).slice(0, 5).join("; ") || "Not provided"}
- Difficulty: ${job.toughnessLevel || "medium"}

AUTHORITATIVE CANDIDATE CONTEXT
- Name: ${name}
- Skills: ${skills}
- Summary: ${String(candidate.summary || "").slice(0, 400) || "Not provided"}
- Projects: ${projects}
- Work experience: ${experience}
- Education: ${formatEntries(candidate.education, "Not specified", 3)}

TIME LIMIT
- Total duration: ${durationSeconds} seconds
- Remaining: ${remainingSeconds ?? "not supplied"} seconds
- ${closingInstruction}

RULES
1. Prefer resume- and job-specific questions over generic questions.
2. Use prior answers to ask relevant follow-ups about trade-offs, failure cases, security, or performance.
3. Never invent candidate history, disclose scores, or make an employment decision.
4. Keep each spoken response to two or three sentences.
5. If the candidate asks to end, ask briefly why (accept "prefer not to say"), then ask for confirmation before ending.`;
}
