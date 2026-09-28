import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase,
  MapPin,
  Clock,
  DollarSign,
  Building2,
  Calendar,
  Zap,
  ArrowLeft,
  CheckCircle,
  Shield,
  FileText,
  Code,
  Users,
  MessageSquare,
  Video,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  title: string;
  description: string | null;
  field: string;
  experience_level: string;
  location_type: string;
  location_city: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  toughness_level: string;
  num_rounds: number;
  application_deadline: string | null;
  required_skills: string[];
  created_at: string;
  interviewer_id: string;
}

interface JobRound {
  id: string;
  round_number: number;
  round_type: string;
  duration_minutes: number;
}

interface CandidateProfile {
  verification_status: string;
}

const roundTypeIcons: Record<string, any> = {
  mcq: FileText,
  coding: Code,
  system_design: Building2,
  behavioral: Users,
  live_ai_interview: Video,
};

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [job, setJob] = useState<Job | null>(null);
  const [rounds, setRounds] = useState<JobRound[]>([]);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [hasApplied, setHasApplied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    if (id) {
      fetchJobDetails();
    }
  }, [id, user]);

  const fetchJobDetails = async () => {
    try {
      // Fetch job
      const { data: jobData, error: jobError } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", id)
        .single();

      if (jobError) throw jobError;
      setJob(jobData);

      // Fetch rounds
      const { data: roundsData } = await supabase
        .from("job_rounds")
        .select("*")
        .eq("job_id", id)
        .order("round_number", { ascending: true });

      setRounds(roundsData || []);

      if (user) {
        // Check if already applied
        const { data: applicationData } = await supabase
          .from("applications")
          .select("id")
          .eq("job_id", id)
          .eq("candidate_id", user.id)
          .maybeSingle();

        setHasApplied(!!applicationData);

        // Fetch profile
        const { data: profileData } = await supabase
          .from("candidate_profiles")
          .select("verification_status")
          .eq("user_id", user.id)
          .maybeSingle();

        setProfile(profileData);
      }
    } catch (error) {
      console.error("Error fetching job:", error);
      toast({
        title: "Error",
        description: "Failed to load job details",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    if (!user || !job) return;

    // Check verification - allow pending for testing
    const allowedStatuses = ["verified", "pending"];
    if (profile?.verification_status && !allowedStatuses.includes(profile.verification_status)) {
      toast({
        title: "Verification Issue",
        description: "Your verification was rejected. Please retry verification.",
        variant: "destructive",
      });
      navigate("/verify-face");
      return;
    }

    setIsApplying(true);
    try {
      const { error } = await supabase.from("applications").insert({
        job_id: job.id,
        candidate_id: user.id,
        status: "applied",
        current_round: 0,
      });

      if (error) throw error;

      setHasApplied(true);
      setShowConfirmation(false);

      toast({
        title: "Application Submitted!",
        description: "Your application has been submitted successfully.",
      });

      navigate("/candidate/applications");
    } catch (error: any) {
      console.error("Error applying:", error);
      toast({
        title: "Application Failed",
        description: error.message || "Failed to submit application",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleRetake = async () => {
    if (!user || !job) return;
    setIsApplying(true);
    try {
      const { data: existingApp } = await supabase
        .from("applications")
        .select("id")
        .eq("job_id", job.id)
        .eq("candidate_id", user.id)
        .maybeSingle();

      if (existingApp) {
        await supabase.from("round_results").delete().eq("application_id", existingApp.id);
        await supabase.from("interview_transcripts").delete().eq("application_id", existingApp.id);
        await supabase.from("interview_recordings").delete().eq("application_id", existingApp.id);
        await supabase.from("proctoring_logs").delete().eq("application_id", existingApp.id);
        await supabase.from("scoring_audit_logs").delete().eq("application_id", existingApp.id);
        await supabase.from("candidate_scores").delete().eq("application_id", existingApp.id);

        const { error } = await supabase
          .from("applications")
          .update({
            status: "applied",
            current_round: 0,
            overall_score: null,
            ai_confidence: null,
            completed_at: null,
          })
          .eq("id", existingApp.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("applications").insert({
          job_id: job.id,
          candidate_id: user.id,
          status: "applied",
          current_round: 0,
        });
        if (error) throw error;
      }

      toast({
        title: "Fresh Application Started!",
        description: "You can now begin a fresh interview from Round 1.",
      });
      navigate("/candidate/applications");
    } catch (error: any) {
      console.error("Error resetting application:", error);
      toast({
        title: "Reset Failed",
        description: error.message || "Failed to start fresh interview",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const formatSalary = (min: number | null, max: number | null, currency: string) => {
    if (!min && !max) return "Not disclosed";
    const formatter = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    });
    if (min && max) return `${formatter.format(min)} - ${formatter.format(max)}`;
    if (min) return `${formatter.format(min)}+`;
    return `Up to ${formatter.format(max!)}`;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const experienceLevelLabels: Record<string, string> = {
    fresher: "Fresher",
    junior: "Junior (1-2 years)",
    mid: "Mid-Level (3-5 years)",
    senior: "Senior (5-8 years)",
    architect: "Architect (8+ years)",
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-success border-t-transparent" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Job not found</h2>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/candidate/jobs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Jobs
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Button variant="ghost" size="sm" asChild>
        <Link to="/candidate/jobs">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Jobs
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Job Header */}
          <GlassCard>
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
                <Building2 className="h-8 w-8 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-2xl font-bold">{job.title}</h1>
                    <p className="text-muted-foreground">{job.field}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium capitalize",
                      job.toughness_level === "easy" && "bg-success/10 text-success",
                      job.toughness_level === "medium" && "bg-warning/10 text-warning",
                      job.toughness_level === "hard" && "bg-danger/10 text-danger",
                      job.toughness_level === "expert" && "bg-purple-500/10 text-purple-500"
                    )}
                  >
                    <Zap className="mr-1 inline h-4 w-4" />
                    {job.toughness_level}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {job.location_type === "remote"
                      ? "Remote"
                      : job.location_city || job.location_type}
                  </span>
                  <span className="flex items-center gap-1">
                    <Briefcase className="h-4 w-4" />
                    {experienceLevelLabels[job.experience_level]}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {job.num_rounds} Interview Rounds
                  </span>
                  {job.application_deadline && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      Deadline: {formatDate(job.application_deadline)}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <span className="text-2xl font-bold text-success">
                    {formatSalary(job.salary_min, job.salary_max, job.salary_currency)}
                  </span>
                  <span className="text-muted-foreground"> / year</span>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Description */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Job Description</h2>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {job.description || "No description provided."}
            </div>
          </GlassCard>

          {/* Required Skills */}
          {job.required_skills && job.required_skills.length > 0 && (
            <GlassCard>
              <h2 className="text-lg font-semibold mb-4">Required Skills</h2>
              <div className="flex flex-wrap gap-2">
                {job.required_skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Interview Pipeline */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Interview Pipeline</h2>
            <div className="space-y-3">
              {rounds.length > 0 ? (
                rounds.map((round, index) => {
                  const Icon = roundTypeIcons[round.round_type] || FileText;
                  return (
                    <div
                      key={round.id}
                      className="flex items-center gap-4 rounded-lg bg-secondary/50 p-4"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <span className="font-semibold text-primary">{index + 1}</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium capitalize">
                          {round.round_type.replace("_", " ")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Duration: {round.duration_minutes} minutes
                        </p>
                      </div>
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  );
                })
              ) : (
                <p className="text-muted-foreground">
                  Interview details will be shared after applying.
                </p>
              )}
            </div>
          </GlassCard>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Apply Card */}
          <GlassCard className="sticky top-24">
            {hasApplied ? (
              <div className="text-center py-4 space-y-3">
                <CheckCircle className="mx-auto h-12 w-12 text-success" />
                <h3 className="mt-3 text-lg font-semibold">Already Applied</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  You've already applied for this position. You can view your current progress or retake a fresh interview anytime.
                </p>
                <div className="space-y-2 pt-2">
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/candidate/applications">View Current Application</Link>
                  </Button>
                  <Button
                    className="w-full bg-primary hover:bg-primary/90 flex items-center justify-center gap-2"
                    onClick={handleRetake}
                    disabled={isApplying}
                  >
                    {isApplying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Resetting...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        Retake / Fresh Interview
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : showConfirmation ? (
              <div className="space-y-4">
                <h3 className="font-semibold">Confirm Application</h3>
                
                {profile?.verification_status === "pending" && (
                  <div className="rounded-lg bg-info/10 border border-info/30 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-info shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-info">Verification Pending</p>
                        <p className="text-xs text-muted-foreground">
                          You can apply now. Complete verification later for full access.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span>Your profile will be shared with the employer</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span>You'll receive updates on your application</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span>Interview rounds will be unlocked progressively</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowConfirmation(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-success hover:bg-success/90"
                    onClick={handleApply}
                    disabled={isApplying}
                  >
                    {isApplying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Applying...
                      </>
                    ) : (
                      "Confirm Apply"
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-success">
                    {formatSalary(job.salary_min, job.salary_max, job.salary_currency)}
                  </p>
                  <p className="text-sm text-muted-foreground">Annual Package</p>
                </div>

                <Button
                  className="w-full bg-success hover:bg-success/90"
                  size="lg"
                  onClick={() => setShowConfirmation(true)}
                >
                  Apply Now
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  By applying, you agree to share your profile with the employer.
                </p>
              </div>
            )}
          </GlassCard>

          {/* Verification Status */}
          {profile && (
            <GlassCard>
              <div className="flex items-center gap-3">
                <Shield
                  className={cn(
                    "h-5 w-5",
                    profile.verification_status === "verified"
                      ? "text-success"
                      : "text-warning"
                  )}
                />
                <div>
                  <p className="font-medium capitalize">{profile.verification_status}</p>
                  <p className="text-xs text-muted-foreground">
                    {profile.verification_status === "verified"
                      ? "Identity verified"
                      : "Complete verification to apply"}
                  </p>
                </div>
              </div>
              {profile.verification_status === "pending" && (
                <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
                  <Link to="/verify-face">Complete Verification (Optional)</Link>
                </Button>
              )}
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}
