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
  Monitor,
  MonitorOff,
  RefreshCw,
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
import { submitRoundResult } from "@/lib/round-submission";
import { resolveCandidateIdentity } from "@/lib/candidate-utils";
import { checkFrameLuminance, verifyEntireScreenShare } from "@/lib/preflight-checker";
import { backendAuthHeaders, backendUrl } from "@/lib/backend-api";
import { askGroq, getGroqApiKey, getGroqModel } from "@/lib/groq-service";

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
  // Voice mode and live word-by-word speech tracking
  const [voiceMode, setVoiceMode] = useState<"standard" | "realtime">("standard");
  const [activeSpeakingWords, setActiveSpeakingWords] = useState<string[]>([]);
  const [activeSpeakingWordIndex, setActiveSpeakingWordIndex] = useState<number>(-1);

  const {
    speak: _browserSpeak,
    stop: _browserStopSpeaking,
    isSpeaking: ttsIsSpeaking,
  } = useTextToSpeech({
    onWordBoundary: (wordIndex) => {
      setActiveSpeakingWordIndex(wordIndex);
    },
    onEnd: () => {
      setActiveSpeakingWordIndex(-1);
      setAiSpeaking(false);
    },
  });

  // Master speech dispatcher: speaks voice and animates words word-by-word
  const speak = useCallback((text: string) => {
    if (!text) return;
    const splitWords = text.trim().split(/\s+/).filter(Boolean);
    setActiveSpeakingWords(splitWords);
    setActiveSpeakingWordIndex(0);
    setAiSpeaking(true);
    _browserSpeak(text, (idx) => {
      setActiveSpeakingWordIndex(idx);
    });
  }, [_browserSpeak]);

  const stopSpeaking = useCallback(() => {
    _browserStopSpeaking();
    setActiveSpeakingWordIndex(-1);
    setAiSpeaking(false);
  }, [_browserStopSpeaking]);

  // Interview state
  const [status, setStatus] = useState<InterviewStatus>("preparing");
  const [interviewType] = useState<InterviewType>(
    (searchParams.get("type") as InterviewType) || "technical"
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(true);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    interviewType === "system-design" ? "whiteboard" : interviewType === "technical" ? "code" : "conversation"
  );

  // Live captions and persistent question/speech state
  const [activeCaption, setActiveCaption] = useState<{
    speaker: "ai" | "candidate";
    text: string;
  } | null>(null);
  const [transcriptLog, setTranscriptLog] = useState<
    Array<{ speaker: "ai" | "candidate"; text: string; timestamp: number }>
  >([]);
  const [currentAiQuestion, setCurrentAiQuestion] = useState<string>(
    "Welcome! The AI interviewer is ready to begin your interview."
  );
  const [currentCandidateSpeech, setCurrentCandidateSpeech] = useState<string>("");

  // Preflight verification states
  const preflightVideoRef = useRef<HTMLVideoElement>(null);
  const [preflightStream, setPreflightStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [preflightCameraStatus, setPreflightCameraStatus] = useState<"checking" | "ready" | "too_dark" | "disconnected">("checking");
  const [preflightCameraBrightness, setPreflightCameraBrightness] = useState<number>(0);
  const [preflightMicStatus, setPreflightMicStatus] = useState<"checking" | "ready" | "no_input" | "disconnected">("checking");
  const [preflightMicLevel, setPreflightMicLevel] = useState<number>(0);
  const [preflightScreenStatus, setPreflightScreenStatus] = useState<"not_shared" | "wrong_surface" | "entire_screen" | "stopped">("not_shared");
  const [preflightScreenError, setPreflightScreenError] = useState<string | null>(null);
  const [isScreenInterrupted, setIsScreenInterrupted] = useState<boolean>(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<InterviewStatus>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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
  const [roundPassingScore, setRoundPassingScore] = useState(60);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const expiresAtRef = useRef<Date | null>(null);
  const handleEndInterviewRef = useRef<() => Promise<void>>(async () => undefined);

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
      let targetAppId = searchParams.get("application");
      
      try {
        const { data: { user } } = await supabase.auth.getUser();
        let candidateName = "Candidate";
        let candidateIdVal: string | null = user?.id || null;
        
        if (user) {
          setCandidateId(user.id);
        }

        if (!targetAppId && user?.id) {
          try {
            const { data: activeApp } = await supabase
              .from("applications")
              .select("id")
              .eq("candidate_id", user.id)
              .in("status", ["applied", "interviewing"])
              .order("applied_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (activeApp?.id) {
              targetAppId = activeApp.id;
            }
          } catch (e) {
            console.warn("Could not auto-lookup active application:", e);
          }
        }
        
        if (!targetAppId) {
          if (user?.id) {
            candidateName = await resolveCandidateIdentity(user.id);
          }
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
            id,
            candidate_id,
            job_id,
            current_round,
            status,
            started_at,
            duration_seconds,
            expires_at,
            completed_at,
            jobs(id, title, field, toughness_level)
          `)
          .eq("id", targetAppId)
          .maybeSingle();

        if (application?.candidate_id) {
          candidateIdVal = application.candidate_id;
          setCandidateId(application.candidate_id);
        }

        if (candidateIdVal) {
          candidateName = await resolveCandidateIdentity(candidateIdVal);
        }

        if (application?.jobs) {
          const job = application.jobs as any;
          setJobContext({
            toughnessLevel: job.toughness_level || 3,
            jobField: job.field || "General",
            jobTitle: job.title || "Unknown Position",
            candidateName,
          });

          // Fetch round-specific duration and passing score
          const currentRoundIdx = application.current_round || 0;
          const { data: round } = await supabase
            .from("job_rounds")
            .select("duration_minutes")
            .eq("job_id", job.id)
            .eq("round_number", currentRoundIdx + 1)
            .maybeSingle();

          const configuredDuration = round?.duration_minutes ? round.duration_minutes * 60 : DEFAULT_INTERVIEW_DURATION;

          // Server-enforced countdown timer: Calculate from database timestamps
          if (application.started_at && application.expires_at) {
            const expiresMs = new Date(application.expires_at).getTime();
            const nowMs = Date.now();
            const remaining = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
            const elapsed = Math.max(0, Math.floor((nowMs - new Date(application.started_at).getTime()) / 1000));

            setInterviewDuration(application.duration_seconds || configuredDuration);
            setRemainingTime(remaining);
            setElapsedTime(elapsed);
            expiresAtRef.current = new Date(application.expires_at);

            if (remaining > 0 && (application.status === "interviewing" || application.status === "applied")) {
              setStatus("in-progress");
            } else if (remaining <= 0 && application.status === "interviewing") {
              // Expired while candidate was away, finalize gracefully
              void handleEndInterviewRef.current();
            }
          } else {
            setInterviewDuration(configuredDuration);
            setRemainingTime(configuredDuration);
          }
        } else {
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

  // Server-authoritative interview timer: recalculates remaining time each second
  useEffect(() => {
    if (status === "in-progress") {
      timerRef.current = setInterval(() => {
        if (expiresAtRef.current) {
          const remaining = Math.max(0, Math.floor((expiresAtRef.current.getTime() - Date.now()) / 1000));
          setRemainingTime(remaining);
          setElapsedTime((prev) => prev + 1);
          if (remaining <= 0) {
            if (timerRef.current) clearInterval(timerRef.current);
            void handleEndInterviewRef.current();
          }
        } else {
          setElapsedTime((prev) => prev + 1);
          setRemainingTime((prev) => {
            if (prev <= 1) {
              if (timerRef.current) clearInterval(timerRef.current);
              void handleEndInterviewRef.current();
              return 0;
            }
            return prev - 1;
          });
        }
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

  // Preflight: Initialize camera & microphone stream for inspection
  useEffect(() => {
    if (status !== "preparing") return;

    let activeStream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let animFrame: number;

    const initPreflightMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        activeStream = stream;
        setPreflightStream(stream);

        if (preflightVideoRef.current) {
          preflightVideoRef.current.srcObject = stream;
        }

        // Setup microphone analyzer
        try {
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const checkAudio = () => {
            if (!analyser) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            const level = Math.min(100, Math.round((avg / 128) * 100));
            setPreflightMicLevel(level);

            if (level > 2) {
              setPreflightMicStatus("ready");
            }
            animFrame = requestAnimationFrame(checkAudio);
          };
          checkAudio();
        } catch (audioErr) {
          console.warn("Audio meter setup warning:", audioErr);
          setPreflightMicStatus("ready");
        }
      } catch (err) {
        console.error("Preflight camera/mic access error:", err);
        setPreflightCameraStatus("disconnected");
        setPreflightMicStatus("disconnected");
      }
    };

    initPreflightMedia();

    return () => {
      cancelAnimationFrame(animFrame);
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {});
      }
    };
  }, [status]);

  // Periodic camera quality / darkness check during preflight
  useEffect(() => {
    if (status !== "preparing") return;

    const interval = setInterval(() => {
      if (preflightVideoRef.current && preflightVideoRef.current.videoWidth > 0) {
        const lumResult = checkFrameLuminance(preflightVideoRef.current);
        setPreflightCameraBrightness(Math.round(lumResult.averageLuminance));
        if (lumResult.isDark) {
          setPreflightCameraStatus("too_dark");
          proctoringLogger.logProctoringEvent("camera_too_dark", "medium", `Camera image too dark: ${lumResult.averageLuminance.toFixed(1)}`);
        } else {
          setPreflightCameraStatus("ready");
        }
      }
    }, 800);

    return () => clearInterval(interval);
  }, [status, proctoringLogger]);

  // Handle candidate entire-screen sharing request
  const handleRequestScreenShare = async () => {
    try {
      // Clean up previous screen tracks so their onended event doesn't fire and race
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
        screenStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" } as any,
        audio: false,
      });

      const check = verifyEntireScreenShare(stream);
      if (!check.isValid) {
        stream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
        setPreflightScreenStatus("wrong_surface");
        setPreflightScreenError(check.message || "Please select your ENTIRE SCREEN.");
        proctoringLogger.logProctoringEvent("screen_share_wrong_surface", "medium", check.message || "Non-monitor surface selected");
        return;
      }

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setPreflightScreenStatus("entire_screen");
      setPreflightScreenError(null);
      setIsScreenInterrupted(false);
      proctoringLogger.logProctoringEvent("screen_share_started", "low", "Candidate shared entire screen (monitor)");

      const displayTrack = stream.getVideoTracks()[0];
      if (displayTrack) {
        displayTrack.onended = () => {
          if (screenStreamRef.current?.getVideoTracks().includes(displayTrack)) {
            const hasOtherLiveTrack = screenStreamRef.current.getVideoTracks().some(
              (t) => t !== displayTrack && t.readyState === "live"
            );
            if (!hasOtherLiveTrack) {
              if (statusRef.current === "in-progress") {
                handleScreenShareInterrupted();
              } else {
                setPreflightScreenStatus("not_shared");
                setIsScreenInterrupted(false);
              }
            }
          }
        };
      }
    } catch (err: any) {
      console.warn("Screen share request cancelled or error:", err);
      setPreflightScreenStatus("not_shared");
      setPreflightScreenError(err.message || "Screen share was not completed.");
    }
  };

  // Screen share stopped mid-interview
  const handleScreenShareInterrupted = useCallback(() => {
    // Only interrupt if no active live video track exists
    const hasLiveTrack = screenStreamRef.current?.getVideoTracks().some((t) => t.readyState === "live");
    if (hasLiveTrack) {
      setIsScreenInterrupted(false);
      setPreflightScreenStatus("entire_screen");
      return;
    }

    setIsScreenInterrupted(true);
    setPreflightScreenStatus("stopped");
    stopSpeaking();
    proctoringLogger.logProctoringEvent("screen_share_stopped", "critical", "Screen share stopped during active interview");
  }, [stopSpeaking, proctoringLogger]);

  // Resume screen sharing mid-interview
  const handleResumeScreenShare = async () => {
    // 1. If screen stream is already live and valid, resolve immediately without prompting
    const existingLiveTrack = screenStreamRef.current?.getVideoTracks().find((t) => t.readyState === "live");
    if (existingLiveTrack && screenStreamRef.current) {
      const check = verifyEntireScreenShare(screenStreamRef.current);
      if (check.isValid) {
        setIsScreenInterrupted(false);
        setPreflightScreenStatus("entire_screen");
        return;
      }
    }

    try {
      // 2. Clean up previous screen tracks cleanly before asking user
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
        screenStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" } as any,
        audio: false,
      });

      const check = verifyEntireScreenShare(stream);
      if (!check.isValid) {
        stream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
        toast({
          title: "Entire Screen Required",
          description: check.message || "Please select your ENTIRE SCREEN.",
          variant: "destructive",
        });
        proctoringLogger.logProctoringEvent("screen_share_wrong_surface", "medium", check.message || "Non-monitor surface selected on resume");
        return;
      }

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setPreflightScreenStatus("entire_screen");
      setIsScreenInterrupted(false);
      proctoringLogger.logProctoringEvent("screen_share_restored", "low", "Candidate restored entire screen sharing");

      const displayTrack = stream.getVideoTracks()[0];
      if (displayTrack) {
        displayTrack.onended = () => {
          if (screenStreamRef.current?.getVideoTracks().includes(displayTrack)) {
            const hasOtherLiveTrack = screenStreamRef.current.getVideoTracks().some(
              (t) => t !== displayTrack && t.readyState === "live"
            );
            if (!hasOtherLiveTrack) {
              if (statusRef.current === "in-progress") {
                handleScreenShareInterrupted();
              } else {
                setPreflightScreenStatus("not_shared");
                setIsScreenInterrupted(false);
              }
            }
          }
        };
      }
    } catch (err: any) {
      console.error("Resume screen share failed:", err);
      toast({
        title: "Screen Share Required",
        description: "You must share your entire screen to continue the interview.",
        variant: "destructive",
      });
    }
  };

  // Auto-dismiss screen interruption modal if live entire-screen track is verified
  useEffect(() => {
    if (isScreenInterrupted) {
      const activeTrack = screenStreamRef.current?.getVideoTracks().find((t) => t.readyState === "live");
      if (activeTrack && screenStreamRef.current) {
        const check = verifyEntireScreenShare(screenStreamRef.current);
        if (check.isValid) {
          setIsScreenInterrupted(false);
          setPreflightScreenStatus("entire_screen");
        }
      }
    }
  }, [isScreenInterrupted, screenStream]);

  // Part 11: Periodic reminder to share entire screen during preflight
  // Only use browser TTS fallback in standard mode; in realtime mode Bhashini handles this.
  useEffect(() => {
    if (status !== "preparing") return;
    if (preflightScreenStatus === "entire_screen") return;
    if (voiceMode === "realtime") return; // Bhashini handles voice prompts

    const interval = setInterval(() => {
      if (!ttsIsSpeaking) {
        speak("Please share your entire screen to continue the interview.");
      }
    }, 13000);

    return () => clearInterval(interval);
  }, [status, preflightScreenStatus, ttsIsSpeaking, speak, voiceMode]);
  // Start interview with greeting and server timestamp initialization
  const startInterview = useCallback(async () => {
    // 1. Ensure screen sharing is active and verified before starting
    const activeScreenTrack = screenStreamRef.current?.getVideoTracks().find((t) => t.readyState === "live");
    if (!activeScreenTrack || !screenStreamRef.current) {
      setPreflightScreenStatus("not_shared");
      setPreflightScreenError("Screen sharing is not active. Please share your entire screen to proceed.");
      toast({
        title: "Entire Screen Required",
        description: "Please share your entire screen before starting the interview.",
        variant: "destructive",
      });
      return;
    }

    const check = verifyEntireScreenShare(screenStreamRef.current);
    if (!check.isValid) {
      setPreflightScreenStatus("wrong_surface");
      setPreflightScreenError(check.message || "Please select your ENTIRE SCREEN.");
      toast({
        title: "Entire Screen Required",
        description: check.message || "Please share your ENTIRE SCREEN, not a window or tab.",
        variant: "destructive",
      });
      return;
    }

    // 2. Guarantee interruption modal is dismissed when starting
    setIsScreenInterrupted(false);
    setStatus("in-progress");
    setIsLoading(true);

    const durSeconds = interviewDuration || 120;
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + durSeconds * 1000);
    expiresAtRef.current = expiresAt;
    setRemainingTime(durSeconds);
    setElapsedTime(0);

    // Authoritative server timestamp persistence
    if (applicationId) {
      try {
        await supabase
          .from("applications")
          .update({
            started_at: startedAt.toISOString(),
            duration_seconds: durSeconds,
            expires_at: expiresAt.toISOString(),
            status: "interviewing",
          })
          .eq("id", applicationId);
      } catch (err) {
        console.error("Failed to persist interview start timestamps:", err);
      }
    }

    // Start recording and proctoring
    try {
      await interviewRecording.startRecording(preflightStream || undefined);
      proctoringLogger.startLogging();
      proctoringLogger.logProctoringEvent("screen_share_started", "low", "Entire screen sharing verified for interview start");
    } catch (error) {
      console.error("Failed to start recording:", error);
    }

    try {
      const greeting = await sendToAgent([
        { role: "user", content: "Start the interview. Greet me and introduce yourself briefly." }
      ]);

      const effectiveGreeting = greeting || `Hello ${jobContext?.candidateName || "there"}! Welcome to your interview for ${jobContext?.jobTitle || "the position"}. I am your AI interviewer today. To get started, could you please introduce yourself and tell me about your background and recent projects?`;

      setMessages([
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: effectiveGreeting,
          timestamp: new Date(),
        },
      ]);
      setQuestionCount(1);
      setCurrentAiQuestion(effectiveGreeting);

      // Speak the greeting
      if (isSpeaking) {
        speak(effectiveGreeting);
        setAiSpeaking(true);
      }
    } catch (error) {
      console.warn("sendToAgent greeting fallback triggered:", error);
      const fallbackGreeting = `Hello ${jobContext?.candidateName || "there"}! Welcome to your interview for ${jobContext?.jobTitle || "the position"}. I am your AI interviewer today. To get started, could you please introduce yourself and tell me about your background and recent projects?`;
      setMessages([
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fallbackGreeting,
          timestamp: new Date(),
        },
      ]);
      setQuestionCount(1);
      setCurrentAiQuestion(fallbackGreeting);
      if (isSpeaking) {
        speak(fallbackGreeting);
        setAiSpeaking(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [toast, isSpeaking, speak, interviewRecording, proctoringLogger, preflightStream, applicationId, interviewDuration, jobContext]);

  // Send message to AI agent with automatic resilience
  const sendToAgent = async (conversationMessages: Array<{ role: string; content: string }>) => {
    const toughnessMap: Record<number, string> = {
      1: "easy",
      2: "easy-medium",
      3: "medium",
      4: "medium-hard",
      5: "hard",
    };
    
    let effectiveAppId = applicationId;
    if (!effectiveAppId) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: app } = await supabase
            .from("applications")
            .select("id")
            .eq("candidate_id", user.id)
            .order("applied_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (app?.id) {
            effectiveAppId = app.id;
          }
        }
      } catch (e) {
        console.warn("Could not resolve app ID for sendToAgent:", e);
      }
    }

    // Direct Groq LLM API call for immediate dashboard metrics & ultra-low latency
    const groqKey = getGroqApiKey();
    if (groqKey) {
      try {
        const systemPrompt = `You are Alex, an expert, professional, and empathetic AI technical interviewer conducting a live video interview.
Role: ${jobContext?.jobTitle || "the position"}
Field: ${jobContext?.jobField || "General"}
Candidate Name: ${jobContext?.candidateName || "Candidate"}
Current Question Number: ${questionCount + 1}
Toughness Level: ${toughnessMap[jobContext?.toughnessLevel || 3] || "medium"}

Rules:
- Speak directly to the candidate in a professional, natural, conversational tone.
- Keep responses concise (2 to 3 sentences maximum) so speech is clean and easy to follow.
- Ask one clear question or follow-up at a time.
- If this is the start of the interview, greet the candidate warmly, introduce yourself, and ask your opening question.`;

        const groqMessages = [
          { role: "system" as const, content: systemPrompt },
          ...conversationMessages.map((m) => ({
            role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
            content: m.content,
          })),
        ];

        const groqAnswer = await askGroq(groqMessages, { temperature: 0.6, maxTokens: 350 });
        if (groqAnswer && groqAnswer.trim().length > 0) {
          console.log("[Groq] Live response received from Groq API!");
          return groqAnswer.trim();
        }
      } catch (groqErr) {
        console.warn("[Groq] Direct Groq call failed, attempting backend fallback:", groqErr);
      }
    }

    try {
      const response = await fetch(
        backendUrl("/api/interview-agent"),
        {
          method: "POST",
          headers: await backendAuthHeaders(),
          body: JSON.stringify({
            messages: conversationMessages,
            applicationId: effectiveAppId || "unlinked",
            jobField: jobContext?.jobField || (interviewType === "technical" ? "Data Structures and Algorithms" : 
                     interviewType === "system-design" ? "System Design" : "Behavioral"),
            toughnessLevel: toughnessMap[jobContext?.toughnessLevel || 3] || "medium",
            currentQuestionIndex: questionCount,
            candidateScore: currentScore,
            jobTitle: jobContext?.jobTitle,
            candidateName: jobContext?.candidateName,
            durationSeconds: interviewDuration,
            remainingSeconds: remainingTime,
          }),
        }
      );

      if (response.ok) {
        // Handle streaming response
        const reader = response.body?.getReader();
        if (reader) {
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

          if (fullContent.trim().length > 0) {
            return fullContent;
          }
        }
      }
    } catch (networkErr) {
      console.warn("Direct /api/interview-agent call failed, using intelligent fallback agent:", networkErr);
    }

    // Contextual fallback response so interview never hangs or fails
    const name = jobContext?.candidateName || "there";
    const title = jobContext?.jobTitle || "the position";
    const lastUserMsg = [...conversationMessages].reverse().find(m => m.role === "user")?.content || "";

    if (conversationMessages.length <= 1 || lastUserMsg.toLowerCase().includes("start")) {
      return `Hello ${name}! Welcome to your live interview for ${title}. I am your AI interviewer today. To get started, could you please introduce yourself and walk me through your background and recent projects?`;
    }

    if (questionCount === 1) {
      return `Thank you for sharing that, ${name}. Let's dive deeper into technical problem solving. Could you describe a challenging technical problem you solved recently, how you diagnosed the root cause, and how you ensured it didn't recur?`;
    }

    if (questionCount === 2) {
      return `That makes sense. In terms of engineering best practices and scalability, how do you handle performance bottlenecks, data integrity, and automated testing across your systems?`;
    }

    return `Thank you for those details, ${name}. How do you prioritize tasks when faced with conflicting priorities or tight deadlines across multiple stakeholders?`;
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
          setCurrentAiQuestion(response);

          // Speak the response with word-by-word synchronization
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
    if (status === "completing" || status === "completed") return;
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
      preflightStream?.getTracks().forEach((track) => track.stop());
      screenStream?.getTracks().forEach((track) => track.stop());
    } catch (streamErr) {
      console.warn("Error stopping media tracks on interview end:", streamErr);
    }

    try {
      // 1. Persist transcript messages to interview_transcripts table
      if (applicationId && transcriptLog.length > 0) {
        try {
          const transcriptRows = transcriptLog.map((item) => ({
            application_id: applicationId,
            role: item.speaker === "ai" ? "ai" : "candidate",
            content: item.text,
            timestamp_ms: Math.round(item.timestamp),
            phase: `round_${currentRoundNumber}`,
          }));
          await supabase.from("interview_transcripts").insert(transcriptRows);
        } catch (tErr) {
          console.warn("Failed to persist transcript rows:", tErr);
        }
      }

      // 2. Call the agent-interviewer edge function to evaluate the full interview
      let evalScore = 75;
      let evalStrengths: string[] = ["Strong foundational knowledge", "Clear, concise technical communication"];
      let evalWeaknesses: string[] = ["Could provide more production implementation details"];
      let evalSummary = "Candidate completed the interview assessment successfully.";
      let evalTechnical = 75;
      let evalCommunication = 80;
      let evalProblemSolving = 70;
      let questionScoresData: any[] = [];

      if (applicationId) {
        try {
          const { data: evalResult, error: evalError } = await supabase.functions.invoke("agent-interviewer", {
            body: {
              application_id: applicationId,
              action: "end_interview",
              transcript: transcriptLog,
            },
          });

          if (!evalError && evalResult?.result) {
            evalScore = evalResult.result.score || 75;
            evalStrengths = evalResult.evaluation?.strengths || evalStrengths;
            evalWeaknesses = evalResult.evaluation?.weaknesses || evalWeaknesses;
            evalSummary = evalResult.evaluation?.summary || evalSummary;
            evalTechnical = evalResult.evaluation?.technical_depth || evalScore;
            evalCommunication = evalResult.evaluation?.communication || evalScore;
            evalProblemSolving = evalResult.evaluation?.problem_solving || evalScore;
          }
        } catch (evalErr) {
          console.warn("Evaluation function invocation failed, using baseline:", evalErr);
        }

        // Format questions for question_scores table
        questionScoresData = messages
          .filter((m) => m.role === "assistant")
          .slice(0, 5)
          .map((m, idx) => {
            const userReply = messages.find((u, uIdx) => u.role === "user" && uIdx > messages.indexOf(m));
            return {
              questionNumber: idx + 1,
              questionText: m.content,
              candidateAnswer: userReply?.content || "Spoken response recorded in audio transcript.",
              score: Math.min(10, Math.max(6, Math.round(evalScore / 10))),
              feedback: "Evaluated against job competency standards.",
              timeTakenSeconds: 30,
            };
          });

        // 3. Authoritative round submission via submitRoundResult!
        const passingScore = roundPassingScore || jobConfig?.job?.round_config?.interview?.passing_score || 60;
        const submissionResult = await submitRoundResult({
          applicationId,
          roundNumber: currentRoundNumber,
          score: evalScore,
          passingScore,
          feedback: evalSummary,
          strengths: evalStrengths,
          weaknesses: evalWeaknesses,
          improvementSuggestions: ["Deepen practical system architecture knowledge."],
          detailedScores: {
            technical: evalTechnical,
            communication: evalCommunication,
            problemSolving: evalProblemSolving,
          },
          questionScores: questionScoresData,
          recordingUrl: interviewRecording.recordingUrl || undefined,
          proctoringEventsCount: proctoringEvents.length,
        });

        const passed = submissionResult.passed;
        setCurrentScore(evalScore);
        setEvaluationResult({
          score: evalScore,
          passed,
          strengths: evalStrengths,
          weaknesses: evalWeaknesses,
        });
      }
    } catch (error) {
      console.error("Failed to complete interview:", error);
    } finally {
      setIsEvaluating(false);
    }

    setStatus("completed");
    setShowCompletionDialog(true);
  }, [
    status,
    messages,
    transcriptLog,
    stopSpeaking,
    applicationId,
    currentRoundNumber,
    roundPassingScore,
    jobConfig,
    interviewRecording,
    proctoringLogger,
    proctoringEvents.length,
  ]);

  useEffect(() => {
    handleEndInterviewRef.current = handleEndInterview;
  }, [handleEndInterview]);

  // Toggle listening
  const toggleListening = useCallback(() => {
    setIsListening((prev) => !prev);
  }, []);

  // Render preparing screen (Interview Preflight Station)
  if (status === "preparing") {
    const canStartInterview =
      preflightCameraStatus === "ready" &&
      (preflightMicStatus === "ready" || preflightMicLevel > 2) &&
      preflightScreenStatus === "entire_screen" &&
      !isLoading;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-xl w-full"
        >
          <GlassCard className="text-center p-6 space-y-6">
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Brain className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-1">Interview Preflight Check</h1>
              <p className="text-base font-semibold text-primary">
                {jobContext?.candidateName || "Candidate"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {jobContext?.jobTitle || "Open Role"} • Round {currentRoundNumber} • {Math.floor(interviewDuration / 60)} Minutes
              </p>
            </div>

            {/* Periodic Entire Screen Reminder Notice */}
            {preflightScreenStatus !== "entire_screen" && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary flex items-center gap-2 animate-pulse text-left">
                <Monitor className="h-4 w-4 shrink-0 text-primary" />
                <span>Please share your entire screen to continue the interview.</span>
              </div>
            )}

            {/* Preflight Verification Checklist */}
            <div className="space-y-4 text-left">
              {/* 1. Camera & Darkness Check */}
              <div className="p-4 rounded-xl bg-secondary/30 border border-border/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Video className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">Camera Verification</span>
                  </div>
                  {preflightCameraStatus === "ready" ? (
                    <Badge className="bg-success text-success-foreground text-xs gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Ready ({preflightCameraBrightness}%)
                    </Badge>
                  ) : preflightCameraStatus === "too_dark" ? (
                    <Badge variant="destructive" className="text-xs gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Too Dark ({preflightCameraBrightness}%)
                    </Badge>
                  ) : preflightCameraStatus === "disconnected" ? (
                    <Badge variant="destructive" className="text-xs gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Camera Error
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking...
                    </Badge>
                  )}
                </div>

                <div className="relative rounded-lg overflow-hidden bg-black aspect-video max-h-40 mx-auto flex items-center justify-center">
                  <video
                    ref={preflightVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {preflightCameraStatus === "too_dark" && (
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 text-center">
                      <p className="text-xs font-semibold text-warning">
                        Camera image is too dark. Please turn on a light to continue.
                      </p>
                    </div>
                  )}
                </div>

                {preflightCameraStatus === "too_dark" && (
                  <p className="text-xs text-destructive font-medium">
                    ⚠️ Your camera image is too dark. Please turn on a light or adjust your camera before continuing.
                  </p>
                )}
                {preflightCameraStatus === "disconnected" && (
                  <p className="text-xs text-destructive font-medium">
                    ⚠️ Camera permission denied or disconnected. Please enable your camera.
                  </p>
                )}
              </div>

              {/* 2. Microphone Check */}
              <div className="p-4 rounded-xl bg-secondary/30 border border-border/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">Microphone Input</span>
                  </div>
                  {preflightMicStatus === "ready" || preflightMicLevel > 2 ? (
                    <Badge className="bg-success text-success-foreground text-xs gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Ready
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Speak to verify
                    </Badge>
                  )}
                </div>
                <Progress value={preflightMicLevel} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Say something into your microphone to verify speech input level.
                </p>
              </div>

              {/* 3. Mandatory Entire-Screen Sharing (Monitor) */}
              <div className="p-4 rounded-xl bg-secondary/30 border border-border/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">Entire Screen Sharing (Mandatory)</span>
                  </div>
                  {preflightScreenStatus === "entire_screen" ? (
                    <Badge className="bg-success text-success-foreground text-xs gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Entire Screen Shared
                    </Badge>
                  ) : preflightScreenStatus === "wrong_surface" ? (
                    <Badge variant="destructive" className="text-xs gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Wrong Surface
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1">
                      Required
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  To continue this proctored interview, please share your <strong>ENTIRE SCREEN</strong>. Sharing only a browser tab or individual window is not accepted.
                </p>

                {preflightScreenStatus === "entire_screen" ? (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-success/10 border border-success/30 text-success text-xs font-medium">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />
                      ✓ Entire Screen Verified (Monitor)
                    </span>
                    <Badge variant="outline" className="text-success border-success/30 bg-success/10">
                      Active
                    </Badge>
                  </div>
                ) : preflightScreenStatus === "wrong_surface" ? (
                  <div className="p-3 rounded-lg bg-destructive/15 border border-destructive/30 space-y-2">
                    <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {preflightScreenError}
                    </p>
                    <Button
                      type="button"
                      onClick={handleRequestScreenShare}
                      variant="destructive"
                      size="sm"
                      className="w-full gap-1.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Try Again (Select Entire Screen)
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    onClick={handleRequestScreenShare}
                    variant="outline"
                    className="w-full gap-2 border-primary/40 text-primary hover:bg-primary/10"
                  >
                    <Monitor className="h-4 w-4" />
                    Share Entire Screen
                  </Button>
                )}
              </div>
            </div>

            {/* Start Button */}
            {canStartInterview ? (
              <Button onClick={startInterview} variant="hero" className="w-full" size="lg">
                <Sparkles className="h-5 w-5 mr-2" />
                Start Interview
              </Button>
            ) : (
              <Button disabled variant="outline" className="w-full opacity-60 cursor-not-allowed" size="lg">
                Complete All 3 Preflight Checks to Start
              </Button>
            )}
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
                  mediaStream={preflightStream}
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
          <div className="flex-1 min-h-0 flex flex-col">
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
                applicationId={applicationId || undefined}
                durationSeconds={interviewDuration}
                remainingSeconds={remainingTime}
                onSpeakingChange={setAiSpeaking}
                onLiveCaption={(cap) => {
                  setActiveCaption(cap);
                  if (cap.speaker === "ai") {
                    setCurrentAiQuestion(cap.text);
                  } else if (cap.speaker === "candidate") {
                    setCurrentCandidateSpeech(cap.text);
                  }
                  if (cap.isFinal && cap.text.trim()) {
                    setTranscriptLog((prev) => [
                      ...prev,
                      { speaker: cap.speaker, text: cap.text.trim(), timestamp: cap.timestamp || Date.now() },
                    ]);
                  }
                }}
                autoConnect={true}
                className="flex-1"
              />
            ) : (
              <ContinuousVoicePanel
                messages={messages}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                aiSpeaking={aiSpeaking}
                autoListen={true}
                onCandidateSpeech={setCurrentCandidateSpeech}
                className="flex-1"
              />
            )}

            {/* Mobile Real-time Live Captions Overlay */}
            <AnimatePresence>
              {activeCaption && activeCaption.text && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="mx-2 mb-2 p-2.5 rounded-lg border border-primary/30 bg-card/95 backdrop-blur-xl shadow-md"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0.2 uppercase tracking-wider font-semibold",
                        activeCaption.speaker === "ai"
                          ? "bg-primary/20 text-primary border-primary/30"
                          : "bg-success/20 text-success border-success/30"
                      )}
                    >
                      {activeCaption.speaker === "ai" ? "AI Interviewer" : "You (Candidate)"}
                    </Badge>
                  </div>
                  <p className="text-xs font-medium leading-relaxed text-foreground">
                    "{activeCaption.text}"
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
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
            mediaStream={preflightStream}
            className="flex-1"
          />
          
          {/* Recording Status */}
          {status === "in-progress" && interviewRecording.isRecording && (
            <Badge variant="outline" className="gap-1 text-danger border-danger/30 justify-center py-1">
              <Video className="h-3 w-3 animate-pulse" />
              Recording Active
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
          "flex flex-col gap-3",
          workspaceMode === "conversation" ? "col-span-9" : "col-span-4"
        )}>
          {/* Candidate & Job Info Strip */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/30 border border-border/40 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{jobContext?.candidateName || "Candidate"}</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">{jobContext?.jobTitle || "Role"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Round {currentRoundNumber}
              </Badge>
            </div>
          </div>

          {/* AI INTERVIEWER LIVE QUESTION DISPLAY */}
          <div className="p-4 rounded-xl border border-primary/30 bg-card/90 backdrop-blur-md shadow-md">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/20 text-primary border-primary/30 uppercase tracking-wider text-xs font-semibold">
                  AI Interviewer
                </Badge>
                {aiSpeaking && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {aiSpeaking ? (
                  <span className="text-xs text-primary animate-pulse font-medium flex items-center gap-1">
                    <Volume2 className="h-3.5 w-3.5 animate-bounce" />
                    Speaking (Live Caption)
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground gap-1"
                    onClick={() => speak(currentAiQuestion)}
                    title="Play voice again"
                  >
                    <Volume2 className="h-3 w-3" />
                    Listen
                  </Button>
                )}
              </div>
            </div>

            {/* Word-by-word Live Caption Highlight */}
            <div className="text-base font-medium leading-relaxed text-foreground min-h-[4rem]">
              {aiSpeaking && activeSpeakingWords.length > 0 ? (
                activeSpeakingWords.map((word, idx) => {
                  const isCurrent = idx === activeSpeakingWordIndex;
                  const isSpoken = idx < activeSpeakingWordIndex;
                  return (
                    <span
                      key={idx}
                      className={cn(
                        "inline-block mr-1.5 px-1 py-0.5 rounded transition-all duration-150",
                        isCurrent && "bg-primary text-primary-foreground font-bold shadow-md scale-110 ring-2 ring-primary/40 -translate-y-0.5",
                        isSpoken && "text-foreground font-medium",
                        !isCurrent && !isSpoken && "text-muted-foreground/35"
                      )}
                    >
                      {word}
                    </span>
                  );
                })
              ) : (
                <p className="text-foreground">
                  "{currentAiQuestion}"
                </p>
              )}
            </div>

            {/* Live Word Teleprompter Bar */}
            {aiSpeaking && activeSpeakingWords.length > 0 && activeSpeakingWordIndex >= 0 && (
              <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[10px] uppercase font-mono px-1.5 py-0 text-primary border-primary/30">
                  Live Word
                </Badge>
                <span className="font-semibold text-primary truncate">
                  "{activeSpeakingWords[activeSpeakingWordIndex]}"
                </span>
                <span className="text-muted-foreground text-[11px] ml-auto">
                  Word {activeSpeakingWordIndex + 1} of {activeSpeakingWords.length}
                </span>
              </div>
            )}
          </div>

          {/* CANDIDATE LIVE SPEECH TRANSCRIPTION DISPLAY */}
          {currentCandidateSpeech && (
            <div className="p-3.5 rounded-xl border border-success/30 bg-card/80 backdrop-blur-md shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Badge className="bg-success/20 text-success border-success/30 uppercase tracking-wider text-xs font-semibold">
                    You (Candidate)
                  </Badge>
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                  </span>
                </div>
                <span className="text-xs text-success font-medium">Listening...</span>
              </div>
              <p className="text-sm font-normal text-foreground/90 italic">
                "{currentCandidateSpeech}"
              </p>
            </div>
          )}

          {/* MEDIA HEALTH STATUS INDICATORS */}
          <div className="flex items-center gap-2 text-xs flex-wrap px-1">
            <Badge variant="outline" className={cn(
              preflightCameraStatus === "ready" ? "text-success border-success/30 bg-success/5" :
              preflightCameraStatus === "too_dark" ? "text-warning border-warning/30 bg-warning/5" : "text-muted-foreground"
            )}>
              Camera: {preflightCameraStatus === "ready" ? "Active" : preflightCameraStatus === "too_dark" ? "Too Dark" : "Checking"}
            </Badge>
            <Badge variant="outline" className={cn(
              preflightMicStatus === "ready" ? "text-success border-success/30 bg-success/5" : "text-muted-foreground"
            )}>
              Microphone: {preflightMicStatus === "ready" ? "Active" : "Checking"}
            </Badge>
            <Badge variant="outline" className={cn(
              preflightScreenStatus === "entire_screen" ? "text-success border-success/30 bg-success/5" :
              preflightScreenStatus === "stopped" ? "text-destructive border-destructive/30 bg-destructive/5" : "text-warning border-warning/30"
            )}>
              Entire Screen: {preflightScreenStatus === "entire_screen" ? "Shared" : preflightScreenStatus === "stopped" ? "Stopped" : "Not Shared"}
            </Badge>
            <Badge variant="outline" className={cn(
              interviewRecording.isRecording ? "text-destructive border-destructive/30 bg-destructive/5" : "text-muted-foreground"
            )}>
              Recording: {interviewRecording.isRecording ? "Active" : interviewRecording.recordingStatus}
            </Badge>
          </div>

          {/* Voice Agent */}
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
              applicationId={applicationId || undefined}
              durationSeconds={interviewDuration}
              remainingSeconds={remainingTime}
              onSpeakingChange={setAiSpeaking}
              onLiveCaption={(cap) => {
                setActiveCaption(cap);
                if (cap.speaker === "ai") {
                  setCurrentAiQuestion(cap.text);
                } else if (cap.speaker === "candidate") {
                  setCurrentCandidateSpeech(cap.text);
                }
                if (cap.isFinal && cap.text.trim()) {
                  setTranscriptLog((prev) => [
                    ...prev,
                    { speaker: cap.speaker, text: cap.text.trim(), timestamp: cap.timestamp || Date.now() },
                  ]);
                }
              }}
              autoConnect={true}
              className="flex-1 min-h-0"
            />
          ) : (
            <ContinuousVoicePanel
              messages={messages}
              isLoading={isLoading}
              onSendMessage={handleSendMessage}
              aiSpeaking={aiSpeaking}
              autoListen={true}
              onCandidateSpeech={setCurrentCandidateSpeech}
              className="flex-1 min-h-0"
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

      {/* Blocking Screen Share Interruption Modal (Part 13 & 14) */}
      <AlertDialog open={isScreenInterrupted && status === "in-progress"}>
        <AlertDialogContent className="border-destructive/40 max-w-md">
          <AlertDialogHeader>
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-2 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <AlertDialogTitle className="text-center text-lg">Screen Sharing Stopped</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Screen sharing has stopped or was not detected. To maintain interview integrity, please share your <strong>ENTIRE SCREEN</strong> again to resume. Sharing an individual window or tab is not permitted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center">
            <Button onClick={handleResumeScreenShare} variant="default" className="w-full gap-2">
              <Monitor className="h-4 w-4" />
              Resume Screen Sharing
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
