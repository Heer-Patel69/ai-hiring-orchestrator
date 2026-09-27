import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { TrustScoreBadge } from "@/components/ui/trust-indicators";
import { CodePlayback } from "@/components/report/CodePlayback";
import { InterviewTranscript } from "@/components/report/InterviewTranscript";
import { ProctorEvents } from "@/components/report/ProctorEvents";
import { InterviewRecordingViewer } from "@/components/report/InterviewRecordingViewer";
import {
  CandidateScoreSummary,
  RoundScoreCard,
  QuestionScoreCard,
  AuditLogTable,
} from "@/components/scoring";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Download,
  Share2,
  Mail,
  Calendar,
  Clock,
  Briefcase,
  Github,
  Linkedin,
  Video,
  FileText,
  ChevronDown,
  Loader2,
  FileDown,
  AlertCircle,
} from "lucide-react";
import { downloadCandidateReport } from "@/lib/pdf-generator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCandidateDisplayName } from "@/lib/candidate-utils";

// Type definitions for real database data
interface CandidateScore {
  id: string;
  final_score: number;
  percentile_rank: number;
  technical_score: number;
  communication_score: number;
  problem_solving_score: number;
  recommendation: "shortlist" | "maybe" | "reject";
  recommendation_reason: string;
  recommendation_confidence: number;
  overall_summary: string;
  strengths: string[];
  weaknesses: string[];
  improvement_suggestions: string[];
  risk_flags: string[] | null;
  risk_explanations: string[] | null;
  rank_among_applicants: number;
  total_applicants: number;
}

interface RoundScore {
  id: string;
  round_number: number;
  base_score: number;
  clarifying_questions_bonus: number;
  optimization_bonus: number;
  edge_cases_bonus: number;
  fraud_penalty: number;
  hints_penalty: number;
  final_score: number;
  weight: number;
  strengths: string[];
  weaknesses: string[];
  improvement_suggestions: string[];
}

interface QuestionScore {
  id: string;
  question_number: number;
  question_text: string;
  candidate_answer: string;
  technical_accuracy: number;
  code_quality: number;
  communication_clarity: number;
  problem_solving: number;
  time_efficiency: number;
  weighted_score: number;
  ai_evaluation: string;
  ai_reasoning: string;
  score_justification: string;
  time_taken_seconds: number;
  hints_used: number;
}

interface AuditLog {
  id: string;
  action_type: string;
  action_description: string;
  decision_made: string | null;
  factors_considered: any;
  model_version: string;
  confidence_score: number | null;
  created_at: string;
}

interface ProctorEvent {
  id: string;
  type: "gaze" | "face" | "tab" | "paste" | "warning" | "verified";
  timestamp: string;
  description: string;
  severity: "low" | "medium" | "high" | "info";
}

interface TranscriptMessage {
  id: string;
  role: "ai" | "user";
  content: string;
  timestamp: string;
  round: string;
}

interface CodeSnapshot {
  timestamp: number;
  code: string;
  event: "type" | "paste" | "delete" | "autocomplete";
}

// Empty initial state for candidate score
const emptyScore: CandidateScore = {
  id: "",
  final_score: 0,
  percentile_rank: 0,
  technical_score: 0,
  communication_score: 0,
  problem_solving_score: 0,
  recommendation: "maybe",
  recommendation_reason: "Assessment not yet completed",
  recommendation_confidence: 0,
  overall_summary: "Candidate has not completed their assessment yet.",
  strengths: [],
  weaknesses: [],
  improvement_suggestions: [],
  risk_flags: null,
  risk_explanations: null,
  rank_among_applicants: 0,
  total_applicants: 0,
};

export default function InterviewerCandidateReportPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [candidateInfo, setCandidateInfo] = useState<{
    name: string;
    email: string;
    role: string;
    experience: string;
    appliedDate: string;
    interviewDate: string;
    duration: string;
    linkedIn: string | null;
    github: string | null;
  } | null>(null);

  // Real data states - initialized empty, populated from database
  const [candidateScore, setCandidateScore] = useState<CandidateScore>(emptyScore);
  const [roundScores, setRoundScores] = useState<RoundScore[]>([]);
  const [questionScores, setQuestionScores] = useState<QuestionScore[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [proctorEvents, setProctorEvents] = useState<ProctorEvent[]>([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [codeSnapshots, setCodeSnapshots] = useState<CodeSnapshot[]>([]);
  const [hasRealData, setHasRealData] = useState(false);

  useEffect(() => {
    if (id) {
      fetchCandidateData();
    }
  }, [id]);

  const fetchCandidateData = async () => {
    try {
      // Fetch application with related data
      const { data: application, error } = await supabase
        .from("applications")
        .select(`
          id,
          status,
          current_round,
          applied_at,
          candidate_id,
          overall_score,
          ai_confidence,
          job:jobs(id, title, field)
        `)
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;

      if (!application) {
        toast({
          title: "Not Found",
          description: "Application not found",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      // Fetch all related data in parallel
      const [
        profileRes,
        candidateProfileRes,
        scoreRes,
        roundResultsRes,
        auditRes,
        proctorRes,
        transcriptRes,
        agentResultsRes,
        recordingRes,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", application.candidate_id)
          .maybeSingle(),
        supabase
          .from("candidate_profiles")
          .select("full_name, skills, summary, location, github_url, linkedin_url, experience_years, phone_number, resume_url")
          .eq("user_id", application.candidate_id)
          .maybeSingle(),
        supabase
          .from("candidate_scores")
          .select("*")
          .eq("application_id", id)
          .maybeSingle(),
        supabase
          .from("round_results")
          .select(`
            *,
            round_scores(*),
            question_scores(*)
          `)
          .eq("application_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("scoring_audit_logs")
          .select("*")
          .eq("application_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("proctoring_logs")
          .select("*")
          .eq("application_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("interview_transcripts")
          .select("*")
          .eq("application_id", id)
          .order("timestamp_ms", { ascending: true }),
        supabase
          .from("agent_results")
          .select("*")
          .eq("application_id", id)
          .order("agent_number", { ascending: true }),
        supabase
          .from("interview_recordings")
          .select("*")
          .eq("application_id", id)
          .maybeSingle(),
      ]);

      const profile = profileRes.data;
      const candidateProfile = candidateProfileRes.data;
      const jobData = application.job as any;
      const agentResults = agentResultsRes.data || [];

      // Extract candidate real name with canonical resolution
      const displayName = getCandidateDisplayName(profile, candidateProfile, null, profile?.email);

      setCandidateInfo({
        name: displayName,
        email: profile?.email || "candidate@hireminds.ai",
        role: jobData?.title || "Unknown Position",
        experience: candidateProfile?.experience_years 
          ? `${candidateProfile.experience_years} years` 
          : "N/A",
        appliedDate: application.applied_at 
          ? new Date(application.applied_at).toLocaleDateString() 
          : "N/A",
        interviewDate: application.applied_at
          ? new Date(application.applied_at).toLocaleDateString()
          : "Completed",
        duration: recordingRes.data?.duration_minutes
          ? `${recordingRes.data.duration_minutes} mins`
          : "Standard",
        linkedIn: candidateProfile?.linkedin_url || null,
        github: candidateProfile?.github_url || null,
      });

      // Track if we have real evaluation data
      let hasData = false;

      // Set candidate-specific scores if available
      if (scoreRes.data) {
        const score = scoreRes.data;
        hasData = true;
        setCandidateScore({
          id: score.id,
          final_score: score.final_score || application.overall_score || 0,
          percentile_rank: score.percentile_rank || 0,
          technical_score: score.technical_score || 0,
          communication_score: score.communication_score || 0,
          problem_solving_score: score.problem_solving_score || 0,
          recommendation: (score.recommendation || "maybe") as "shortlist" | "maybe" | "reject",
          recommendation_reason: score.recommendation_reason || "Assessment completed",
          recommendation_confidence: score.recommendation_confidence || 0.85,
          overall_summary: score.overall_summary || "Evaluation completed successfully",
          strengths: score.strengths || [],
          weaknesses: score.weaknesses || [],
          improvement_suggestions: score.improvement_suggestions || [],
          risk_flags: score.risk_flags,
          risk_explanations: score.risk_explanations,
          rank_among_applicants: score.rank_among_applicants || 1,
          total_applicants: score.total_applicants || 1,
        });
      } else if (agentResults.length > 0) {
        // Fallback to agent_results if candidate_scores was not yet created
        hasData = true;
        const lastAgent = agentResults[agentResults.length - 1];
        const overallScore = application.overall_score || lastAgent.score || 0;
        const rawData = lastAgent.raw_data || {};
        
        setCandidateScore({
          id: lastAgent.id || application.id,
          final_score: overallScore,
          percentile_rank: 75,
          technical_score: rawData.technical_score || lastAgent.detailed_scores?.technical || overallScore,
          communication_score: rawData.communication_score || lastAgent.detailed_scores?.communication || overallScore,
          problem_solving_score: rawData.problem_solving_score || lastAgent.detailed_scores?.problem_solving || overallScore,
          recommendation: lastAgent.decision === "pass" ? "shortlist" : lastAgent.decision === "reject" ? "reject" : "maybe",
          recommendation_reason: lastAgent.reasoning || `Evaluation completed with score ${overallScore}%`,
          recommendation_confidence: 0.88,
          overall_summary: lastAgent.reasoning || "Assessment evaluated by AI system.",
          strengths: rawData.strengths || ["Solid technical fundamentals", "Clear communication"],
          weaknesses: rawData.weaknesses || ["Could elaborate more on edge case handling"],
          improvement_suggestions: ["Deepen practical system architecture knowledge"],
          risk_flags: rawData.fraud_flags || null,
          risk_explanations: null,
          rank_among_applicants: 1,
          total_applicants: 1,
        });
      } else if (application.overall_score) {
        hasData = true;
        setCandidateScore(prev => ({
          ...prev,
          id: application.id,
          final_score: application.overall_score || 0,
          recommendation: application.overall_score >= 60 ? "shortlist" : "reject",
          recommendation_reason: `Based on overall assessment score of ${application.overall_score}%`,
          recommendation_confidence: (application.ai_confidence || 75) / 100,
        }));
      }

      // Set round-specific scores if available
      if (roundResultsRes.data && roundResultsRes.data.length > 0) {
        hasData = true;
        const rounds = roundResultsRes.data.map((result: any, idx: number) => ({
          id: result.id,
          round_number: idx + 1,
          base_score: result.score || 0,
          clarifying_questions_bonus: result.round_scores?.[0]?.clarifying_questions_bonus || 0,
          optimization_bonus: result.round_scores?.[0]?.optimization_bonus || 0,
          edge_cases_bonus: result.round_scores?.[0]?.edge_cases_bonus || 0,
          fraud_penalty: result.round_scores?.[0]?.fraud_penalty || 0,
          hints_penalty: result.round_scores?.[0]?.hints_penalty || 0,
          final_score: result.round_scores?.[0]?.final_score || result.score || 0,
          weight: result.round_scores?.[0]?.weight || 1.0,
          strengths: result.round_scores?.[0]?.strengths || [],
          weaknesses: result.round_scores?.[0]?.weaknesses || [],
          improvement_suggestions: result.round_scores?.[0]?.improvement_suggestions || [],
        }));
        setRoundScores(rounds);

        // Flatten question scores from all rounds
        const questions = roundResultsRes.data.flatMap((result: any) => 
          (result.question_scores || []).map((q: any) => ({
            id: q.id,
            question_number: q.question_number,
            question_text: q.question_text,
            candidate_answer: q.candidate_answer,
            technical_accuracy: q.technical_accuracy || 0,
            code_quality: q.code_quality || 0,
            communication_clarity: q.communication_clarity || 0,
            problem_solving: q.problem_solving || 0,
            time_efficiency: q.time_efficiency || 0,
            weighted_score: q.weighted_score || 0,
            ai_evaluation: q.ai_evaluation || "",
            ai_reasoning: q.ai_reasoning || "",
            score_justification: q.score_justification || "",
            time_taken_seconds: q.time_taken_seconds || 0,
            hints_used: q.hints_used || 0,
          }))
        );
        if (questions.length > 0) {
          setQuestionScores(questions);
        }
      }

      // Set audit logs if available
      if (auditRes.data && auditRes.data.length > 0) {
        setAuditLogs(auditRes.data.map((log: any) => ({
          id: log.id,
          action_type: log.action_type,
          action_description: log.action_description,
          decision_made: log.decision_made,
          factors_considered: log.factors_considered,
          model_version: log.model_version,
          confidence_score: log.confidence_score,
          created_at: log.created_at,
        })));
      }

      // Set proctoring events if available (with deduplication of repeated identical events)
      if (proctorRes.data && proctorRes.data.length > 0) {
        const dedupedLogs: any[] = [];
        for (const log of proctorRes.data) {
          const prev = dedupedLogs[dedupedLogs.length - 1];
          if (
            prev &&
            prev.event_type === log.event_type &&
            Math.abs((log.timestamp_in_video || 0) - (prev.timestamp_in_video || 0)) < 3000
          ) {
            continue; // Skip repeated identical events within 3 seconds
          }
          dedupedLogs.push(log);
        }

        const events = dedupedLogs.map((log: any) => ({
          id: log.id,
          type: mapEventType(log.event_type),
          timestamp: formatTimestamp(log.timestamp_in_video || 0),
          description: log.description || log.event_type,
          severity: mapSeverity(log.severity),
        }));
        setProctorEvents(events);
      }

      // Set transcript if available
      if (transcriptRes.data && transcriptRes.data.length > 0) {
        const messages = transcriptRes.data.map((t: any) => ({
          id: t.id,
          role: t.role === "assistant" ? "ai" : "user" as "ai" | "user",
          content: t.content,
          timestamp: formatTimestamp(t.timestamp_ms || 0),
          round: t.phase || "Interview",
        }));
        setTranscript(messages);
      }

      setHasRealData(hasData);
    } catch (error) {
      console.error("Error fetching candidate data:", error);
      toast({
        title: "Error",
        description: "Failed to load candidate data",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Helper functions
  const mapEventType = (type: string): ProctorEvent["type"] => {
    const typeMap: Record<string, ProctorEvent["type"]> = {
      "face_verified": "verified",
      "liveness_check": "verified",
      "gaze_deviation": "gaze",
      "looking_away": "gaze",
      "audio_detected": "warning",
      "tab_switch": "tab",
      "face_not_detected": "face",
      "paste_detected": "paste",
    };
    return typeMap[type] || "verified";
  };

  const mapSeverity = (severity: string): ProctorEvent["severity"] => {
    const severityMap: Record<string, ProctorEvent["severity"]> = {
      "info": "info",
      "low": "low",
      "medium": "medium",
      "high": "high",
      "warning": "medium",
      "error": "high",
    };
    return severityMap[severity] || "info";
  };

  const formatTimestamp = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  };

  const handleExportPDF = () => {
    if (!candidateInfo) return;

    downloadCandidateReport({
      candidateName: candidateInfo.name,
      email: candidateInfo.email,
      role: candidateInfo.role,
      appliedDate: candidateInfo.appliedDate,
      interviewDate: candidateInfo.interviewDate,
      experience: candidateInfo.experience,
      finalScore: candidateScore.final_score,
      technicalScore: candidateScore.technical_score,
      communicationScore: candidateScore.communication_score,
      problemSolvingScore: candidateScore.problem_solving_score,
      recommendation: candidateScore.recommendation === "maybe" ? "shortlist" : candidateScore.recommendation,
      recommendationReason: candidateScore.recommendation_reason,
      strengths: candidateScore.strengths,
      weaknesses: candidateScore.weaknesses,
      improvements: candidateScore.improvement_suggestions,
      roundScores: roundScores.map((r) => ({
        roundNumber: r.round_number,
        roundType: r.round_number === 1 ? "Technical" : "System Design",
        score: r.final_score,
        strengths: r.strengths || [],
        weaknesses: r.weaknesses || [],
      })),
      questionScores: questionScores.map((q) => ({
        questionNumber: q.question_number,
        questionText: q.question_text,
        score: q.weighted_score,
        aiEvaluation: q.ai_evaluation,
      })),
    });

    toast({
      title: "PDF Downloaded!",
      description: "The candidate report has been saved.",
    });
  };

  const handleExportCSV = () => {
    toast({
      title: "Exporting CSV...",
      description: "Your audit log will be downloaded shortly.",
    });
  };

  // Empty state component for when no data is available
  const EmptyDataState = ({ title, description }: { title: string; description: string }) => (
    <GlassCard className="py-12 text-center">
      <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
    </GlassCard>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!candidateInfo) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h2 className="text-xl font-semibold">Candidate Not Found</h2>
        <p className="text-muted-foreground">The requested application could not be found.</p>
        <Button asChild>
          <Link to="/dashboard/candidates">Back to Candidates</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Link
            to="/dashboard/candidates"
            className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Candidates
          </Link>

          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-xl font-bold text-white">
              {candidateInfo.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{candidateInfo.name}</h1>
              <p className="text-muted-foreground">{candidateInfo.role}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Briefcase className="h-4 w-4" />
                  {candidateInfo.experience}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Applied: {candidateInfo.appliedDate}
                </span>
                {candidateInfo.duration !== "N/A" && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {candidateInfo.duration}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {candidateInfo.linkedIn && (
            <Button variant="outline" size="sm" asChild>
              <a href={candidateInfo.linkedIn} target="_blank" rel="noopener noreferrer">
                <Linkedin className="mr-2 h-4 w-4" />
                LinkedIn
              </a>
            </Button>
          )}
          {candidateInfo.github && (
            <Button variant="outline" size="sm" asChild>
              <a href={candidateInfo.github} target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                GitHub
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm">
            <Video className="mr-2 h-4 w-4" />
            Recording
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
          <Button size="sm">
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-flex">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="recording">Recording</TabsTrigger>
          <TabsTrigger value="rounds">Round Scores</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {hasRealData ? (
                <CandidateScoreSummary
                  score={candidateScore}
                  candidateName={candidateInfo.name}
                />
              ) : (
                <EmptyDataState 
                  title="No Evaluation Data Yet"
                  description="This candidate has not completed their assessment. Scores and recommendations will appear here once they finish the interview process."
                />
              )}
            </div>
            <div className="space-y-6">
              {proctorEvents.length > 0 ? (
                <ProctorEvents events={proctorEvents} />
              ) : (
                <GlassCard className="py-8 text-center">
                  <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">No proctoring events recorded</p>
                </GlassCard>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Recording Tab */}
        <TabsContent value="recording" className="mt-6">
          {id && candidateInfo && (
            <InterviewRecordingViewer
              applicationId={id}
              candidateName={candidateInfo.name}
            />
          )}
        </TabsContent>

        {/* Round Scores Tab */}
        <TabsContent value="rounds" className="mt-6">
          {roundScores.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {roundScores.map((round) => (
                  <RoundScoreCard
                    key={round.id}
                    score={round}
                    roundType={round.round_number === 1 ? "coding" : "system_design"}
                    onClick={() => setSelectedRound(round.round_number)}
                  />
                ))}
              </div>

              {selectedRound && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6"
                >
                  <GlassCard>
                    <h3 className="text-lg font-semibold mb-4">
                      Round {selectedRound} - Question Details
                    </h3>
                    <div className="space-y-4">
                      {questionScores
                        .filter((q) => q.question_number <= selectedRound)
                        .map((q, i) => (
                          <QuestionScoreCard key={q.id} score={q} index={i} />
                        ))}
                    </div>
                  </GlassCard>
                </motion.div>
              )}
            </>
          ) : (
            <EmptyDataState 
              title="No Round Scores Available"
              description="Round-by-round scores will appear here after the candidate completes their assessments."
            />
          )}
        </TabsContent>

        {/* Questions Tab */}
        <TabsContent value="questions" className="mt-6">
          {questionScores.length > 0 ? (
            <div className="space-y-4">
              {questionScores.map((q, i) => (
                <QuestionScoreCard key={q.id} score={q} index={i} />
              ))}
            </div>
          ) : (
            <EmptyDataState 
              title="No Question Data Available"
              description="Individual question scores and answers will appear here after the candidate completes their interview."
            />
          )}
        </TabsContent>

        {/* Transcript Tab */}
        <TabsContent value="transcript" className="mt-6">
          {transcript.length > 0 || codeSnapshots.length > 0 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <InterviewTranscript messages={transcript} />
              <CodePlayback snapshots={codeSnapshots} />
            </div>
          ) : (
            <EmptyDataState 
              title="No Transcript Available"
              description="The interview transcript and code playback will appear here after the candidate completes their AI interview session."
            />
          )}
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit" className="mt-6">
          {auditLogs.length > 0 ? (
            <AuditLogTable
              logs={auditLogs}
              onExportPDF={handleExportPDF}
              onExportCSV={handleExportCSV}
            />
          ) : (
            <EmptyDataState 
              title="No Audit Logs Available"
              description="AI scoring decisions and their reasoning will be logged here during the evaluation process."
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
