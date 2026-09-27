import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { downloadCandidateReport } from "@/lib/pdf-generator";
import { downloadCandidatePPT } from "@/lib/ppt-generator";
import { getCandidateDisplayName } from "@/lib/candidate-utils";
import {
  User,
  Mail,
  Phone,
  Github,
  Linkedin,
  FileText,
  Download,
  ExternalLink,
  Star,
  Briefcase,
  GraduationCap,
  Code,
  Award,
  Clock,
  CheckCircle2,
  ShieldCheck,
  Calendar,
  Loader2,
  FileDown,
  Presentation,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Plus,
  Minus,
  Target,
} from "lucide-react";
import { ScoreGauge } from "@/components/scoring/ScoreGauge";

interface CandidateDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  candidateId: string;
}

interface RoundScoreData {
  id: string;
  round_number: number;
  base_score: number | null;
  clarifying_questions_bonus: number | null;
  optimization_bonus: number | null;
  edge_cases_bonus: number | null;
  fraud_penalty: number | null;
  hints_penalty: number | null;
  final_score: number | null;
  weight: number | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  improvement_suggestions: string[] | null;
  round_result: {
    id: string;
    score: number | null;
    ai_feedback: string | null;
    ai_explanation: string | null;
    completed_at: string | null;
    fraud_detected: boolean | null;
    round: {
      round_type: string;
      duration_minutes: number | null;
    } | null;
  } | null;
}

interface CandidateDetails {
  profile: {
    full_name: string;
    email: string;
  } | null;
  candidateProfile: {
    phone_number: string;
    skills: string[] | null;
    experience_years: number | null;
    github_url: string | null;
    linkedin_url: string | null;
    github_score: number | null;
    linkedin_score: number | null;
    profile_score: number | null;
    resume_url: string | null;
    verification_status: string | null;
    education: any | null;
    projects: any | null;
    certifications: any | null;
    github_analysis: any | null;
    linkedin_analysis: any | null;
    suggested_job_preferences: any | null;
  } | null;
  application: {
    status: string;
    applied_at: string;
    overall_score: number | null;
    ai_confidence: number | null;
    current_round: number | null;
  } | null;
  job: {
    title: string;
    field: string;
    num_rounds: number | null;
  } | null;
  scores: {
    final_score: number | null;
    technical_score: number | null;
    communication_score: number | null;
    problem_solving_score: number | null;
    recommendation: string | null;
    recommendation_reason: string | null;
    strengths: string[] | null;
    weaknesses: string[] | null;
    improvement_suggestions: string[] | null;
  } | null;
  roundScores: RoundScoreData[];
}

export function CandidateDetailModal({
  open,
  onOpenChange,
  applicationId,
  candidateId,
}: CandidateDetailModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState<"pdf" | "ppt" | null>(null);
  const [details, setDetails] = useState<CandidateDetails | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open && applicationId && candidateId) {
      fetchCandidateDetails();
    }
  }, [open, applicationId, candidateId]);

  const fetchCandidateDetails = async () => {
    setIsLoading(true);
    try {
      // Fetch all data in parallel
      const [profileRes, candidateProfileRes, applicationRes, scoresRes, roundScoresRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", candidateId)
          .maybeSingle(),
        supabase
          .from("candidate_profiles")
          .select("*")
          .eq("user_id", candidateId)
          .maybeSingle(),
        supabase
          .from("applications")
          .select("*, job:jobs(title, field, num_rounds)")
          .eq("id", applicationId)
          .maybeSingle(),
        supabase
          .from("candidate_scores")
          .select("*")
          .eq("application_id", applicationId)
          .maybeSingle(),
        supabase
          .from("round_scores")
          .select(`
            *,
            round_result:round_results(
              id,
              score,
              ai_feedback,
              ai_explanation,
              completed_at,
              fraud_detected,
              round:job_rounds(round_type, duration_minutes)
            )
          `)
          .eq("application_id", applicationId)
          .order("round_number", { ascending: true }),
      ]);

      const jobData = applicationRes.data?.job as any;
      
      // Process round scores data
      const roundScoresData: RoundScoreData[] = (roundScoresRes.data || []).map((rs: any) => ({
        id: rs.id,
        round_number: rs.round_number,
        base_score: rs.base_score,
        clarifying_questions_bonus: rs.clarifying_questions_bonus,
        optimization_bonus: rs.optimization_bonus,
        edge_cases_bonus: rs.edge_cases_bonus,
        fraud_penalty: rs.fraud_penalty,
        hints_penalty: rs.hints_penalty,
        final_score: rs.final_score,
        weight: rs.weight,
        strengths: rs.strengths,
        weaknesses: rs.weaknesses,
        improvement_suggestions: rs.improvement_suggestions,
        round_result: rs.round_result,
      }));

      setDetails({
        profile: profileRes.data,
        candidateProfile: candidateProfileRes.data,
        application: applicationRes.data
          ? {
              status: applicationRes.data.status,
              applied_at: applicationRes.data.applied_at,
              overall_score: applicationRes.data.overall_score,
              ai_confidence: applicationRes.data.ai_confidence,
              current_round: applicationRes.data.current_round,
            }
          : null,
        job: jobData,
        scores: scoresRes.data,
        roundScores: roundScoresData,
      });
    } catch (error) {
      console.error("Error fetching candidate details:", error);
      toast({
        title: "Error",
        description: "Failed to load candidate details",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getCandidateName = (): string => {
    return getCandidateDisplayName({
      profile: details?.profile,
      candidateProfile: details?.candidateProfile,
    });
  };

  const handleDownloadResume = async () => {
    if (!details?.candidateProfile?.resume_url) return;

    try {
      const { data, error } = await supabase.storage
        .from("resumes")
        .download(details.candidateProfile.resume_url);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${getCandidateName()}_resume.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading resume:", error);
      toast({
        title: "Error",
        description: "Failed to download resume",
        variant: "destructive",
      });
    }
  };

  const handleExportPDF = () => {
    if (!details) return;
    setIsExporting("pdf");

    try {
      downloadCandidateReport({
        candidateName: getCandidateName(),
        email: details.profile?.email || "",
        role: details.job?.title || "Unknown",
        appliedDate: details.application?.applied_at
          ? new Date(details.application.applied_at).toLocaleDateString()
          : "N/A",
        experience: details.candidateProfile?.experience_years
          ? `${details.candidateProfile.experience_years} years`
          : "N/A",
        finalScore: details.scores?.final_score || details.application?.overall_score || 0,
        technicalScore: details.scores?.technical_score || 0,
        communicationScore: details.scores?.communication_score || 0,
        problemSolvingScore: details.scores?.problem_solving_score || 0,
        recommendation: (details.scores?.recommendation as any) || "shortlist",
        recommendationReason: details.scores?.recommendation_reason || "Evaluation pending",
        strengths: details.scores?.strengths || [],
        weaknesses: details.scores?.weaknesses || [],
        improvements: details.scores?.improvement_suggestions || [],
        roundScores: [],
      });

      toast({
        title: "PDF Downloaded",
        description: "Candidate report has been downloaded",
      });
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast({
        title: "Error",
        description: "Failed to generate PDF",
        variant: "destructive",
      });
    } finally {
      setIsExporting(null);
    }
  };

  const handleExportPPT = async () => {
    if (!details) return;
    setIsExporting("ppt");

    try {
      await downloadCandidatePPT({
        candidateName: getCandidateName(),
        email: details.profile?.email || "",
        phone: details.candidateProfile?.phone_number,
        role: details.job?.title || "Unknown",
        appliedDate: details.application?.applied_at
          ? new Date(details.application.applied_at).toLocaleDateString()
          : "N/A",
        experience: details.candidateProfile?.experience_years
          ? `${details.candidateProfile.experience_years} years`
          : "N/A",
        resumeUrl: details.candidateProfile?.resume_url || undefined,
        githubUrl: details.candidateProfile?.github_url || undefined,
        linkedinUrl: details.candidateProfile?.linkedin_url || undefined,
        finalScore: details.scores?.final_score || details.application?.overall_score || 0,
        technicalScore: details.scores?.technical_score || 0,
        communicationScore: details.scores?.communication_score || 0,
        problemSolvingScore: details.scores?.problem_solving_score || 0,
        recommendation: (details.scores?.recommendation as any) || "maybe",
        recommendationReason: details.scores?.recommendation_reason || "Evaluation pending",
        strengths: details.scores?.strengths || [],
        weaknesses: details.scores?.weaknesses || [],
        improvements: details.scores?.improvement_suggestions || [],
        skills: details.candidateProfile?.skills || [],
        education: details.candidateProfile?.education || [],
        projects: details.candidateProfile?.projects || [],
        certifications: details.candidateProfile?.certifications || [],
      });

      toast({
        title: "Presentation Downloaded",
        description: "Candidate presentation has been downloaded",
      });
    } catch (error) {
      console.error("Error exporting PPT:", error);
      toast({
        title: "Error",
        description: "Failed to generate presentation",
        variant: "destructive",
      });
    } finally {
      setIsExporting(null);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Candidate Details</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPDF}
                disabled={isLoading || isExporting !== null}
              >
                {isExporting === "pdf" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4 mr-2" />
                )}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPPT}
                disabled={isLoading || isExporting !== null}
              >
                {isExporting === "ppt" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Presentation className="h-4 w-4 mr-2" />
                )}
                PPT
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : details ? (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="rounds">Interview Rounds</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-4">
              {/* Header Card */}
              <GlassCard className="p-6">
                <div className="flex items-start gap-6">
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-2xl font-bold text-primary-foreground">
                    {getCandidateName().slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-bold">{getCandidateName()}</h2>
                      {details.candidateProfile?.verification_status === "verified" && (
                        <Badge variant="outline" className="text-success border-success/30">
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Verified
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Mail className="h-4 w-4" />
                        {details.profile?.email || "No email"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Phone className="h-4 w-4" />
                        {details.candidateProfile?.phone_number || "No phone"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {details.candidateProfile?.github_url && (
                        <a
                          href={details.candidateProfile.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          <Github className="h-4 w-4" />
                          GitHub
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {details.candidateProfile?.linkedin_url && (
                        <a
                          href={details.candidateProfile.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          <Linkedin className="h-4 w-4" />
                          LinkedIn
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {details.candidateProfile?.resume_url && (
                        <Button variant="ghost" size="sm" onClick={handleDownloadResume}>
                          <FileText className="h-4 w-4 mr-1" />
                          Download Resume
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {details.candidateProfile?.profile_score && (
                      <div className="text-3xl font-bold text-primary">
                        {details.candidateProfile.profile_score}
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground">Profile Score</div>
                  </div>
                </div>
              </GlassCard>

              {/* Application Info */}
              <div className="grid gap-4 md:grid-cols-3">
                <GlassCard className="p-4 text-center">
                  <Briefcase className="mx-auto h-8 w-8 text-primary mb-2" />
                  <div className="font-semibold">{details.job?.title || "Unknown"}</div>
                  <div className="text-sm text-muted-foreground">{details.job?.field}</div>
                </GlassCard>
                <GlassCard className="p-4 text-center">
                  <Calendar className="mx-auto h-8 w-8 text-primary mb-2" />
                  <div className="font-semibold">
                    {details.application?.applied_at
                      ? formatDate(details.application.applied_at)
                      : "N/A"}
                  </div>
                  <div className="text-sm text-muted-foreground">Applied Date</div>
                </GlassCard>
                <GlassCard className="p-4 text-center">
                  <Clock className="mx-auto h-8 w-8 text-primary mb-2" />
                  <div className="font-semibold">
                    {details.candidateProfile?.experience_years || 0} years
                  </div>
                  <div className="text-sm text-muted-foreground">Experience</div>
                </GlassCard>
              </div>

              {/* Progress */}
              {details.job?.num_rounds && (
                <GlassCard className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Interview Progress</span>
                    <span className="text-sm text-muted-foreground">
                      Round {details.application?.current_round || 0} of {details.job.num_rounds}
                    </span>
                  </div>
                  <Progress
                    value={
                      ((details.application?.current_round || 0) / details.job.num_rounds) * 100
                    }
                    className="h-2"
                  />
                </GlassCard>
              )}
            </TabsContent>

            <TabsContent value="skills" className="space-y-4 mt-4">
              {/* Skills */}
              {details.candidateProfile?.skills && details.candidateProfile.skills.length > 0 && (
                <GlassCard className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Code className="h-5 w-5 text-primary" />
                    Technical Skills
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {details.candidateProfile.skills.map((skill, idx) => (
                      <Badge key={idx} variant="secondary">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </GlassCard>
              )}

              {/* Education */}
              {details.candidateProfile?.education &&
                details.candidateProfile.education.length > 0 && (
                  <GlassCard className="p-4">
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <GraduationCap className="h-5 w-5 text-primary" />
                      Education
                    </h3>
                    <div className="space-y-3">
                      {details.candidateProfile.education.map((edu: any, idx: number) => (
                        <div key={idx} className="border-l-2 border-primary/30 pl-4">
                          <div className="font-medium">
                            {edu.degree}
                            {edu.field ? ` in ${edu.field}` : ""}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {edu.institution} • {edu.year}
                          </div>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                )}

              {/* Projects */}
              {details.candidateProfile?.projects &&
                details.candidateProfile.projects.length > 0 && (
                  <GlassCard className="p-4">
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <Code className="h-5 w-5 text-primary" />
                      Projects
                    </h3>
                    <div className="space-y-4">
                      {details.candidateProfile.projects.map((proj: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-lg bg-secondary/50">
                          <div className="font-medium">{proj.name}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {proj.description}
                          </div>
                          {proj.technologies && proj.technologies.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {proj.technologies.map((tech: string, techIdx: number) => (
                                <Badge key={techIdx} variant="outline" className="text-xs">
                                  {tech}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                )}

              {/* Certifications */}
              {details.candidateProfile?.certifications &&
                details.candidateProfile.certifications.length > 0 && (
                  <GlassCard className="p-4">
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <Award className="h-5 w-5 text-primary" />
                      Certifications
                    </h3>
                    <ul className="space-y-2">
                      {details.candidateProfile.certifications.map((cert: string, idx: number) => (
                        <li key={idx} className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-success" />
                          {cert}
                        </li>
                      ))}
                    </ul>
                  </GlassCard>
                )}
            </TabsContent>

            <TabsContent value="profile" className="space-y-4 mt-4">
              {/* GitHub Analysis */}
              {details.candidateProfile?.github_analysis && (
                <GlassCard className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Github className="h-5 w-5" />
                    GitHub Analysis
                    {details.candidateProfile.github_score && (
                      <Badge variant="secondary" className="ml-auto">
                        Score: {details.candidateProfile.github_score}/100
                      </Badge>
                    )}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="text-center p-3 rounded-lg bg-secondary/50">
                      <div className="text-2xl font-bold">
                        {details.candidateProfile.github_analysis.repos_count || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Repositories</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-secondary/50">
                      <div className="text-2xl font-bold">
                        {details.candidateProfile.github_analysis.total_stars || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Total Stars</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-secondary/50">
                      <div className="text-2xl font-bold">
                        {details.candidateProfile.github_analysis.followers || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Followers</div>
                    </div>
                  </div>
                  {details.candidateProfile.github_analysis.top_languages && (
                    <div className="mt-4">
                      <div className="text-sm font-medium mb-2">Top Languages</div>
                      <div className="flex flex-wrap gap-2">
                        {details.candidateProfile.github_analysis.top_languages.map(
                          (lang: string, idx: number) => (
                            <Badge key={idx} variant="outline">
                              {lang}
                            </Badge>
                          )
                        )}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                    <span>
                      Activity:{" "}
                      <span className="capitalize font-medium">
                        {details.candidateProfile.github_analysis.activity_level || "Unknown"}
                      </span>
                    </span>
                    <span>
                      Account Age:{" "}
                      {details.candidateProfile.github_analysis.account_age_years || 0} years
                    </span>
                  </div>
                </GlassCard>
              )}

              {/* LinkedIn Analysis */}
              {details.candidateProfile?.linkedin_analysis && (
                <GlassCard className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Linkedin className="h-5 w-5" />
                    LinkedIn Analysis
                    {details.candidateProfile.linkedin_score && (
                      <Badge variant="secondary" className="ml-auto">
                        Score: {details.candidateProfile.linkedin_score}/100
                      </Badge>
                    )}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="p-3 rounded-lg bg-secondary/50">
                      <div className="text-sm text-muted-foreground">Profile Strength</div>
                      <div className="font-medium capitalize">
                        {details.candidateProfile.linkedin_analysis.profile_strength || "Unknown"}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-secondary/50">
                      <div className="text-sm text-muted-foreground">Estimated Experience</div>
                      <div className="font-medium">
                        {details.candidateProfile.linkedin_analysis.estimated_experience ||
                          "To be verified"}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* Suggested Job Preferences */}
              {details.candidateProfile?.suggested_job_preferences && (
                <GlassCard className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Star className="h-5 w-5 text-warning" />
                    AI-Suggested Job Preferences
                  </h3>
                  <div className="space-y-4">
                    {details.candidateProfile.suggested_job_preferences.fields && (
                      <div>
                        <div className="text-sm font-medium mb-2">Recommended Fields</div>
                        <div className="flex flex-wrap gap-2">
                          {details.candidateProfile.suggested_job_preferences.fields.map(
                            (field: string, idx: number) => (
                              <Badge key={idx} variant="outline" className="bg-primary/5">
                                {field}
                              </Badge>
                            )
                          )}
                        </div>
                      </div>
                    )}
                    {details.candidateProfile.suggested_job_preferences.suggested_roles && (
                      <div>
                        <div className="text-sm font-medium mb-2">Suggested Roles</div>
                        <div className="flex flex-wrap gap-2">
                          {details.candidateProfile.suggested_job_preferences.suggested_roles.map(
                            (role: string, idx: number) => (
                              <Badge key={idx} variant="secondary">
                                {role}
                              </Badge>
                            )
                          )}
                        </div>
                      </div>
                    )}
                    {details.candidateProfile.suggested_job_preferences.experience_level && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Experience Level: </span>
                        <span className="font-medium capitalize">
                          {details.candidateProfile.suggested_job_preferences.experience_level}
                        </span>
                      </div>
                    )}
                  </div>
                </GlassCard>
              )}
            </TabsContent>

            <TabsContent value="evaluation" className="space-y-4 mt-4">
              {/* Score Summary */}
              <GlassCard className="p-4">
                <h3 className="font-semibold mb-4">Assessment Scores</h3>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="text-center p-4 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                    <div className="text-3xl font-bold text-primary">
                      {details.scores?.final_score ||
                        details.application?.overall_score ||
                        0}
                      %
                    </div>
                    <div className="text-sm text-muted-foreground">Final Score</div>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-secondary/50">
                    <div className="text-2xl font-bold">
                      {details.scores?.technical_score || 0}%
                    </div>
                    <div className="text-sm text-muted-foreground">Technical</div>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-secondary/50">
                    <div className="text-2xl font-bold">
                      {details.scores?.communication_score || 0}%
                    </div>
                    <div className="text-sm text-muted-foreground">Communication</div>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-secondary/50">
                    <div className="text-2xl font-bold">
                      {details.scores?.problem_solving_score || 0}%
                    </div>
                    <div className="text-sm text-muted-foreground">Problem Solving</div>
                  </div>
                </div>
              </GlassCard>

              {/* Recommendation */}
              {details.scores?.recommendation && (
                <GlassCard className="p-4">
                  <h3 className="font-semibold mb-3">AI Recommendation</h3>
                  <div className="flex items-center gap-4 mb-4">
                    <Badge
                      variant="outline"
                      className={
                        details.scores.recommendation === "shortlist"
                          ? "bg-success/10 text-success border-success/30 text-lg px-4 py-2"
                          : details.scores.recommendation === "reject"
                          ? "bg-danger/10 text-danger border-danger/30 text-lg px-4 py-2"
                          : "bg-warning/10 text-warning border-warning/30 text-lg px-4 py-2"
                      }
                    >
                      {details.scores.recommendation.toUpperCase()}
                    </Badge>
                    {details.application?.ai_confidence && (
                      <span className="text-sm text-muted-foreground">
                        Confidence: {details.application.ai_confidence}%
                      </span>
                    )}
                  </div>
                  {details.scores.recommendation_reason && (
                    <p className="text-muted-foreground">
                      {details.scores.recommendation_reason}
                    </p>
                  )}
                </GlassCard>
              )}

              {/* Strengths & Weaknesses */}
              <div className="grid gap-4 md:grid-cols-2">
                {details.scores?.strengths && details.scores.strengths.length > 0 && (
                  <GlassCard className="p-4">
                    <h3 className="font-semibold mb-3 text-success">Strengths</h3>
                    <ul className="space-y-2">
                      {details.scores.strengths.map((s, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-success mt-0.5" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </GlassCard>
                )}
                {details.scores?.weaknesses && details.scores.weaknesses.length > 0 && (
                  <GlassCard className="p-4">
                    <h3 className="font-semibold mb-3 text-warning">Areas for Improvement</h3>
                    <ul className="space-y-2">
                      {details.scores.weaknesses.map((w, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="h-4 w-4 text-warning mt-0.5">•</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </GlassCard>
                )}
              </div>

              {/* Improvement Suggestions */}
              {details.scores?.improvement_suggestions &&
                details.scores.improvement_suggestions.length > 0 && (
                  <GlassCard className="p-4">
                    <h3 className="font-semibold mb-3">Recommendations for Improvement</h3>
                    <ul className="space-y-2">
                      {details.scores.improvement_suggestions.map((i, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="h-4 w-4 text-primary mt-0.5">→</span>
                          <span>{i}</span>
                        </li>
                      ))}
                    </ul>
                  </GlassCard>
                )}
            </TabsContent>

            {/* Interview Rounds Tab */}
            <TabsContent value="rounds" className="space-y-4 mt-4">
              {details.roundScores && details.roundScores.length > 0 ? (
                <>
                  {/* Rounds Overview */}
                  <GlassCard className="p-4">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Interview Progress
                    </h3>
                    <div className="flex items-center gap-4 mb-4">
                      <Progress
                        value={
                          (details.roundScores.length / (details.job?.num_rounds || 1)) * 100
                        }
                        className="flex-1 h-3"
                      />
                      <span className="text-sm font-medium">
                        {details.roundScores.length} / {details.job?.num_rounds || "?"} Rounds
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <div className="text-center p-3 rounded-lg bg-secondary/50">
                        <div className="text-2xl font-bold text-primary">
                          {Math.round(
                            details.roundScores.reduce(
                              (sum, r) => sum + (r.final_score || 0),
                              0
                            ) / details.roundScores.length
                          )}
                          %
                        </div>
                        <div className="text-sm text-muted-foreground">Average Score</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-secondary/50">
                        <div className="text-2xl font-bold text-success">
                          {Math.max(...details.roundScores.map((r) => r.final_score || 0))}%
                        </div>
                        <div className="text-sm text-muted-foreground">Best Round</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-secondary/50">
                        <div className="text-2xl font-bold">
                          {details.roundScores.filter((r) => r.round_result?.completed_at).length}
                        </div>
                        <div className="text-sm text-muted-foreground">Completed</div>
                      </div>
                    </div>
                  </GlassCard>

                  {/* Individual Round Cards */}
                  {details.roundScores.map((round) => {
                    const roundType = round.round_result?.round?.round_type || "unknown";
                    const totalBonus =
                      (round.clarifying_questions_bonus || 0) +
                      (round.optimization_bonus || 0) +
                      (round.edge_cases_bonus || 0);
                    const totalPenalty =
                      (round.fraud_penalty || 0) + (round.hints_penalty || 0);

                    return (
                      <GlassCard key={round.id} className="p-4">
                        <div className="flex items-start gap-6">
                          {/* Score Gauge */}
                          <ScoreGauge
                            score={round.final_score || 0}
                            size="md"
                            label={`Round ${round.round_number}`}
                          />

                          {/* Round Details */}
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <h4 className="font-semibold text-lg">
                                  Round {round.round_number}
                                </h4>
                                <p className="text-sm text-muted-foreground capitalize">
                                  {roundType.replace(/_/g, " ")}
                                </p>
                              </div>
                              <div className="text-right">
                                {round.round_result?.completed_at ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-success/10 text-success border-success/30"
                                  >
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Completed
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="bg-warning/10 text-warning border-warning/30"
                                  >
                                    <Clock className="h-3 w-3 mr-1" />
                                    In Progress
                                  </Badge>
                                )}
                                {round.round_result?.fraud_detected && (
                                  <Badge
                                    variant="outline"
                                    className="ml-2 bg-danger/10 text-danger border-danger/30"
                                  >
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Fraud Flag
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Score Breakdown */}
                            <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                              <div className="p-2 rounded bg-secondary/30">
                                <span className="text-muted-foreground">Base Score</span>
                                <p className="font-semibold">
                                  {(round.base_score || 0).toFixed(1)}
                                </p>
                              </div>
                              <div className="p-2 rounded bg-success/10">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <Plus className="h-3 w-3 text-success" /> Bonus
                                </span>
                                <p className="font-semibold text-success">
                                  +{totalBonus.toFixed(1)}
                                </p>
                              </div>
                              <div className="p-2 rounded bg-danger/10">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <Minus className="h-3 w-3 text-danger" /> Penalty
                                </span>
                                <p className="font-semibold text-danger">
                                  -{totalPenalty.toFixed(1)}
                                </p>
                              </div>
                            </div>

                            {/* Bonus Badges */}
                            {totalBonus > 0 && (
                              <div className="flex flex-wrap gap-2 mt-3">
                                {(round.clarifying_questions_bonus || 0) > 0 && (
                                  <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">
                                    +{round.clarifying_questions_bonus} Clarifying Questions
                                  </span>
                                )}
                                {(round.optimization_bonus || 0) > 0 && (
                                  <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">
                                    +{round.optimization_bonus} Optimization
                                  </span>
                                )}
                                {(round.edge_cases_bonus || 0) > 0 && (
                                  <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">
                                    +{round.edge_cases_bonus} Edge Cases
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Penalty Badges */}
                            {totalPenalty > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {(round.fraud_penalty || 0) > 0 && (
                                  <span className="text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full">
                                    -{round.fraud_penalty} Fraud Flag
                                  </span>
                                )}
                                {(round.hints_penalty || 0) > 0 && (
                                  <span className="text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full">
                                    -{round.hints_penalty} Hints Used
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* AI Feedback */}
                        {round.round_result?.ai_feedback && (
                          <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
                            <h5 className="text-sm font-medium mb-1">AI Feedback</h5>
                            <p className="text-sm text-muted-foreground">
                              {round.round_result.ai_feedback}
                            </p>
                          </div>
                        )}

                        {/* Strengths & Weaknesses */}
                        <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-border">
                          <div>
                            <h5 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <TrendingUp className="h-3 w-3 text-success" /> Strengths
                            </h5>
                            <ul className="space-y-1">
                              {(round.strengths || []).slice(0, 3).map((s, i) => (
                                <li
                                  key={i}
                                  className="text-xs text-muted-foreground line-clamp-1"
                                >
                                  • {s}
                                </li>
                              ))}
                              {(!round.strengths || round.strengths.length === 0) && (
                                <li className="text-xs text-muted-foreground italic">
                                  No strengths recorded
                                </li>
                              )}
                            </ul>
                          </div>
                          <div>
                            <h5 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <TrendingDown className="h-3 w-3 text-warning" /> Areas to
                              Improve
                            </h5>
                            <ul className="space-y-1">
                              {(round.weaknesses || []).slice(0, 3).map((w, i) => (
                                <li
                                  key={i}
                                  className="text-xs text-muted-foreground line-clamp-1"
                                >
                                  • {w}
                                </li>
                              ))}
                              {(!round.weaknesses || round.weaknesses.length === 0) && (
                                <li className="text-xs text-muted-foreground italic">
                                  No improvements recorded
                                </li>
                              )}
                            </ul>
                          </div>
                        </div>

                        {/* Improvement Suggestions */}
                        {round.improvement_suggestions &&
                          round.improvement_suggestions.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-border">
                              <h5 className="text-xs font-medium text-muted-foreground mb-2">
                                Recommendations
                              </h5>
                              <ul className="space-y-1">
                                {round.improvement_suggestions.slice(0, 2).map((sug, i) => (
                                  <li
                                    key={i}
                                    className="text-xs text-muted-foreground flex items-start gap-1"
                                  >
                                    <span className="text-primary">→</span> {sug}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                      </GlassCard>
                    );
                  })}
                </>
              ) : (
                <GlassCard className="p-8 text-center">
                  <Clock className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="font-semibold text-lg mb-2">No Interview Rounds Yet</h3>
                  <p className="text-muted-foreground">
                    The candidate hasn't completed any interview rounds for this application.
                  </p>
                </GlassCard>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="py-12 text-center text-muted-foreground">
            Failed to load candidate details
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
