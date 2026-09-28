import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { extractResumeText } from "@/lib/resume-extractor";
import {
  User,
  Mail,
  Phone,
  Github,
  Linkedin,
  FileText,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Save,
  Loader2,
  ExternalLink,
  Zap,
  CheckCircle,
  XCircle,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

interface Profile {
  full_name: string;
  email: string;
}

interface CandidateProfile {
  full_name?: string | null;
  phone_number: string;
  github_url: string | null;
  linkedin_url: string | null;
  resume_url: string | null;
  verification_status: string;
  verification_confidence: number | null;
  skills: string[] | null;
  experience_years?: number | null;
  summary?: string | null;
  education?: any[] | null;
  projects?: any[] | null;
  certifications?: any[] | null;
}

type ParsingStatus = "idle" | "uploaded" | "extracting" | "parsing" | "parsed" | "failed";

export default function CandidateProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [candidateProfile, setCandidateProfile] = useState<CandidateProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [parsingStatus, setParsingStatus] = useState<ParsingStatus>("idle");
  const [parsingError, setParsingError] = useState<string | null>(null);

  // Dynamic real skills from profile
  const [extractedSkills, setExtractedSkills] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  const fetchProfile = async () => {
    try {
      // Fetch base profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", user!.id)
        .maybeSingle();

      // Fetch candidate profile
      const { data: candidateData } = await supabase
        .from("candidate_profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();

      setProfile(profileData);
      setCandidateProfile(candidateData ? {
        ...candidateData,
        education: Array.isArray(candidateData.education) ? candidateData.education : [],
        projects: Array.isArray(candidateData.projects) ? candidateData.projects : [],
        certifications: Array.isArray(candidateData.certifications) ? candidateData.certifications : [],
      } : null);

      if (profileData?.full_name) {
        setFullName(profileData.full_name);
      } else if (candidateData?.full_name) {
        setFullName(candidateData.full_name);
      }

      if (candidateData) {
        setPhoneNumber(candidateData.phone_number || "");
        setGithubUrl(candidateData.github_url || "");
        setLinkedinUrl(candidateData.linkedin_url || "");
        if (Array.isArray(candidateData.skills) && candidateData.skills.length > 0) {
          setExtractedSkills(candidateData.skills);
        }
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const parseUploadedResume = async (file: File) => {
    setParsingError(null);
    setParsingStatus("uploaded");

    try {
      setParsingStatus("extracting");
      const { text } = await extractResumeText(file);

      setParsingStatus("parsing");
      const { data, error } = await supabase.functions.invoke("parse-resume-direct", {
        body: {
          text,
          fileName: file.name,
          userId: user?.id,
        },
      });

      if (error) {
        throw new Error(error.message || "Resume parsing failed");
      }

      const parsed = data?.data;
      if (!parsed) {
        throw new Error("No structured data returned from resume parser");
      }

      // Populate form fields if currently empty
      if (parsed.fullName && (!fullName || fullName.trim() === "")) {
        setFullName(parsed.fullName);
      }
      if (parsed.phone && (!phoneNumber || phoneNumber.trim() === "")) {
        setPhoneNumber(parsed.phone);
      }
      if (parsed.github_url && !githubUrl) {
        setGithubUrl(parsed.github_url);
      }
      if (parsed.linkedin_url && !linkedinUrl) {
        setLinkedinUrl(parsed.linkedin_url);
      }

      if (Array.isArray(parsed.skills) && parsed.skills.length > 0) {
        setExtractedSkills(parsed.skills);
      }

      // Upload file to Supabase storage
      if (user) {
        const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
        const filePath = `${user.id}/resume.${fileExt}`;
        await supabase.storage
          .from("resumes")
          .upload(filePath, file, { upsert: true });

        // Update database records with structured data
        if (parsed.fullName) {
          await supabase
            .from("profiles")
            .update({ full_name: parsed.fullName })
            .eq("user_id", user.id);
        }

        const candUpdates: any = {
          resume_url: filePath,
          skills: parsed.skills || [],
          experience_years: parsed.experience_years || 0,
          education: parsed.education || [],
          projects: parsed.projects || [],
          certifications: parsed.certifications || [],
        };
        if (parsed.fullName) candUpdates.full_name = parsed.fullName;
        if (parsed.phone) candUpdates.phone_number = parsed.phone;
        if (parsed.github_url) candUpdates.github_url = parsed.github_url;
        if (parsed.linkedin_url) candUpdates.linkedin_url = parsed.linkedin_url;

        await supabase
          .from("candidate_profiles")
          .update(candUpdates)
          .eq("user_id", user.id);
      }

      setParsingStatus("parsed");
      toast({
        title: "Resume Parsed Successfully!",
        description: `Identified ${parsed.fullName ? parsed.fullName + " • " : ""}${parsed.skills?.length || 0} skills, ${parsed.experience?.length || 0} work experiences.`,
      });

      // Refetch profile to display latest synchronized data
      fetchProfile();
    } catch (err: any) {
      console.error("Resume parsing error:", err);
      setParsingStatus("failed");
      setParsingError(err.message || "Failed to parse resume");
      toast({
        title: "Resume Parsing Failed",
        description: err.message || "Could not read resume. You may retry or fill your details manually.",
        variant: "destructive",
      });
    }
  };

  const handleResumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (!validTypes.includes(file.type) && ext !== "pdf" && ext !== "docx" && ext !== "doc") {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF or DOCX file.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Resume must be less than 10MB.",
        variant: "destructive",
      });
      return;
    }

    setResumeFile(file);
    await parseUploadedResume(file);
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      // Update base profile
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: fullName })
        .eq("user_id", user.id);

      if (profileError) throw profileError;

      // Update candidate profile
      const updateData: any = {
        full_name: fullName,
        phone_number: phoneNumber,
        github_url: githubUrl || null,
        linkedin_url: linkedinUrl || null,
      };

      if (extractedSkills.length > 0) {
        updateData.skills = extractedSkills;
      }

      // Handle resume file upload if not already processed
      if (resumeFile && parsingStatus !== "parsed") {
        const fileExt = resumeFile.name.split(".").pop()?.toLowerCase() || "pdf";
        const filePath = `${user.id}/resume.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("resumes")
          .upload(filePath, resumeFile, { upsert: true });

        if (uploadError) throw uploadError;
        updateData.resume_url = filePath;
      }

      const { error: candidateError } = await supabase
        .from("candidate_profiles")
        .update(updateData)
        .eq("user_id", user.id);

      if (candidateError) throw candidateError;

      toast({
        title: "Profile Updated",
        description: "Your profile has been saved successfully.",
      });

      fetchProfile();
    } catch (error: any) {
      console.error("Error saving profile:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save profile",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getVerificationBadge = () => {
    if (!candidateProfile) return null;

    switch (candidateProfile.verification_status) {
      case "verified":
        return {
          icon: ShieldCheck,
          label: "Verified Candidate",
          description: "Your identity has been verified via face & document check",
          color: "text-success border-success/30 bg-success/10",
        };
      case "rejected":
        return {
          icon: ShieldAlert,
          label: "Verification Failed",
          description: "Please retry identity verification to apply for jobs",
          color: "text-danger border-danger/30 bg-danger/10",
        };
      default:
        return {
          icon: Shield,
          label: "Verification Pending",
          description: "Complete face verification to unlock full platform features",
          color: "text-warning border-warning/30 bg-warning/10",
        };
    }
  };

  const verificationBadge = getVerificationBadge();
  const VerificationIcon = verificationBadge?.icon || Shield;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-success" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Candidate Profile</h1>
        <p className="text-muted-foreground">
          Manage your personal information, resume, and credentials
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Form */}
        <div className="space-y-6 lg:col-span-2">
          {/* Personal Information */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Personal Information</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full legal name"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    value={profile?.email || ""}
                    disabled
                    className="pl-10 bg-secondary/50"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed as it is linked to your account.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Professional Links */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Professional Profiles</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="github">GitHub Profile URL</Label>
                <div className="relative">
                  <Github className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="github"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/username"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="linkedin">LinkedIn Profile URL</Label>
                <div className="relative">
                  <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="linkedin"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    placeholder="https://linkedin.com/in/username"
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Resume Upload & AI Parsing Status */}
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Resume & Credentials</h2>
                <p className="text-sm text-muted-foreground">
                  Upload your PDF or DOCX resume. AI extracts and populates your profile automatically.
                </p>
              </div>
              {parsingStatus === "parsing" || parsingStatus === "extracting" ? (
                <div className="flex items-center gap-2 text-xs text-primary font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {parsingStatus === "extracting" ? "Extracting Text..." : "AI Parsing..."}
                </div>
              ) : parsingStatus === "parsed" ? (
                <div className="flex items-center gap-1.5 text-xs text-success font-medium">
                  <CheckCircle className="h-4 w-4" />
                  Parsed
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              {candidateProfile?.resume_url && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-success" />
                    <div>
                      <p className="font-medium">Current Resume</p>
                      <p className="text-sm text-muted-foreground">
                        {candidateProfile.resume_url.split("/").pop()}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={supabase.storage
                        .from("resumes")
                        .getPublicUrl(candidateProfile.resume_url).data.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      View
                    </a>
                  </Button>
                </div>
              )}

              {/* Parsing status bar */}
              {parsingStatus === "extracting" && (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-primary">Reading and extracting resume text...</span>
                </div>
              )}
              {parsingStatus === "parsing" && (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-primary">AI is analyzing skills, experience, and education...</span>
                </div>
              )}
              {parsingStatus === "failed" && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <span>{parsingError || "Parsing failed."}</span>
                  </div>
                  {resumeFile && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => parseUploadedResume(resumeFile)}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Retry
                    </Button>
                  )}
                </div>
              )}

              <label className="cursor-pointer block">
                <div
                  className={cn(
                    "flex items-center justify-center gap-3 p-6 rounded-lg border-2 border-dashed transition-colors",
                    resumeFile
                      ? "border-success bg-success/10"
                      : "border-border hover:border-success hover:bg-success/5"
                  )}
                >
                  {resumeFile ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-success" />
                      <span className="text-sm font-medium">{resumeFile.name}</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Upload new resume (PDF or DOCX, max 10MB)
                      </span>
                    </>
                  )}
                </div>
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={handleResumeChange}
                />
              </label>
            </div>
          </GlassCard>

          {/* Save Button */}
          <Button
            className="w-full bg-success hover:bg-success/90"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Verification Status */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Verification Status</h2>
            <div className={cn("rounded-lg border p-4", verificationBadge?.color)}>
              <div className="flex items-center gap-3">
                <VerificationIcon className="h-6 w-6" />
                <div>
                  <p className="font-medium">{verificationBadge?.label}</p>
                  <p className="text-sm opacity-80">{verificationBadge?.description}</p>
                </div>
              </div>
              {candidateProfile?.verification_confidence && (
                <div className="mt-3 pt-3 border-t border-current/20">
                  <div className="flex items-center justify-between text-sm">
                    <span>Confidence Score</span>
                    <span className="font-semibold">
                      {(candidateProfile.verification_confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
            {candidateProfile?.verification_status !== "verified" && (
              <Button variant="outline" className="w-full mt-4" asChild>
                <Link to="/verify-face">Complete Verification</Link>
              </Button>
            )}
          </GlassCard>

          {/* Skills */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <Zap className="h-5 w-5 text-success" />
              Skills (AI Extracted)
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              {extractedSkills.length > 0
                ? "Extracted accurately from your verified resume."
                : "Upload your resume to extract verified skills."}
            </p>
            {extractedSkills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {extractedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No skills extracted yet</p>
            )}
          </GlassCard>

          {/* Profile Completion */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Profile Completion</h2>
            <div className="space-y-3">
              {[
                { label: "Basic Info", completed: !!fullName && !!phoneNumber },
                { label: "Resume Uploaded", completed: !!candidateProfile?.resume_url || !!resumeFile },
                { label: "Skills Extracted", completed: extractedSkills.length > 0 },
                { label: "GitHub Connected", completed: !!githubUrl },
                { label: "LinkedIn Connected", completed: !!linkedinUrl },
                { label: "Identity Verified", completed: candidateProfile?.verification_status === "verified" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-sm">
                  {item.completed ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={item.completed ? "text-foreground" : "text-muted-foreground"}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
