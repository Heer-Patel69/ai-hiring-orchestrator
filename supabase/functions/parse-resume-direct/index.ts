import { llmProvider } from "../_shared/llm-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Education {
  degree: string;
  institution: string;
  year: number;
  field?: string;
  gpa?: string;
}

interface WorkExperience {
  company: string;
  title: string;
  duration: string;
  startDate?: string;
  endDate?: string;
  description: string;
  technologies?: string[];
}

interface Project {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
}

interface ResumeData {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  skills: string[];
  experience_years: number;
  education: Education[];
  workExperience: WorkExperience[];
  projects: Project[];
  certifications: string[];
  languages: string[];
  summary: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  confidence_scores: {
    fullName: "high" | "medium" | "low";
    email: "high" | "medium" | "low";
    phone: "high" | "medium" | "low";
    skills: "high" | "medium" | "low";
    experience: "high" | "medium" | "low";
    education: "high" | "medium" | "low";
  };
  validation_warnings: string[];
  suggested_job_preferences: {
    fields: string[];
    experience_level: string;
    roles: string[];
    work_type: string[];
  };
}

function extractTextFromPdfBase64(base64: string): string {
  try {
    const binary = atob(base64.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Extract visible text from uncompressed PDF streams or ASCII strings
    let rawText = "";
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const fullString = decoder.decode(bytes);

    // 1. Look for text in PDF literal strings: (text) Tj or [(text)] TJ
    const tjMatches = fullString.match(/\(([^)]+)\)\s*(?:Tj|'|")/g);
    if (tjMatches && tjMatches.length > 5) {
      rawText = tjMatches.map((m) => m.replace(/^\(/, "").replace(/\)\s*(?:Tj|'|")$/, "")).join(" ");
    }

    // 2. If literal string extraction yielded very little, scan for printable ascii sequences
    if (rawText.length < 100) {
      const printableMatches = fullString.match(/[A-Za-z0-9@._:\-\+\#\s\/\(\)]{4,}/g);
      if (printableMatches) {
        rawText = printableMatches
          .filter((s) => !/^(obj|endobj|stream|endstream|xref|trailer|startxref)/.test(s.trim()))
          .join(" ");
      }
    }

    return rawText.slice(0, 15000); // Keep within reasonable context window
  } catch (err) {
    console.warn("Failed to extract text from PDF directly:", err);
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base64Content } = await req.json();

    if (!base64Content) {
      return new Response(
        JSON.stringify({ error: "PDF content is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const estimatedSizeBytes = (base64Content.length * 3) / 4;
    const maxSizeMB = 10;
    if (estimatedSizeBytes > maxSizeMB * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: `File too large. Maximum size is ${maxSizeMB}MB.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extractedText = extractTextFromPdfBase64(base64Content);
    const resumeData = await extractResumeWithGroq(extractedText);

    if (!resumeData) {
      return new Response(
        JSON.stringify({ error: "Failed to parse resume text. Please ensure the document contains readable text." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validationWarnings: string[] = [];
    if (!resumeData.fullName) validationWarnings.push("Full name could not be identified.");
    if (!resumeData.email) validationWarnings.push("Email address was not found.");
    if (resumeData.skills.length === 0) validationWarnings.push("No technical skills were detected.");

    resumeData.validation_warnings = validationWarnings;

    return new Response(
      JSON.stringify({ success: true, data: resumeData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Resume parsing error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown parsing error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function extractResumeWithGroq(rawText: string): Promise<ResumeData | null> {
  const prompt = `Analyze this extracted resume content and return a structured JSON profile.

RESUME CONTENT:
"""
${rawText || "No readable text extracted. Provide empty profile."}
"""

Extract and populate this exact JSON structure:
{
  "fullName": string or null,
  "email": string or null,
  "phone": string or null,
  "location": string or null,
  "skills": ["Array", "of", "technical", "skills", "and", "tools"],
  "experience_years": number (e.g. 3),
  "education": [
    {
      "degree": "B.Tech Computer Science",
      "institution": "University Name",
      "year": 2024,
      "field": "Computer Science"
    }
  ],
  "workExperience": [
    {
      "company": "Company Name",
      "title": "Software Engineer",
      "duration": "2 years",
      "description": "Built backend APIs...",
      "technologies": ["Node.js", "PostgreSQL"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": "Description of project",
      "technologies": ["React", "TypeScript"]
    }
  ],
  "certifications": ["AWS Certified Solutions Architect"],
  "languages": ["English"],
  "summary": "Professional summary...",
  "github_url": string or null,
  "linkedin_url": string or null,
  "portfolio_url": string or null,
  "confidence_scores": {
    "fullName": "high",
    "email": "high",
    "phone": "high",
    "skills": "high",
    "experience": "high",
    "education": "high"
  },
  "suggested_job_preferences": {
    "fields": ["Full Stack", "Backend"],
    "experience_level": "junior",
    "roles": ["Full Stack Developer", "Backend Engineer"],
    "work_type": ["remote", "hybrid"]
  }
}

Return ONLY valid JSON.`;

  try {
    const res = await llmProvider.chat({
      messages: [
        { role: "system", content: "You are an expert resume parser that outputs strictly valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 3000,
      responseFormat: { type: "json_object" },
    });

    const parsed = llmProvider.parseJSON<ResumeData>(res.content);
    if (parsed) {
      if (!Array.isArray(parsed.skills)) parsed.skills = [];
      if (!Array.isArray(parsed.education)) parsed.education = [];
      if (!Array.isArray(parsed.workExperience)) parsed.workExperience = [];
      if (!Array.isArray(parsed.projects)) parsed.projects = [];
      if (typeof parsed.experience_years !== "number") parsed.experience_years = 0;
      return parsed;
    }
    return null;
  } catch (err) {
    console.error("Groq extractResumeWithGroq error:", err);
    return null;
  }
}
