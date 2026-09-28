import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  Star,
  Briefcase,
  ArrowRight,
  Calendar,
  Code,
  TrendingUp,
  Zap,
  Loader2,
  RefreshCw,
  Sparkles,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface CandidateProfile {
  verification_status: string;
  github_url: string | null;
  linkedin_url: string | null;
  skills: string[] | null;
  profile_score: number | null;
  github_score: number | null;
  linkedin_score: number | null;
  github_analysis: {
    repos_count: number;
    total_stars: number;
    top_languages: string[];
    activity_level: string;
  } | null;
}

interface Application {
  id: string;
  status: string;
  current_round: number;
  job: {
    title: string;
    field: string;
  } | null;
}

interface JobPriority {
  job_id: string;
  match_score: number;
  matching_skills: string[];
  is_favorited: boolean;
  job: {
    id: string;
    title: string;
    field: string;
    experience_level: string;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string;
    toughness_level: string;
  };
}

export default function CandidateOverviewPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [recommendedJobs, setRecommendedJobs] = useState<JobPriority[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      const { data: profileData } = await supabase
        .from("candidate_profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (profileData) {
        setProfile({
          ...profileData,
          github_analysis: profileData.github_analysis as CandidateProfile['github_analysis'],
        });
      }

      const { data: applicationsData } = await supabase
        .from("applications")
        .select(`
          id,
          status,
          current_round,
          job:jobs(
            id,
            title,
            field,
            interviewer_id,
            job_rounds(
              id,
              round_number,
              round_type
            )
          )
        `)
        .eq("candidate_id", user!.id)
        .order("applied_at", { ascending: false });

      setApplications(applicationsData || []);

      const { data: prioritiesData } = await supabase
        .from("job_priorities")
        .select(`
          job_id,
          match_score,
          matching_skills,
          is_favorited,
          job:jobs(
            id,
            title,
            field,
            experience_level,
            salary_min,
            salary_max,
            salary_currency,
            toughness_level
          )
        `)
        .eq("candidate_id", user!.id)
        .order("match_score", { ascending: false })
        .limit(4);

      if (!prioritiesData || prioritiesData.length === 0) {
        const { data: jobsData } = await supabase
          .from("jobs")
          .select("*")
          .eq("status", "active")
          .limit(4);

        setRecommendedJobs((jobsData || []).map(job => ({
          job_id: job.id,
          match_score: 50,
          matching_skills: [],
          is_favorited: false,
          job: job,
        })));
      } else {
        setRecommendedJobs(prioritiesData.filter(p => p.job) as JobPriority[]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshJobMatching = async () => {
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("match-jobs");
      if (error) throw error;

      await fetchData();
      toast({
        title: "Jobs refreshed!",
        description: "Job matches have been updated based on your skills.",
      });
    } catch (error) {
      console.error("Error refreshing matches:", error);
      toast({
        title: "Error",
        description: "Failed to refresh job matches",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const getVerificationBadge = () => {
    if (!profile) return null;

    const badges = {
      verified: {
        icon: ShieldCheck,
        label: "Verified",
        color: "text-success bg-success/10 border-success/30",
      },
      pending: {
        icon: Shield,
        label: "Pending Verification",
        color: "text-warning bg-warning/10 border-warning/30",
      },
      manual_review: {
        icon: ShieldAlert,
        label: "Under Review",
        color: "text-info bg-info/10 border-info/30",
      },
      rejected: {
        icon: ShieldAlert,
        label: "Verification Failed",
        color: "text-danger bg-danger/10 border-danger/30",
      },
    };

    const badge = badges[profile.verification_status as keyof typeof badges] || badges.pending;
    const Icon = badge.icon;

    return (
      <div className={cn("flex items-center gap-2 rounded-full border px-3 py-1", badge.color)}>
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{badge.label}</span>
      </div>
    );
  };

  const applicationStats = {
    total: applications.length,
    inProgress: applications.filter(a => ["applied", "interviewing"].includes(a.status)).length,
    completed: applications.filter(a => a.status === "completed").length,
    shortlisted: applications.filter(a => a.status === "shortlisted").length,
    rejected: applications.filter(a => a.status === "rejected").length,
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
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-success to-success/70 bg-clip-text text-transparent">
            Welcome back!
          </h1>
          <p className="text-muted-foreground">
            Here's your job search overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          {getVerificationBadge()}
          {profile?.profile_score && profile.profile_score > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1">
              <Sparkles className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-success">{profile.profile_score} Profile Score</span>
            </div>
          )}
        </div>
      </div>

      {/* Profile Analysis Summary */}
      {profile?.github_analysis && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlassCard className="border-success/30 bg-success/5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                  <Code className="h-5 w-5 text-success" />
                </div>
                <div>
                  <h3 className="font-semibold text-success">GitHub Profile Analyzed</h3>
                  <p className="text-sm text-muted-foreground">
                    {profile.github_analysis.repos_count} repos • {profile.github_analysis.total_stars} stars • 
                    {profile.github_analysis.activity_level} activity
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">GitHub Score:</span>
                <Badge className="bg-success/10 text-success border-success/30 text-lg px-3">
                  {profile.github_score}/100
                </Badge>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: "Total Applications", value: applicationStats.total, icon: FileText, color: "primary" },
          { label: "In Progress", value: applicationStats.inProgress, icon: Clock, color: "info" },
          { label: "Completed", value: applicationStats.completed, icon: CheckCircle, color: "success" },
          { label: "Shortlisted", value: applicationStats.shortlisted, icon: Star, color: "warning" },
          { label: "Rejected", value: applicationStats.rejected, icon: XCircle, color: "danger" },
        ].map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <GlassCard className="text-center hover:border-border/80 transition-all">
              <stat.icon className={cn("mx-auto h-6 w-6 mb-2", `text-${stat.color}`)} />
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming Interviews */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <GlassCard className="h-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Calendar className="h-5 w-5 text-success" />
                Upcoming Interviews
              </h2>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/candidate/applications">View All</Link>
              </Button>
            </div>

            {applications.filter(a => a.status === "interviewing").length === 0 ? (
              <div className="py-8 text-center">
                <Calendar className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No upcoming interviews</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link to="/candidate/jobs">Browse Jobs</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {applications
                  .filter((a) => a.status === "interviewing" || a.status === "applied" || a.status === "screening")
                  .slice(0, 3)
                  .map((app) => {
                    const nextRoundNum = (app.current_round || 0) + 1;
                    const roundConfig = (app.job as any)?.job_rounds?.find((r: any) => r.round_number === nextRoundNum);
                    const roundType = roundConfig?.round_type || "live_ai_interview";
                    const route = roundType === "mcq"
                      ? `/candidate/assessment/mcq?application=${app.id}`
                      : roundType === "coding" || roundType === "dsa"
                      ? `/candidate/assessment/coding?application=${app.id}`
                      : roundType === "behavioral"
                      ? `/candidate/interview/live?type=behavioral&application=${app.id}`
                      : roundType === "system_design"
                      ? `/candidate/interview/live?type=system-design&application=${app.id}`
                      : `/candidate/interview/live?application=${app.id}`;

                    return (
                      <div
                        key={app.id}
                        className="flex items-center justify-between rounded-xl bg-secondary/50 p-3 hover:bg-secondary/70 transition-colors"
                      >
                        <div>
                          <p className="font-medium">{app.job?.title}</p>
                          <p className="text-sm text-muted-foreground">
                            Round {nextRoundNum} ({roundType.replace("_", " ")})
                          </p>
                        </div>
                        <Button size="sm" className="bg-success hover:bg-success/90" asChild>
                          <Link to={route}>
                            Start
                            <ArrowRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    );
                  })}
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* Skill Profile */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard className="h-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Zap className="h-5 w-5 text-success" />
                Your Skills
              </h2>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/candidate/profile">Edit Profile</Link>
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {(profile?.skills || []).length > 0 ? (
                profile!.skills!.slice(0, 12).map((skill) => (
                  <Badge
                    key={skill}
                    variant="outline"
                    className="bg-success/5 text-success border-success/20"
                  >
                    {skill}
                  </Badge>
                ))
              ) : profile?.github_analysis?.top_languages ? (
                profile.github_analysis.top_languages.map((lang) => (
                  <Badge
                    key={lang}
                    variant="outline"
                    className="bg-success/5 text-success border-success/20"
                  >
                    {lang}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Skills will be extracted from your GitHub and LinkedIn profiles
                </p>
              )}
            </div>

            <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
              {profile?.github_url && (
                <a href={profile.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors">
                  <Code className="h-4 w-4" />
                  GitHub
                </a>
              )}
              {profile?.linkedin_url && (
                <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors">
                  <TrendingUp className="h-4 w-4" />
                  LinkedIn
                </a>
              )}
            </div>
          </GlassCard>
        </motion.div>
      </div>

      {/* Recommended Jobs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-success" />
            Recommended for You
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshJobMatching} disabled={isRefreshing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
              Refresh Matches
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/candidate/jobs">
                View All Jobs
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {recommendedJobs.map((priority, index) => (
            <motion.div
              key={priority.job_id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <GlassCard hover className="h-full group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 group-hover:bg-success/20 transition-colors">
                    <Briefcase className="h-5 w-5 text-success" />
                  </div>
                  <div className="flex items-center gap-2">
                    {priority.match_score > 0 && (
                      <Badge className="bg-success/10 text-success border-success/20">
                        {priority.match_score}% match
                      </Badge>
                    )}
                  </div>
                </div>
                <h3 className="font-semibold line-clamp-1">{priority.job.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{priority.job.field}</p>
                <p className="text-sm text-muted-foreground capitalize">{priority.job.experience_level}</p>
                {priority.matching_skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {priority.matching_skills.slice(0, 2).map(skill => (
                      <Badge key={skill} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">
                    {formatSalary(priority.job.salary_min, priority.job.salary_max, priority.job.salary_currency)}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="w-full mt-3" asChild>
                  <Link to={`/candidate/jobs/${priority.job_id}`}>
                    View Details
                  </Link>
                </Button>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
