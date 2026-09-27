import { useState, useEffect, useCallback, memo } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CandidateDetailModal } from "@/components/dashboard/CandidateDetailModal";
import { getCandidateDisplayName } from "@/lib/candidate-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Search,
  Users,
  MoreVertical,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Star,
  Github,
  Linkedin,
  Mail,
  Phone,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Download,
  Filter,
  SortAsc,
  SortDesc,
  Briefcase,
  User,
  FileDown,
  Presentation,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Applicant {
  id: string;
  candidate_id: string;
  status: string;
  applied_at: string;
  overall_score: number | null;
  ai_confidence: number | null;
  current_round: number | null;
  fraud_flags: any;
  candidate_profile: {
    user_id: string;
    full_name?: string | null;
    phone_number: string;
    skills: string[] | null;
    experience_years: number | null;
    github_url: string | null;
    linkedin_url: string | null;
    profile_score: number | null;
    verification_status: string | null;
    resume_url: string | null;
  } | null;
  profile: {
    full_name: string;
    email: string;
  } | null;
}

interface Job {
  id: string;
  title: string;
  field: string;
  experience_level: string;
  num_rounds: number | null;
  status: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  applied: { label: "Applied", color: "bg-info/10 text-info border-info/30", icon: Clock },
  screening: { label: "Screening", color: "bg-primary/10 text-primary border-primary/30", icon: Eye },
  interviewing: { label: "Interviewing", color: "bg-warning/10 text-warning border-warning/30", icon: Users },
  shortlisted: { label: "Shortlisted", color: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "bg-danger/10 text-danger border-danger/30", icon: XCircle },
  hired: { label: "Hired", color: "bg-success/10 text-success border-success/30", icon: Star },
  withdrawn: { label: "Withdrawn", color: "bg-muted text-muted-foreground border-border", icon: XCircle },
};

export default function JobApplicantsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [job, setJob] = useState<Job | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("applied_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedApplicant, setSelectedApplicant] = useState<{ applicationId: string; candidateId: string } | null>(null);

  useEffect(() => {
    if (jobId && user) {
      fetchJobAndApplicants();
    }
  }, [jobId, user]);

  const fetchJobAndApplicants = async () => {
    if (!jobId || !user) return;
    
    setIsLoading(true);
    try {
      // Fetch job details
      const { data: jobData, error: jobError } = await supabase
        .from("jobs")
        .select("id, title, field, experience_level, num_rounds, status")
        .eq("id", jobId)
        .eq("interviewer_id", user.id)
        .single();

      if (jobError) throw jobError;
      setJob(jobData);

      // Fetch applicants with their profiles
      const { data: applicantsData, error: applicantsError } = await supabase
        .from("applications")
        .select(`
          id,
          candidate_id,
          status,
          applied_at,
          overall_score,
          ai_confidence,
          current_round,
          fraud_flags
        `)
        .eq("job_id", jobId)
        .order("applied_at", { ascending: false });

      if (applicantsError) throw applicantsError;

      // Fetch candidate profiles and user profiles for each applicant
      const applicantsWithProfiles = await Promise.all(
        (applicantsData || []).map(async (app) => {
          // Get candidate profile
          const { data: candidateProfile } = await supabase
            .from("candidate_profiles")
            .select("user_id, full_name, phone_number, skills, experience_years, github_url, linkedin_url, profile_score, verification_status, resume_url")
            .eq("user_id", app.candidate_id)
            .single();

          // Get user profile for name and email
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("user_id", app.candidate_id)
            .single();

          return {
            ...app,
            candidate_profile: candidateProfile,
            profile,
          };
        })
      );

      setApplicants(applicantsWithProfiles);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({
        title: "Error",
        description: "Failed to load applicants",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const updateApplicantStatus = async (applicationId: string, newStatus: "applied" | "screening" | "interviewing" | "shortlisted" | "rejected" | "hired" | "withdrawn") => {
    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: newStatus })
        .eq("id", applicationId);

      if (error) throw error;

      setApplicants((prev) =>
        prev.map((app) =>
          app.id === applicationId ? { ...app, status: newStatus } : app
        )
      );

      toast({
        title: "Status updated",
        description: `Applicant status changed to ${statusConfig[newStatus]?.label || newStatus}`,
      });
    } catch (error) {
      console.error("Error updating status:", error);
      toast({
        title: "Error",
        description: "Failed to update applicant status",
        variant: "destructive",
      });
    }
  };

  const getCandidateName = (applicant: Applicant): string => {
    return getCandidateDisplayName({
      profile: applicant.profile,
      candidateProfile: applicant.candidate_profile,
    });
  };

  const getInitials = (name: string): string => {
    return name
      .split(" ")
      .map((n) => n[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getFraudFlagCount = (flags: any): number => {
    if (!flags) return 0;
    if (Array.isArray(flags)) return flags.length;
    if (typeof flags === "object") return Object.keys(flags).length;
    return 0;
  };

  // Filter and sort applicants
  const filteredApplicants = applicants
    .filter((app) => {
      const name = getCandidateName(app).toLowerCase();
      const email = app.profile?.email?.toLowerCase() || "";
      const matchesSearch = name.includes(searchQuery.toLowerCase()) || email.includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || app.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "applied_at":
          comparison = new Date(a.applied_at).getTime() - new Date(b.applied_at).getTime();
          break;
        case "score":
          comparison = (a.overall_score || 0) - (b.overall_score || 0);
          break;
        case "name":
          comparison = getCandidateName(a).localeCompare(getCandidateName(b));
          break;
        default:
          comparison = 0;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

  // Stats
  const stats = {
    total: applicants.length,
    screening: applicants.filter((a) => a.status === "screening").length,
    interviewing: applicants.filter((a) => a.status === "interviewing").length,
    shortlisted: applicants.filter((a) => a.status === "shortlisted").length,
    rejected: applicants.filter((a) => a.status === "rejected").length,
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-6">
        <GlassCard className="py-12 text-center">
          <Briefcase className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">Job not found</h3>
          <p className="mt-1 text-muted-foreground">
            The job you're looking for doesn't exist or you don't have access to it.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/dashboard/jobs">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Jobs
            </Link>
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard/jobs">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <p className="text-muted-foreground">
            {job.field} • {job.experience_level} • {job.num_rounds || 5} rounds
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/dashboard/jobs/${jobId}/edit`}>
              Edit Job
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: "Total", value: stats.total, color: "text-foreground" },
          { label: "Screening", value: stats.screening, color: "text-primary" },
          { label: "Interviewing", value: stats.interviewing, color: "text-warning" },
          { label: "Shortlisted", value: stats.shortlisted, color: "text-success" },
          { label: "Rejected", value: stats.rejected, color: "text-danger" },
        ].map((stat) => (
          <GlassCard key={stat.label} className="text-center py-4">
            <div className={cn("text-2xl font-bold", stat.color)}>{stat.value}</div>
            <div className="text-sm text-muted-foreground">{stat.label}</div>
          </GlassCard>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="applied">Applied</SelectItem>
              <SelectItem value="screening">Screening</SelectItem>
              <SelectItem value="interviewing">Interviewing</SelectItem>
              <SelectItem value="shortlisted">Shortlisted</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="hired">Hired</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="applied_at">Date Applied</SelectItem>
              <SelectItem value="score">Score</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          >
            {sortOrder === "asc" ? (
              <SortAsc className="h-4 w-4" />
            ) : (
              <SortDesc className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Applicants List */}
      {filteredApplicants.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <Users className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No applicants found</h3>
          <p className="mt-1 text-muted-foreground">
            {applicants.length === 0
              ? "No one has applied to this job yet"
              : "Try adjusting your search or filters"}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {filteredApplicants.map((applicant, index) => {
            const name = getCandidateName(applicant);
            const initials = getInitials(name);
            const statusInfo = statusConfig[applicant.status] || statusConfig.applied;
            const StatusIcon = statusInfo.icon;
            const fraudCount = getFraudFlagCount(applicant.fraud_flags);
            const isVerified = applicant.candidate_profile?.verification_status === "verified";

            return (
              <motion.div
                key={applicant.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <GlassCard hover className="p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    {/* Candidate Info */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="relative shrink-0">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-sm font-bold text-primary-foreground">
                          {initials}
                        </div>
                        {isVerified && (
                          <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-success text-success-foreground">
                            <ShieldCheck className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold truncate">{name}</h3>
                          {applicant.candidate_profile?.profile_score && (
                            <Badge variant="outline" className="text-xs bg-primary/5 border-primary/20">
                              <Star className="h-3 w-3 mr-1 text-primary" />
                              {applicant.candidate_profile.profile_score}
                            </Badge>
                          )}
                          {fraudCount > 0 && (
                            <Badge variant="outline" className="text-xs text-danger border-danger/30">
                              <ShieldAlert className="h-3 w-3 mr-1" />
                              {fraudCount} Flag{fraudCount > 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                          {applicant.profile?.email && (
                            <span className="flex items-center gap-1 truncate">
                              <Mail className="h-3 w-3" />
                              {applicant.profile.email}
                            </span>
                          )}
                          {applicant.candidate_profile?.experience_years && (
                            <span>{applicant.candidate_profile.experience_years} yrs exp</span>
                          )}
                        </div>
                        {/* Skills */}
                        {applicant.candidate_profile?.skills && applicant.candidate_profile.skills.length > 0 && (
                          <div className="flex items-center gap-1 mt-2 flex-wrap">
                            {applicant.candidate_profile.skills.slice(0, 4).map((skill) => (
                              <Badge key={skill} variant="secondary" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                            {applicant.candidate_profile.skills.length > 4 && (
                              <Badge variant="secondary" className="text-xs">
                                +{applicant.candidate_profile.skills.length - 4}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Status & Progress */}
                    <div className="flex items-center gap-4 md:gap-6">
                      {/* Score */}
                      {applicant.overall_score !== null && (
                        <div className="text-center min-w-[60px]">
                          <div className="text-lg font-bold">{applicant.overall_score}%</div>
                          <div className="text-xs text-muted-foreground">Score</div>
                        </div>
                      )}

                      {/* Round Progress */}
                      {job.num_rounds && (
                        <div className="text-center min-w-[80px]">
                          <div className="text-sm font-medium">
                            Round {applicant.current_round || 0}/{job.num_rounds}
                          </div>
                          <Progress
                            value={((applicant.current_round || 0) / job.num_rounds) * 100}
                            className="h-1.5 mt-1"
                          />
                        </div>
                      )}

                      {/* Status Badge */}
                      <Badge
                        variant="outline"
                        className={cn("gap-1 min-w-[100px] justify-center", statusInfo.color)}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusInfo.label}
                      </Badge>

                      {/* Social Links */}
                      <div className="flex items-center gap-1">
                        {applicant.candidate_profile?.github_url && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={applicant.candidate_profile.github_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 hover:bg-muted rounded-lg transition-colors"
                              >
                                <Github className="h-4 w-4" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>View GitHub</TooltipContent>
                          </Tooltip>
                        )}
                        {applicant.candidate_profile?.linkedin_url && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={applicant.candidate_profile.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 hover:bg-muted rounded-lg transition-colors"
                              >
                                <Linkedin className="h-4 w-4" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>View LinkedIn</TooltipContent>
                          </Tooltip>
                        )}
                        {applicant.candidate_profile?.resume_url && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={applicant.candidate_profile.resume_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 hover:bg-muted rounded-lg transition-colors"
                              >
                                <FileText className="h-4 w-4" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>View Resume</TooltipContent>
                          </Tooltip>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setSelectedApplicant({ 
                            applicationId: applicant.id, 
                            candidateId: applicant.candidate_id 
                          })}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          View
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/dashboard/candidates/${applicant.id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Full Report
                              </Link>
                            </DropdownMenuItem>
                            {applicant.profile?.email && (
                              <DropdownMenuItem asChild>
                                <a href={`mailto:${applicant.profile.email}`}>
                                  <Mail className="mr-2 h-4 w-4" />
                                  Send Email
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => updateApplicantStatus(applicant.id, "screening")}>
                              <Eye className="mr-2 h-4 w-4" />
                              Move to Screening
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateApplicantStatus(applicant.id, "interviewing")}>
                              <Users className="mr-2 h-4 w-4" />
                              Move to Interviewing
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateApplicantStatus(applicant.id, "shortlisted")}>
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              Shortlist
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => updateApplicantStatus(applicant.id, "rejected")}
                              className="text-danger focus:text-danger"
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Reject
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Applied Date Info */}
      {filteredApplicants.length > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          Showing {filteredApplicants.length} of {applicants.length} applicants
        </p>
      )}

      {/* Candidate Detail Modal */}
      {selectedApplicant && (
        <CandidateDetailModal
          open={!!selectedApplicant}
          onOpenChange={(open) => !open && setSelectedApplicant(null)}
          applicationId={selectedApplicant.applicationId}
          candidateId={selectedApplicant.candidateId}
        />
      )}
    </div>
  );
}
