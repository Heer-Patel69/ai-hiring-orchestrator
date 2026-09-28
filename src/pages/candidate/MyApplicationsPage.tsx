import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Briefcase,
  Clock,
  CheckCircle,
  XCircle,
  Star,
  ChevronRight,
  FileText,
  Building2,
  Calendar,
  Lock,
  Unlock,
  PlayCircle,
  MessageSquare,
  Zap,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Application {
  id: string;
  status: string;
  current_round: number;
  overall_score: number | null;
  ai_confidence: number | null;
  applied_at: string;
  job: {
    id: string;
    title: string;
    field: string;
    num_rounds: number;
    toughness_level: string;
    job_rounds?: Array<{
      id: string;
      round_number: number;
      round_type: string;
      duration_minutes: number;
    }>;
  };
  round_results: RoundResult[];
}

interface RoundResult {
  id: string;
  round_id: string;
  score: number | null;
  ai_feedback: string | null;
  completed_at: string | null;
  round: {
    round_number: number;
    round_type: string;
    duration_minutes: number;
  };
}

const statusConfig = {
  applied: { label: "Applied", color: "text-info bg-info/10", icon: FileText },
  interviewing: { label: "In Progress", color: "text-warning bg-warning/10", icon: Clock },
  completed: { label: "Completed", color: "text-primary bg-primary/10", icon: CheckCircle },
  shortlisted: { label: "Shortlisted", color: "text-success bg-success/10", icon: Star },
  rejected: { label: "Rejected", color: "text-danger bg-danger/10", icon: XCircle },
};

export default function MyApplicationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [resettingAppId, setResettingAppId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchApplications();
    }
  }, [user]);

  const fetchApplications = async () => {
    try {
      const { data, error } = await supabase
        .from("applications")
        .select(`
          id,
          status,
          current_round,
          overall_score,
          ai_confidence,
          applied_at,
          job:jobs(
            id,
            title,
            field,
            num_rounds,
            toughness_level,
            job_rounds(
              id,
              round_number,
              round_type,
              duration_minutes
            )
          ),
          round_results(
            id,
            round_id,
            score,
            ai_feedback,
            completed_at,
            round:job_rounds(
              round_number,
              round_type,
              duration_minutes
            )
          )
        `)
        .eq("candidate_id", user!.id)
        .order("applied_at", { ascending: false });

      if (error) throw error;
      setApplications(data || []);
    } catch (error) {
      console.error("Error fetching applications:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetakeApplication = async (appId: string) => {
    if (!window.confirm("Are you sure you want to retake this interview? All your previous round scores will be cleared so you can start completely fresh from Round 1.")) {
      return;
    }
    setResettingAppId(appId);
    try {
      // Clear all child records for this application
      await supabase.from("round_results").delete().eq("application_id", appId);
      await supabase.from("interview_transcripts").delete().eq("application_id", appId);
      await supabase.from("interview_recordings").delete().eq("application_id", appId);
      await supabase.from("proctoring_logs").delete().eq("application_id", appId);
      await supabase.from("scoring_audit_logs").delete().eq("application_id", appId);
      await supabase.from("candidate_scores").delete().eq("application_id", appId);

      const { error } = await supabase
        .from("applications")
        .update({
          status: "applied",
          current_round: 0,
          overall_score: null,
          ai_confidence: null,
          completed_at: null,
        })
        .eq("id", appId);

      if (error) throw error;

      toast({
        title: "Interview Reset!",
        description: "You can now begin a fresh interview from Round 1.",
      });
      await fetchApplications();
    } catch (err: any) {
      console.error("Error resetting application:", err);
      toast({
        title: "Reset Failed",
        description: err.message || "Failed to reset application",
        variant: "destructive",
      });
    } finally {
      setResettingAppId(null);
    }
  };

  const filteredApplications = applications.filter(
    (app) => selectedStatus === "all" || app.status === selectedStatus
  );

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-success border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Applications</h1>
          <p className="text-muted-foreground">
            Track your job applications and interview progress
          </p>
        </div>
        <Button className="bg-success hover:bg-success/90" asChild>
          <Link to="/candidate/jobs">
            Browse More Jobs
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* Status Filter */}
      <div className="flex flex-wrap gap-2">
        {["all", "applied", "interviewing", "shortlisted", "rejected"].map((status) => (
          <Button
            key={status}
            variant={selectedStatus === status ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedStatus(status)}
            className={selectedStatus === status ? "bg-success hover:bg-success/90" : ""}
          >
            {status === "all" ? "All" : statusConfig[status as keyof typeof statusConfig]?.label}
            {status !== "all" && (
              <span className="ml-1 text-xs">
                ({applications.filter((a) => a.status === status).length})
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* Applications List */}
      {filteredApplications.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <Briefcase className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No applications found</h3>
          <p className="mt-1 text-muted-foreground">
            {applications.length === 0
              ? "Start applying to jobs to track your progress here"
              : "No applications match the selected filter"}
          </p>
          {applications.length === 0 && (
            <Button className="mt-4 bg-success hover:bg-success/90" asChild>
              <Link to="/candidate/jobs">Browse Jobs</Link>
            </Button>
          )}
        </GlassCard>
      ) : (
        <Accordion type="single" collapsible className="space-y-4">
          {filteredApplications.map((app, index) => {
            const status = statusConfig[app.status as keyof typeof statusConfig] || statusConfig.applied;
            const StatusIcon = status.icon;

            return (
              <motion.div
                key={app.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <AccordionItem value={app.id} className="border-0">
                  <GlassCard className="overflow-hidden">
                    <AccordionTrigger className="hover:no-underline p-0 [&[data-state=open]>div]:border-b">
                      <div className="flex flex-col w-full gap-4 p-4 md:flex-row md:items-center md:justify-between border-b border-transparent transition-colors">
                        <div className="flex items-start gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                            <Building2 className="h-6 w-6 text-primary" />
                          </div>
                          <div className="text-left">
                            <h3 className="font-semibold">{app.job?.title}</h3>
                            <p className="text-sm text-muted-foreground">{app.job?.field}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", status.color)}>
                                <StatusIcon className="mr-1 inline h-3 w-3" />
                                {status.label}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Applied {formatDate(app.applied_at)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          {app.overall_score !== null && (
                            <div className="text-center">
                              <div className="text-lg font-bold text-success">
                                {app.overall_score.toFixed(0)}%
                              </div>
                              <div className="text-xs text-muted-foreground">Score</div>
                            </div>
                          )}
                          <div className="text-center">
                            <div className="text-lg font-bold">
                              {Math.max(app.current_round || 0, (app.round_results || []).filter((r) => !!r.completed_at).length)}/{app.job?.num_rounds || 0}
                            </div>
                            <div className="text-xs text-muted-foreground">Rounds</div>
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent>
                      <div className="p-4 space-y-4">
                        {/* Interview Pipeline */}
                        <div>
                          <h4 className="font-medium mb-3">Interview Pipeline</h4>
                          <div className="relative">
                            {/* Progress Line */}
                            <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-border" />
                            
                            <div className="space-y-4">
                              {Array.from({ length: app.job?.num_rounds || 0 }).map((_, idx) => {
                                const roundNum = idx + 1;
                                const configuredRound = app.job?.job_rounds?.find(
                                  (jr) => jr.round_number === roundNum
                                );
                                const roundResult = app.round_results?.find(
                                  (r) => r.round?.round_number === roundNum
                                );
                                const isCompleted = !!roundResult?.completed_at;
                                const activeRoundNum = (app.current_round || 0) + 1;
                                const isUnlocked = roundNum <= activeRoundNum;
                                const isCurrent = roundNum === activeRoundNum && (app.status === "interviewing" || app.status === "applied" || app.status === "screening");

                                const effectiveRoundType = roundResult?.round?.round_type || configuredRound?.round_type || "live_ai_interview";

                                const getRoundRoute = (roundType: string) => {
                                  if (roundType === "coding" || roundType === "dsa") return `/candidate/assessment/coding?application=${app.id}`;
                                  if (roundType === "mcq") return `/candidate/assessment/mcq?application=${app.id}`;
                                  if (roundType === "behavioral") return `/candidate/interview/live?type=behavioral&application=${app.id}`;
                                  if (roundType === "system_design") return `/candidate/interview/live?type=system-design&application=${app.id}`;
                                  return `/candidate/interview/live?application=${app.id}`;
                                };

                                return (
                                  <div key={idx} className="relative flex items-start gap-4 pl-2">
                                    <div
                                      className={cn(
                                        "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2",
                                        isCompleted
                                          ? "bg-success border-success text-white"
                                          : isCurrent
                                          ? "bg-warning border-warning text-white"
                                          : isUnlocked
                                          ? "bg-background border-primary text-primary"
                                          : "bg-secondary border-border text-muted-foreground"
                                      )}
                                    >
                                      {isCompleted ? (
                                        <CheckCircle className="h-4 w-4" />
                                      ) : isUnlocked ? (
                                        <Unlock className="h-4 w-4" />
                                      ) : (
                                        <Lock className="h-4 w-4" />
                                      )}
                                    </div>
                                    <div className="flex-1 pb-4">
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <p className="font-medium">
                                            Round {roundNum}
                                            <span className="ml-2 text-muted-foreground capitalize">
                                              ({effectiveRoundType.replace("_", " ")})
                                            </span>
                                          </p>
                                          {isCompleted && roundResult?.score !== null && (
                                            <p className="text-sm text-success">
                                              Score: {roundResult.score.toFixed(0)}%
                                            </p>
                                          )}
                                        </div>
                                        {isCurrent && (
                                          <Button size="sm" className="bg-success hover:bg-success/90" asChild>
                                            <Link to={getRoundRoute(effectiveRoundType)}>
                                              <PlayCircle className="mr-1 h-3 w-3" />
                                              Start
                                            </Link>
                                          </Button>
                                        )}
                                      </div>
                                      {isCompleted && roundResult?.ai_feedback && (
                                        <div className="mt-2 rounded-lg bg-secondary/50 p-3">
                                          <p className="text-sm text-muted-foreground flex items-start gap-2">
                                            <MessageSquare className="h-4 w-4 shrink-0 mt-0.5" />
                                            {roundResult.ai_feedback}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* AI Suggestions - Dynamic from round feedback */}
                        {app.status !== "shortlisted" && app.round_results?.some((r) => r.ai_feedback) && (
                          <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
                            <h4 className="font-medium flex items-center gap-2 mb-2">
                              <Zap className="h-4 w-4 text-primary" />
                              AI Improvement Suggestions
                            </h4>
                            <ul className="space-y-1 text-sm text-muted-foreground">
                              {app.round_results
                                .filter((r) => r.ai_feedback)
                                .slice(-3) // Get last 3 feedback items
                                .map((r, idx) => (
                                  <li key={idx}>• {r.ai_feedback}</li>
                                ))}
                              {!app.round_results.some((r) => r.ai_feedback) && (
                                <li>• Complete more interview rounds to receive personalized suggestions</li>
                              )}
                            </ul>
                          </div>
                        )}

                        {/* Retake / Fresh Interview Action */}
                        <div className="pt-3 border-t border-border/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-secondary/20 p-3 rounded-lg">
                          <div>
                            <p className="text-sm font-medium">Retake this job interview?</p>
                            <p className="text-xs text-muted-foreground">
                              Reset your progress anytime to retake all rounds with fresh questions from Round 1.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-primary/50 text-primary hover:bg-primary/10 flex items-center gap-1.5 shrink-0"
                            onClick={() => handleRetakeApplication(app.id)}
                            disabled={resettingAppId === app.id}
                          >
                            {resettingAppId === app.id ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Resetting...
                              </>
                            ) : (
                              <>
                                <RotateCcw className="h-3.5 w-3.5" />
                                Retake / Fresh Interview
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </AccordionContent>
                  </GlassCard>
                </AccordionItem>
              </motion.div>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
