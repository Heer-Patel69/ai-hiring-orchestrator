import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Education {
  degree: string;
  institution: string;
  year?: number | string;
  field?: string;
  gpa?: string;
}

interface WorkExperience {
  company: string;
  role: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  duration?: string;
  description: string;
  skills?: string[];
  technologies?: string[];
}

interface Project {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
}

export interface StrictResumeData {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  skills: string[];
  technicalSkills: string[];
  softSkills: string[];
  experience_years: number;
  experience: WorkExperience[];
  workExperience?: WorkExperience[];
  projects: Project[];
  education: Education[];
  certifications: string[];
  github: string | null;
  linkedin: string | null;
  portfolio: string | null;
  github_url?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  validation_warnings?: string[];
}

/**
 * Server-side fallback text extraction for uncompressed ASCII or basic stream tokens
 */
function extractFallbackTextFromBase64(base64: string): string {
  try {
    const binary = atob(base64.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    const fullString = decoder.decode(bytes);

    // 1. Literal PDF strings
    const tjMatches = fullString.match(/\(([^)]{2,})\)\s*(?:Tj|'|")/g);
    if (tjMatches && tjMatches.length > 5) {
      return tjMatches
        .map((m) => m.replace(/^\(/, "").replace(/\)\s*(?:Tj|'|")$/, ""))
        .join(" ")
        .slice(0, 20000);
    }

    // 2. Scan printable chunks
    const printableMatches = fullString.match(/[A-Za-z0-9@._:\-\+\#\s\/\(\)]{4,}/g);
    if (printableMatches) {
      const clean = printableMatches
        .filter((s) => !/^(obj|endobj|stream|endstream|xref|trailer|startxref|Filter|FlateDecode)/i.test(s.trim()))
        .join(" ");
      if (clean.length > 150) {
        return clean.slice(0, 20000);
      }
    }

    return "";
  } catch (err) {
    console.warn("Fallback extraction failed:", err);
    return "";
  }
}

async function parseResumeWithGroq(rawText: string): Promise<StrictResumeData | null> {
  const prompt = `You are a strict, factual resume parser.
Extract information from the provided resume text into this exact JSON schema.

CRITICAL RULES:
1. NEVER invent, hallucinate, or guess missing information.
2. If a field is not explicitly present in the resume text, return null, empty string, or empty array.
3. For fullName: Extract the candidate's real legal or professional name. Do NOT return "Candidate" or phone numbers.
4. For skills: Extract only technologies, languages, frameworks, or tools explicitly mentioned.
5. For experience_years: Calculate total estimated years of professional experience as a number (e.g. 3.5). If not inferrable, return 0.

RESUME TEXT:
"""
${rawText}
"""

OUTPUT STRICT JSON MATCHING THIS EXACT SCHEMA:
{
  "fullName": string or null,
  "email": string or null,
  "phone": string or null,
  "location": string or null,
  "summary": string or null,
  "skills": ["Array of all skills"],
  "technicalSkills": ["Array of technical skills/languages/frameworks"],
  "softSkills": ["Array of soft skills if explicitly stated"],
  "experience_years": number,
  "experience": [
    {
      "company": string,
      "role": string,
      "startDate": string or "",
      "endDate": string or "",
      "description": string,
      "skills": ["technologies used in this role"]
    }
  ],
  "projects": [
    {
      "name": string,
      "description": string,
      "technologies": ["Array of technologies"],
      "url": string or ""
    }
  ],
  "education": [
    {
      "degree": string,
      "institution": string,
      "year": string or number,
      "field": string or ""
    }
  ],
  "certifications": ["Array of certification names"],
  "github": string or null,
  "linkedin": string or null,
  "portfolio": string or null
}

Return ONLY valid JSON.`;

  try {
    const res = await llmProvider.chat({
      messages: [
        {
          role: "system",
          content: "You are an expert resume parsing engine. You output strictly valid JSON conforming exactly to the requested schema with zero hallucinations.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 3500,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON<StrictResumeData>(res.content);
    if (!parsed) return null;

    // Normalization & Schema Guarantees
    parsed.skills = Array.isArray(parsed.skills) ? parsed.skills : [];
    parsed.technicalSkills = Array.isArray(parsed.technicalSkills)
      ? parsed.technicalSkills
      : parsed.skills;
    parsed.softSkills = Array.isArray(parsed.softSkills) ? parsed.softSkills : [];

    parsed.experience = Array.isArray(parsed.experience)
      ? parsed.experience
      : Array.isArray((parsed as any).workExperience)
      ? (parsed as any).workExperience
      : [];
    parsed.workExperience = parsed.experience;

    parsed.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    parsed.education = Array.isArray(parsed.education) ? parsed.education : [];
    parsed.certifications = Array.isArray(parsed.certifications) ? parsed.certifications : [];

    parsed.experience_years = typeof parsed.experience_years === "number" ? parsed.experience_years : 0;

    // Normalize URLs
    parsed.github_url = parsed.github || (parsed as any).github_url || null;
    parsed.linkedin_url = parsed.linkedin || (parsed as any).linkedin_url || null;
    parsed.portfolio_url = parsed.portfolio || (parsed as any).portfolio_url || null;

    return parsed;
  } catch (err) {
    console.error("parseResumeWithGroq error:", err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, base64Content, userId } = body;

    let resumeText = typeof text === "string" ? text.trim() : "";

    // If text was not sent from client, try server-side fallback extraction
    if (!resumeText && base64Content) {
      resumeText = extractFallbackTextFromBase64(base64Content);
    }

    if (!resumeText || resumeText.length < 30) {
      return new Response(
        JSON.stringify({
          error:
            "No readable text found in resume. Please upload a PDF with selectable text or a DOCX document (scanned image PDFs without OCR are not supported).",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Call Groq LLM
    const parsedData = await parseResumeWithGroq(resumeText);

    if (!parsedData) {
      return new Response(
        JSON.stringify({
          error: "AI parser failed to process resume text. Please verify the resume format and retry.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Add validation warnings
    const warnings: string[] = [];
    if (!parsedData.fullName) warnings.push("Full name could not be identified.");
    if (!parsedData.email) warnings.push("Email address was not found.");
    if (parsedData.skills.length === 0) warnings.push("No skills were detected.");
    parsedData.validation_warnings = warnings;

    // If userId was provided, persist directly to Supabase with service role
    if (userId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        if (supabaseUrl && serviceKey) {
          const supabase = createClient(supabaseUrl, serviceKey);

          // Update profiles full_name if present
          if (parsedData.fullName) {
            await supabase
              .from("profiles")
              .update({ full_name: parsedData.fullName })
              .eq("user_id", userId);
          }

          // Update candidate_profiles
          const candProfileUpdates: any = {
            full_name: parsedData.fullName,
            skills: parsedData.skills,
            experience_years: parsedData.experience_years,
            education: parsedData.education,
            projects: parsedData.projects,
            certifications: parsedData.certifications,
            summary: parsedData.summary,
            location: parsedData.location,
            work_experience: parsedData.experience,
          };

          if (parsedData.phone) candProfileUpdates.phone_number = parsedData.phone;
          if (parsedData.github_url) candProfileUpdates.github_url = parsedData.github_url;
          if (parsedData.linkedin_url) candProfileUpdates.linkedin_url = parsedData.linkedin_url;

          await supabase
            .from("candidate_profiles")
            .update(candProfileUpdates)
            .eq("user_id", userId);
        }
      } catch (dbErr) {
        console.warn("Direct DB sync from parse-resume-direct non-fatal error:", dbErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedData,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Resume parsing endpoint error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown resume parsing error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
