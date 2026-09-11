import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  VideoPanel,
  ContinuousVoicePanel,
  BhashiniVoiceAgent,
  CodeEditorPanel,
  WhiteboardPanel,
  ProctoringMonitor,
  useTextToSpeech,
  type Message,
} from "@/components/interview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Brain,
  CheckCircle2,
  Clock,
  Code2,
  LogOut,
  MessageSquare,
  Sparkles,
  Trophy,
  AlertTriangle,
  Layout,
  Maximize2,
  Minimize2,
  Mic,
  Zap,
  Shield,
  ArrowRight,
  Loader2,
  Video,
  ChevronUp,
  ChevronDown,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import { AntiCheatOverlay, AntiCheatStatusBadge } from "@/components/proctoring";
import { useJobRoundConfig, useNextRound } from "@/hooks/useJobRoundConfig";
import { useInterviewRecording } from "@/hooks/useInterviewRecording";
import { useProctoringLogger } from "@/hooks/useProctoringLogger";
import { useIsMobile } from "@/hooks/use-mobile";

type InterviewStatus = "preparing" | "in-progress" | "completing" | "completed";
type InterviewType = "technical" | "system-design" | "behavioral";
type WorkspaceMode = "code" | "whiteboard" | "conversation";

const DEFAULT_INTERVIEW_DURATION = 45 * 60; // 45 minutes in seconds

interface ProctoringEvent {
  type: string;
  timestamp: Date;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export default function AIInterviewRoomPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { speak, stop: stopSpeaking, isSpeaking: ttsIsSpeaking } = useTextToSpeech();

  // Interview state
  const [status, setStatus] = useState<InterviewStatus>("preparing");
  const [interviewType] = useState<InterviewType>(
    (searchParams.get("type") as InterviewType) || "technical"
  );
  const [voiceMode, setVoiceMode] = useState<"standard" | "realtime">("realtime"); // Default to ElevenLabs realtime
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(true);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    interviewType === "system-design" ? "whiteboard" : interviewType === "technical" ? "code" : "conversation"
  );
  
  // Mobile state for panel visibility - MUST be declared here with other hooks
  const [mobilePanel, setMobilePanel] = useState<"video" | "code" | null>(null);
  const [showMobileVideo, setShowMobileVideo] = useState(false);
  // Anti-cheat system
  const antiCheat = useAntiCheat({
    enforceFullscreen: true,
    maxTabSwitches: 3,
    maxFocusLoss: 5,
    blockCopyPaste: true,
    blockRightClick: true,
    blockDevTools: true,
    blockScreenshot: true,
    autoTerminateOnViolation: false,
    onEvent: (event) => {
      // Map to proctoring event format (filter out 'critical' severity for compatibility)
      const severityMap: Record<string, "low" | "medium" | "high"> = {
        low: "low",
        medium: "medium",
        high: "high",
        critical: "high", // Map critical to high for compatibility
      };
      setProctoringEvents((prev) => [...prev, {
        type: event.type as any,
        timestamp: event.timestamp,
        severity: severityMap[event.severity] || "high",
        description: event.description,
      }]);
    },
  });

  // Timer state
  const [elapsedTime, setElapsedTime] = useState(0);
  const [interviewDuration, setInterviewDuration] = useState(DEFAULT_INTERVIEW_DURATION);
  const [remainingTime, setRemainingTime] = useState(DEFAULT_INTERVIEW_DURATION);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Dialog state
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);

  // Scores & Proctoring
  const [currentScore, setCurrentScore] = useState(0);
  const [questionCount, setQuestionCount] = useState(0);
  const [proctoringEvents, setProctoringEvents] = useState<ProctoringEvent[]>([]);
  
  // Evaluation results
  const [evaluationResult, setEvaluationResult] = useState<{
    score: number;
    passed: boolean;
    strengths: string[];
    weaknesses: string[];
  } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  
  // Job and round configuration
  const applicationId = searchParams.get("application");
  const { data: jobConfig } = useJobRoundConfig(applicationId);
  const currentRoundNumber = jobConfig?.currentRoundNumber || 1;
  const { data: nextRound } = useNextRound(applicationId, currentRoundNumber);
  
  // Get current user ID for recording
  const [candidateId, setCandidateId] = useState<string | null>(null);
  
  // Interview recording hook
  const interviewRecording = useInterviewRecording({
    applicationId,
    candidateId,
    onRecordingComplete: (url) => {
      console.log("Recording saved:", url);
    },
  });

  // Proctoring logger hook
  const proctoringLogger = useProctoringLogger({
    applicationId,
    recordingId: interviewRecording.recordingId,
    candidateId,
  });
  
  // Job context for dynamic configuration
  const [jobContext, setJobContext] = useState<{
    toughnessLevel: number;
    jobField: string;
    jobTitle: string;
    candidateName?: string;
  } | null>(null);

  // Fetch job context and candidate info on mount
  useEffect(() => {
    const fetchJobContext = async () => {
      const applicationId = searchParams.get("application");
      
      try {
        // Fetch current user's profile for candidate name
        const { data: { user } } = await supabase.auth.getUser();
        let candidateName: string | undefined;
        
        if (user) {
          // Set candidate ID for recording
          setCandidateId(user.id);
          
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", user.id)
            .maybeSingle();
          
          if (profile?.full_name) {
            candidateName = profile.full_name;
          }
        }
        
        if (!applicationId) {
          // Even without application, set candidate name
          setJobContext({
            toughnessLevel: 3,
            jobField: "General",
            jobTitle: "Unknown Position",
            candidateName,
          });
          return;
        }

        const { data: application } = await supabase
          .from("applications")
          .select(`
            job_id,
            current_round,
            jobs(id, title, field, toughness_level)
          `)
          .eq("id", applicationId)
          .maybeSingle();

        if (application?.jobs) {
          const job = application.jobs as any;
          setJobContext({
            toughnessLevel: job.toughness_level || 3,
            jobField: job.field || "General",
            jobTitle: job.title || "Unknown Position",
            candidateName,
          });

          // Fetch round-specific duration
          const { data: round } = await supabase
            .from("job_rounds")
            .select("duration_minutes")
            .eq("job_id", job.id)
            .eq("round_number", (application.current_round || 0) + 1)
            .maybeSingle();

          if (round?.duration_minutes) {
            const durationSeconds = round.duration_minutes * 60;
            setInterviewDuration(durationSeconds);
            setRemainingTime(durationSeconds);
          }
        } else {
          // No application found, still set candidate name
          setJobContext({
            toughnessLevel: 3,
            jobField: "General",
            jobTitle: "Unknown Position",
            candidateName,
          });
        }
      } catch (error) {
        console.error("Error fetching job context:", error);
      }
    };

    fetchJobContext();
  }, [searchParams]);

  // Start anti-cheat when interview begins
  useEffect(() => {
    if (status === "in-progress" && !antiCheat.isActive) {
      antiCheat.startMonitoring();
    } else if (status !== "in-progress" && antiCheat.isActive) {
      antiCheat.stopMonitoring();
    }
  }, [status]);

  // Start interview timer
  useEffect(() => {
    if (status === "in-progress") {
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
        setRemainingTime((prev) => {
          if (prev <= 1) {
            handleEndInterview();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [status]);

  // Fullscreen handling - now uses anti-cheat system
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      antiCheat.requestFullscreen();
    } else {
      antiCheat.exitFullscreen();
    }
  }, [antiCheat]);

  // Start interview with greeting
  const startInterview = useCallback(async () => {
    setStatus("in-progress");
    setIsLoading(true);

    // Start recording and proctoring
    try {
      await interviewRecording.startRecording();
      proctoringLogger.startLogging();
    } catch (error) {
      console.error("Failed to start recording:", error);
      // Continue even if recording fails
    }

    try {
      const greeting = await sendToAgent([
        { role: "user", content: "Start the interview. Greet me and introduce yourself briefly." }
      ]);

      if (greeting) {
        setMessages([
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: greeting,
            timestamp: new Date(),
          },
        ]);
        setQuestionCount(1);

        // Speak the greeting
        if (isSpeaking) {
          speak(greeting);
          setAiSpeaking(true);
        }
      }
    } catch (error) {
      console.error("Failed to start interview:", error);
      toast({
        title: "Failed to start interview",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, isSpeaking, speak, interviewRecording, proctoringLogger]);

  // Send message to AI agent
  const sendToAgent = async (conversationMessages: Array<{ role: string; content: string }>) => {
    // Map toughness level to string
    const toughnessMap: Record<number, string> = {
      1: "easy",
      2: "easy-medium",
      3: "medium",
      4: "medium-hard",
      5: "hard",
    };
    
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/interview-agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: conversationMessages,
          jobField: jobContext?.jobField || (interviewType === "technical" ? "Data Structures and Algorithms" : 
                   interviewType === "system-design" ? "System Design" : "Behavioral"),
          toughnessLevel: toughnessMap[jobContext?.toughnessLevel || 3] || "medium",
          currentQuestionIndex: questionCount,
          candidateScore: currentScore,
          jobTitle: jobContext?.jobTitle,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get response from AI");
    }

    // Handle streaming response
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") break;

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
          }
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }

    return fullContent;
  };

  // Handle sending a message
  const handleSendMessage = useCallback(
    async (content: string) => {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      stopSpeaking();

      try {
        const conversationHistory = [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content },
        ];

        const response = await sendToAgent(conversationHistory);

        if (response) {
          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: response,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setQuestionCount((prev) => prev + 1);

          // Speak the response
          if (isSpeaking) {
            speak(response);
            setAiSpeaking(true);
          }
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        toast({
          title: "Failed to get response",
          description: "Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isSpeaking, toast, speak, stopSpeaking]
  );

  // Handle TTS state
  useEffect(() => {
    setAiSpeaking(ttsIsSpeaking);
  }, [ttsIsSpeaking]);

  // Handle code analysis completion
  const handleCodeAnalysis = useCallback((analysis: any) => {
    if (analysis.overallScore) {
      setCurrentScore((prev) => Math.round((prev + analysis.overallScore) / 2));
    }
  }, []);

  // Handle proctoring events
  const handleProctoringEvent = useCallback((event: ProctoringEvent) => {
    setProctoringEvents((prev) => [...prev, event]);
    // Also log to database via proctoring logger
    if (applicationId && candidateId) {
      // Map local event type to valid proctoring log event type
      const validEventTypes = [
        "face_detected", "face_not_visible", "multiple_faces", "looking_away",
        "tab_switch", "copy_paste", "audio_anomaly", "suspicious_movement",
        "recording_started", "recording_stopped", "camera_blocked", "screen_share_detected"
      ] as const;
      
      const eventType = validEventTypes.includes(event.type as any) 
        ? event.type as typeof validEventTypes[number]
        : "suspicious_movement";
        
      proctoringLogger.logEvent({
        type: eventType,
        timestamp: event.timestamp,
        description: event.description,
        severity: event.severity,
      });
    }
  }, [applicationId, candidateId, proctoringLogger]);

  // End interview
  const handleEndInterview = useCallback(async () => {
    setStatus("completing");
    setIsEvaluating(true);
    stopSpeaking();
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Stop recording and proctoring
    try {
      interviewRecording.stopRecording();
      await proctoringLogger.stopLogging();
    } catch (error) {
      console.error("Error stopping recording/proctoring:", error);
    }

    try {
      // Get closing message
      const closingMessage = await sendToAgent([
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: "The interview time is up. Please conclude the interview with a brief thank you and feedback summary." },
      ]);

      if (closingMessage) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: closingMessage,
            timestamp: new Date(),
          },
        ]);

        if (isSpeaking) {
          speak(closingMessage);
        }
      }
      
      // Call the agent-interviewer edge function to evaluate the full interview
      if (applicationId) {
        const { data: evalResult, error: evalError } = await supabase.functions.invoke("agent-interviewer", {
          body: {
            application_id: applicationId,
            action: "end_interview",
          },
        });

        if (evalError) {
          console.error("Evaluation error:", evalError);
        } else if (evalResult?.result) {
          const score = evalResult.result.score || 0;
          const passingScore = jobConfig?.job?.round_config?.interview?.passing_score || 60;
          const passed = score >= passingScore;
          
          setCurrentScore(score);
          setEvaluationResult({
            score,
            passed,
            strengths: evalResult.evaluation?.strengths || [],
            weaknesses: evalResult.evaluation?.weaknesses || [],
          });
        }
      }
    } catch (error) {
      console.error("Failed to complete interview:", error);
    } finally {
      setIsEvaluating(false);
    }

    setStatus("completed");
    setShowCompletionDialog(true);
  }, [messages, isSpeaking, speak, stopSpeaking, applicationId, jobConfig, interviewRecording, proctoringLogger]);

  // Toggle listening
  const toggleListening = useCallback(() => {
    setIsListening((prev) => !prev);
  }, []);

  // Render preparing screen
  if (status === "preparing") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full"
        >
          <GlassCard className="text-center">
            <div className="mb-6">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Brain className="h-10 w-10 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-2">AI Interview Room</h1>
              <p className="text-muted-foreground">
                You're about to start a {interviewType.replace("-", " ")} interview with our AI interviewer.
              </p>
            </div>

            <div className="space-y-4 mb-6 text-left">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Duration: 45 minutes</p>
                  <p className="text-sm text-muted-foreground">Timer will start when you begin</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-success/10 border border-success/30">
                <Mic className="h-5 w-5 text-success" />
                <div>
                  <p className="font-medium flex items-center gap-2">
                    Real-time Voice
                    <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                      <Zap className="h-3 w-3 mr-1" />
                      AI-Powered
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">Natural conversation — just speak, no buttons needed</p>
                </div>
              </div>

              {interviewType === "technical" && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                  <Code2 className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Code Editor</p>
                    <p className="text-sm text-muted-foreground">Write and run code for DSA problems</p>
                  </div>
                </div>
              )}

              {interviewType === "system-design" && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                  <Layout className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Whiteboard</p>
                    <p className="text-sm text-muted-foreground">Draw diagrams for system design</p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 rounded-lg bg-warning/10 border border-warning/30 mb-6">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                <div className="text-left">
                  <p className="text-sm font-medium text-warning">Important</p>
                  <p className="text-sm text-muted-foreground">
                    Ensure your camera and microphone are working. The interview will be recorded and proctored.
                  </p>
                </div>
              </div>
            </div>

            <Button onClick={startInterview} variant="hero" className="w-full" size="lg">
              <Sparkles className="h-5 w-5 mr-2" />
              Start Interview
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // Handle advancing to next round
  const handleAdvanceToNext = async () => {
    if (!applicationId || !nextRound) return;

    setIsAdvancing(true);
    try {
      // Update application to next round
      const { error } = await supabase
        .from("applications")
        .update({
          current_round: nextRound.round_number,
          status: "interviewing",
        })
        .eq("id", applicationId);

      if (error) throw error;

      // Navigate to appropriate assessment
      const routeMap: Record<string, string> = {
        mcq: "/candidate/assessment/mcq",
        coding: "/candidate/assessment/coding",
        behavioral: "/candidate/interview/live",
        system_design: "/candidate/interview/live",
        live_ai_interview: "/candidate/interview/live",
      };

      const route = routeMap[nextRound.round_type] || "/candidate/interview";
      navigate(`${route}?application=${applicationId}`);

      toast({
        title: "Moving to next round!",
        description: `Get ready for your ${nextRound.round_type.replace(/_/g, " ")}`,
      });
    } catch (error) {
      console.error("Error advancing to next round:", error);
      toast({
        title: "Error",
        description: "Failed to advance to next round. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAdvancing(false);
    }
  };

  // Render completed screen
  if (status === "completed" && showCompletionDialog) {
    const passed = evaluationResult?.passed ?? (currentScore >= 60);
    
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full"
        >
          <GlassCard className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="mb-6"
            >
              <div className={cn(
                "h-24 w-24 rounded-full flex items-center justify-center mx-auto mb-4",
                passed ? "bg-success/10" : "bg-danger/10"
              )}>
                <Trophy className={cn("h-12 w-12", passed ? "text-success" : "text-danger")} />
              </div>
              <h1 className="text-2xl font-bold mb-2">Interview Complete!</h1>
              <p className="text-muted-foreground">
                {isEvaluating 
                  ? "Analyzing your responses..." 
                  : passed 
                    ? "Congratulations! You've passed this round." 
                    : "Thank you for completing the interview."}
              </p>
            </motion.div>

            <div className={cn(
              "p-4 rounded-lg mb-6",
              passed ? "bg-success/10 border border-success/20" : "bg-primary/5 border border-primary/20"
            )}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Your Score</span>
                {isEvaluating ? (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Evaluating...
                  </Badge>
                ) : (
                  <Badge className={passed ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground"}>
                    {passed ? "Passed" : "Completed"}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4">
                <Progress value={currentScore} className="flex-1" />
                <span className={cn("text-2xl font-bold", passed ? "text-success" : "text-foreground")}>
                  {currentScore}%
                </span>
              </div>
            </div>

            <div className="space-y-3 mb-6 text-left">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>Interview recorded successfully</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>{questionCount} questions answered</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>Duration: {Math.floor(elapsedTime / 60)} minutes</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>Trust Score: {antiCheat.trustScore}%</span>
              </div>
            </div>

            {/* Strengths & Weaknesses */}
            {evaluationResult && (evaluationResult.strengths.length > 0 || evaluationResult.weaknesses.length > 0) && (
              <div className="mb-6 text-left space-y-3">
                {evaluationResult.strengths.length > 0 && (
                  <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                    <p className="text-sm font-medium text-success mb-1">Strengths</p>
                    <ul className="text-sm text-muted-foreground list-disc list-inside">
                      {evaluationResult.strengths.slice(0, 3).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {evaluationResult.weaknesses.length > 0 && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                    <p className="text-sm font-medium text-warning mb-1">Areas for Improvement</p>
                    <ul className="text-sm text-muted-foreground list-disc list-inside">
                      {evaluationResult.weaknesses.slice(0, 3).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Next Round Button */}
            {passed && nextRound && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mb-6 p-4 rounded-xl bg-primary/10 border border-primary/30"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <h4 className="font-semibold">Next: {nextRound.round_type.replace(/_/g, " ")}</h4>
                    <p className="text-sm text-muted-foreground">
                      Round {nextRound.round_number} • {nextRound.duration_minutes} minutes
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleAdvanceToNext}
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={isAdvancing}
                >
                  {isAdvancing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading Next Assessment...
                    </>
                  ) : (
                    <>
                      Proceed to Next Round
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </motion.div>
            )}

            <Button onClick={() => navigate("/candidate")} className="w-full" variant={passed && nextRound ? "outline" : "default"}>
              Return to Dashboard
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }


  // Main interview room - MOBILE OPTIMIZED
  if (isMobile) {
    return (
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
        {/* Mobile Header - Compact */}
        <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0 safe-area-inset-top">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Brain className="h-3.5 w-3.5 text-primary" />
            </div>
            <Badge
              variant={remainingTime < 300 ? "destructive" : "secondary"}
              className="gap-1 tabular-nums text-xs"
            >
              <Clock className="h-3 w-3" />
              {Math.floor(remainingTime / 60)}:{(remainingTime % 60).toString().padStart(2, "0")}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-xs">
              <MessageSquare className="h-3 w-3" />
              Q{questionCount}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setShowExitDialog(true)}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </header>

        {/* Mobile Main Content */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Floating Video Preview */}
          <AnimatePresence>
            {showMobileVideo && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: -20 }}
                className="absolute top-2 right-2 z-20 w-32 aspect-video rounded-lg overflow-hidden shadow-lg border border-border bg-black"
              >
                <VideoPanel
                  isRecording={status === "in-progress"}
                  elapsedTime={elapsedTime}
                  remainingTime={remainingTime}
                  aiSpeaking={aiSpeaking}
                  className="h-full"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 h-5 w-5 bg-black/50 hover:bg-black/70"
                  onClick={() => setShowMobileVideo(false)}
                >
                  <X className="h-3 w-3 text-white" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Voice Agent - Full width on mobile */}
          <div className="flex-1 min-h-0">
            {voiceMode === "realtime" ? (
              <BhashiniVoiceAgent
                jobField={jobContext?.jobField}
                toughnessLevel={
                  jobContext?.toughnessLevel 
                    ? ["easy", "easy-medium", "medium", "medium-hard", "hard"][jobContext.toughnessLevel - 1] || "medium"
                    : "medium"
                }
                jobTitle={jobContext?.jobTitle}
                candidateName={jobContext?.candidateName}
                onSpeakingChange={setAiSpeaking}
                autoConnect={true}
                className="h-full"
              />
            ) : (
              <ContinuousVoicePanel
                messages={messages}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                aiSpeaking={aiSpeaking}
                autoListen={true}
                className="h-full"
              />
            )}
          </div>

          {/* Mobile Bottom Bar - Quick Actions */}
          <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-xl p-2 safe-area-inset-bottom">
            <div className="flex items-center justify-around gap-2">
              {/* Video Toggle */}
              <Button
                variant={showMobileVideo ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 h-10 gap-1.5"
                onClick={() => setShowMobileVideo(!showMobileVideo)}
              >
                <Video className={cn("h-4 w-4", interviewRecording.isRecording && "text-danger")} />
                <span className="text-xs">Camera</span>
              </Button>

              {/* Code Editor */}
              {interviewType === "technical" && (
                <Button
                  variant={mobilePanel === "code" ? "secondary" : "ghost"}
                  size="sm"
                  className="flex-1 h-10 gap-1.5"
                  onClick={() => setMobilePanel(mobilePanel === "code" ? null : "code")}
                >
                  <Code2 className="h-4 w-4" />
                  <span className="text-xs">Code</span>
                </Button>
              )}

              {/* Whiteboard */}
              {interviewType === "system-design" && (
                <Button
                  variant={mobilePanel === "code" ? "secondary" : "ghost"}
                  size="sm"
                  className="flex-1 h-10 gap-1.5"
                  onClick={() => setMobilePanel(mobilePanel === "code" ? null : "code")}
                >
                  <Layout className="h-4 w-4" />
                  <span className="text-xs">Draw</span>
                </Button>
              )}

              {/* Recording Status */}
              {interviewRecording.isRecording && (
                <Badge variant="outline" className="gap-1 text-danger border-danger/30 px-2">
                  <div className="h-2 w-2 rounded-full bg-danger animate-pulse" />
                  <span className="text-xs">REC</span>
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Code/Whiteboard Drawer */}
        <AnimatePresence>
          {mobilePanel === "code" && (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="absolute inset-0 z-30 bg-background flex flex-col"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <h3 className="font-medium text-sm">
                  {interviewType === "technical" ? "Code Editor" : "Whiteboard"}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMobilePanel(null)}
                >
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Minimize
                </Button>
              </div>
              <div className="flex-1 min-h-0">
                {interviewType === "technical" ? (
                  <CodeEditorPanel
                    problemStatement="Write a function to solve the problem described by the AI interviewer."
                    onAnalysisComplete={handleCodeAnalysis}
                    className="h-full"
                  />
                ) : (
                  <WhiteboardPanel className="h-full" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Exit Confirmation Dialog */}
        <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
          <AlertDialogContent className="max-w-[90vw]">
            <AlertDialogHeader>
              <AlertDialogTitle>End Interview?</AlertDialogTitle>
              <AlertDialogDescription>
                Your progress will be saved and submitted for review.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
              <AlertDialogCancel className="w-full sm:w-auto">Continue</AlertDialogCancel>
              <AlertDialogAction onClick={handleEndInterview} className="w-full sm:w-auto">
                End Interview
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Main interview room - DESKTOP
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-sm">AI Interview</h1>
            <p className="text-xs text-muted-foreground capitalize">{interviewType.replace("-", " ")}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Workspace mode tabs */}
          {interviewType !== "behavioral" && (
            <Tabs value={workspaceMode} onValueChange={(v) => setWorkspaceMode(v as WorkspaceMode)}>
              <TabsList className="h-8">
                <TabsTrigger value="code" className="text-xs px-3" disabled={interviewType === "system-design"}>
                  <Code2 className="h-3.5 w-3.5 mr-1" />
                  Code
                </TabsTrigger>
                <TabsTrigger value="whiteboard" className="text-xs px-3">
                  <Layout className="h-3.5 w-3.5 mr-1" />
                  Whiteboard
                </TabsTrigger>
                <TabsTrigger value="conversation" className="text-xs px-3">
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                  Focus
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <Badge variant="outline" className="gap-1">
            <MessageSquare className="h-3 w-3" />
            Q{questionCount}
          </Badge>

          <Badge
            variant={remainingTime < 300 ? "destructive" : "secondary"}
            className="gap-1 tabular-nums"
          >
            <Clock className="h-3 w-3" />
            {Math.floor(remainingTime / 60)}:{(remainingTime % 60).toString().padStart(2, "0")}
          </Badge>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={toggleFullscreen}
          >
            {antiCheat.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setShowExitDialog(true)}
          >
            <LogOut className="h-4 w-4" />
            End
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-12 gap-4 p-4 min-h-0">
        {/* Left Panel - Video + Proctoring */}
        <div className="col-span-3 flex flex-col gap-4">
          <VideoPanel
            isRecording={status === "in-progress"}
            elapsedTime={elapsedTime}
            remainingTime={remainingTime}
            aiSpeaking={aiSpeaking}
            className="flex-1"
          />
          
          {/* Recording Status */}
          {status === "in-progress" && interviewRecording.isRecording && (
            <Badge variant="outline" className="gap-1 text-danger border-danger/30 justify-center py-1">
              <Video className="h-3 w-3 animate-pulse" />
              Recording
            </Badge>
          )}
          
          {/* Proctoring Monitor - Camera Activity */}
          <ProctoringMonitor
            isActive={status === "in-progress"}
            onEvent={handleProctoringEvent}
            onTrustScoreChange={(score) => {
              // Trust score is also tracked by anti-cheat system
            }}
            applicationId={applicationId}
            candidateId={candidateId}
            recordingId={interviewRecording.recordingId}
            enableCameraMonitoring={true}
          />
          
          {/* Anti-cheat overlay */}
          <AntiCheatOverlay
            state={antiCheat}
            onRequestFullscreen={antiCheat.requestFullscreen}
            showDetailedStatus={true}
          />
        </div>

        {/* Center Panel - Conversation */}
        <div className={cn(
          "flex flex-col",
          workspaceMode === "conversation" ? "col-span-9" : "col-span-4"
        )}>
          {voiceMode === "realtime" ? (
            <BhashiniVoiceAgent
              jobField={jobContext?.jobField}
              toughnessLevel={
                jobContext?.toughnessLevel 
                  ? ["easy", "easy-medium", "medium", "medium-hard", "hard"][jobContext.toughnessLevel - 1] || "medium"
                  : "medium"
              }
              jobTitle={jobContext?.jobTitle}
              candidateName={jobContext?.candidateName}
              onSpeakingChange={setAiSpeaking}
              autoConnect={true}
              className="h-full"
            />
          ) : (
            <ContinuousVoicePanel
              messages={messages}
              isLoading={isLoading}
              onSendMessage={handleSendMessage}
              aiSpeaking={aiSpeaking}
              autoListen={true}
              className="h-full"
            />
          )}
        </div>

        {/* Right Panel - Workspace */}
        {workspaceMode !== "conversation" && (
          <div className="col-span-5">
            <AnimatePresence mode="wait">
              {workspaceMode === "code" && (
                <motion.div
                  key="code"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="h-full"
                >
                  <CodeEditorPanel
                    problemStatement="Write a function to solve the problem described by the AI interviewer."
                    onAnalysisComplete={handleCodeAnalysis}
                    className="h-full"
                  />
                </motion.div>
              )}
              {workspaceMode === "whiteboard" && (
                <motion.div
                  key="whiteboard"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="h-full"
                >
                  <WhiteboardPanel className="h-full" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Exit Confirmation Dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Interview?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to end the interview? Your progress will be saved and submitted for review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Interview</AlertDialogCancel>
            <AlertDialogAction onClick={handleEndInterview}>
              End Interview
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
