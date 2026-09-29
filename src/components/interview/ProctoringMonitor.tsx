import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Users,
  Volume2,
  MonitorOff,
  CheckCircle,
  Shield,
  Camera,
  CameraOff,
  Video,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProctoringLogger, type ProctoringEvent } from "@/hooks/useProctoringLogger";

interface ProctoringMonitorProps {
  isActive: boolean;
  onEvent: (event: ProctoringEvent) => void;
  onTrustScoreChange?: (score: number) => void;
  onFaceDetectedChange?: (detected: boolean) => void;
  applicationId?: string | null;
  candidateId?: string | null;
  recordingId?: string | null;
  enableCameraMonitoring?: boolean;
  mediaStream?: MediaStream | null;
  className?: string;
}

export function ProctoringMonitor({
  isActive,
  onEvent,
  onTrustScoreChange,
  onFaceDetectedChange,
  applicationId = null,
  candidateId = null,
  recordingId = null,
  enableCameraMonitoring = true,
  mediaStream = null,
  className,
}: ProctoringMonitorProps) {
  const [trustScore, setTrustScore] = useState(100);
  const [events, setEvents] = useState<ProctoringEvent[]>([]);
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  const [cameraStatus, setCameraStatus] = useState<"active" | "blocked" | "checking">("checking");
  const [faceDetected, setFaceDetected] = useState(true);
  const { toast } = useToast();

  const tabSwitchCount = useRef(0);
  const lastTabSwitch = useRef<Date | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const faceDetectedRef = useRef(true);
  useEffect(() => {
    faceDetectedRef.current = faceDetected;
  }, [faceDetected]);

  // Use proctoring logger for database persistence
  const proctoringLogger = useProctoringLogger({
    applicationId,
    recordingId,
    candidateId,
  });

  // Start logging when active
  useEffect(() => {
    if (isActive && applicationId && candidateId) {
      proctoringLogger.startLogging();
    }
    return () => {
      if (isActive) {
        proctoringLogger.stopLogging();
      }
    };
  }, [isActive, applicationId, candidateId]);

  const callbacksRef = useRef({ onEvent, onTrustScoreChange, onFaceDetectedChange, proctoringLogger, applicationId, candidateId });
  callbacksRef.current = { onEvent, onTrustScoreChange, onFaceDetectedChange, proctoringLogger, applicationId, candidateId };
  const warningTimer = useRef<ReturnType<typeof setTimeout>>();

  // Helper to log event both locally and to database
  const logProctoringEvent = useCallback((event: ProctoringEvent) => {
    setEvents((prev) => [...prev, event]);
    callbacksRef.current.onEvent(event);
    
    // Log to database if configured
    if (callbacksRef.current.applicationId && callbacksRef.current.candidateId) {
      callbacksRef.current.proctoringLogger.logEvent(event);
    }
  }, []);

  // Camera monitoring setup
  useEffect(() => {
    if (!isActive || !enableCameraMonitoring) return;

    let cancelled = false;
    let consecutiveDark = 0;
    let lastPenaltyTimestamp = 0;

    const setupCameraMonitoring = async () => {
      try {
        const stream = mediaStream;
        if (!stream) return;

        const video = videoRef.current;
        if (video) {
          if (video.srcObject !== stream) {
            video.srcObject = stream;
          }
          try {
            await video.play();
          } catch (_) {}
        }

        const isStreamLive = stream.getVideoTracks().some(t => t.readyState === "live" && t.enabled && !t.muted);
        setCameraStatus(isStreamLive ? "active" : "blocked");

        // Brightness-based obstruction & candidate face presence verification
        faceCheckIntervalRef.current = setInterval(() => {
          const liveTrack = stream.getVideoTracks().some(t => t.readyState === "live" && t.enabled && !t.muted);
          setCameraStatus(liveTrack ? "active" : "blocked");
          if (!liveTrack) return;

          const currentVideo = videoRef.current;
          if (currentVideo && (currentVideo.readyState >= 2 || currentVideo.videoWidth > 0)) {
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 48;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              try {
                ctx.drawImage(currentVideo, 0, 0, 64, 48);
                const imageData = ctx.getImageData(0, 0, 64, 48);
                const data = imageData.data;
                
                // Calculate average brightness
                let totalBrightness = 0;
                for (let i = 0; i < data.length; i += 4) {
                  totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
                }
                const avgBrightness = totalBrightness / (data.length / 4);
                
                // If brightness is genuinely pitch black (< 10) for 4 consecutive checks (6+ seconds)
                if (avgBrightness < 10) {
                  consecutiveDark++;
                  if (consecutiveDark >= 4) {
                    if (faceDetectedRef.current) {
                      setFaceDetected(false);
                      callbacksRef.current.onFaceDetectedChange?.(false);
                      if (import.meta.env.DEV) console.debug("[Proctoring] Candidate not detected: feed pitch black", avgBrightness);
                    }

                    const now = Date.now();
                    if (now - lastPenaltyTimestamp > 45000) {
                      lastPenaltyTimestamp = now;
                      const event: ProctoringEvent = {
                        type: "camera_blocked",
                        timestamp: new Date(),
                        severity: "medium",
                        description: "Camera feed obstructed or pitch black",
                      };
                      logProctoringEvent(event);

                      setTrustScore((prev) => {
                        const newScore = Math.max(0, prev - 5);
                        callbacksRef.current.onTrustScoreChange?.(newScore);
                        return newScore;
                      });

                      setWarningMessage("Camera covered! Please keep camera unobstructed.");
                      setShowWarning(true);
                      toast({
                        title: "Camera Obstruction Warning",
                        description: "Please keep your camera uncovered and well-lit.",
                        variant: "destructive",
                      });
                      clearTimeout(warningTimer.current);
                      warningTimer.current = setTimeout(() => setShowWarning(false), 5000);
                    }
                  }
                } else if (avgBrightness >= 15) {
                  consecutiveDark = 0;
                  if (!faceDetectedRef.current) {
                    setFaceDetected(true);
                    callbacksRef.current.onFaceDetectedChange?.(true);
                    if (import.meta.env.DEV) console.debug("[Proctoring] Candidate detected: feed bright and clear", avgBrightness);
                  }
                }
              } catch (_) {}
            }
          }
        }, 1500); // Check every 1.5 seconds

      } catch (error) {
        console.error("Camera access failed in proctoring:", error);
        setCameraStatus("blocked");
        
        logProctoringEvent({
          type: "camera_blocked",
          timestamp: new Date(),
          severity: "high",
          description: "Camera access denied or unavailable",
        });
      }
    };

    setupCameraMonitoring();

    return () => {
      cancelled = true; clearTimeout(warningTimer.current);
      if (faceCheckIntervalRef.current) {
        clearInterval(faceCheckIntervalRef.current);
        faceCheckIntervalRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
      if (isSelfAllocated && localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isActive, enableCameraMonitoring, mediaStream, logProctoringEvent]);

  // Monitor tab visibility
  useEffect(() => {
    if (!isActive) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        tabSwitchCount.current += 1;
        const now = new Date();
        lastTabSwitch.current = now;

        const event: ProctoringEvent = {
          type: "tab_switch",
          timestamp: now,
          severity: tabSwitchCount.current > 3 ? "high" : tabSwitchCount.current > 1 ? "medium" : "low",
          description: `Tab switched away (${tabSwitchCount.current} times total)`,
        };

        logProctoringEvent(event);

        // Reduce trust score
        const penalty = tabSwitchCount.current > 3 ? 10 : 5;
        setTrustScore((prev) => {
          const newScore = Math.max(0, prev - penalty);
          callbacksRef.current.onTrustScoreChange?.(newScore);
          return newScore;
        });

        // Show warning
        setWarningMessage("Tab switch detected. Please stay focused on the interview.");
        setShowWarning(true);
        setTimeout(() => setShowWarning(false), 3000);

        toast({
          title: "⚠️ Tab Switch Detected",
          description: "Please do not switch tabs during the interview.",
          variant: "destructive",
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isActive, logProctoringEvent, onTrustScoreChange, toast]);

  // Monitor copy/paste
  useEffect(() => {
    if (!isActive) return;

    const handleCopy = () => {
      const event: ProctoringEvent = {
        type: "copy_paste",
        timestamp: new Date(),
        severity: "medium",
        description: "Copy action detected",
      };
      logProctoringEvent(event);
    };

    const handlePaste = () => {
      const event: ProctoringEvent = {
        type: "copy_paste",
        timestamp: new Date(),
        severity: "high",
        description: "Paste action detected in code editor",
      };
      logProctoringEvent(event);

      setTrustScore((prev) => {
        const newScore = Math.max(0, prev - 8);
        callbacksRef.current.onTrustScoreChange?.(newScore);
        return newScore;
      });
    };

    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);

    return () => {
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
    };
  }, [isActive, logProctoringEvent, onTrustScoreChange]);

  // Monitor keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        toast({
          title: "Screenshot Blocked",
          description: "Screenshots are not allowed during the interview.",
          variant: "destructive",
        });
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) {
        e.preventDefault();
        const event: ProctoringEvent = {
          type: "tab_switch",
          timestamp: new Date(),
          severity: "high",
          description: "Developer tools shortcut detected",
        };
        logProctoringEvent(event);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActive, logProctoringEvent, toast]);

  const getTrustScoreColor = () => {
    if (trustScore >= 80) return "text-success";
    if (trustScore >= 50) return "text-warning";
    return "text-danger";
  };

  const getTrustScoreBg = () => {
    if (trustScore >= 80) return "bg-success";
    if (trustScore >= 50) return "bg-warning";
    return "bg-danger";
  };

  return (
    <div className={cn("relative", className)}>
      {/* Trust Score Badge */}
      <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
        <Shield className={cn("h-4 w-4", getTrustScoreColor())} />
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Trust Score</span>
            <span className={cn("font-medium", getTrustScoreColor())}>{trustScore}%</span>
          </div>
          <Progress value={trustScore} className={cn("h-1.5", getTrustScoreBg())} />
        </div>
      </div>

      {/* Camera & Candidate Status */}
      {enableCameraMonitoring && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs gap-1",
              cameraStatus === "active" 
                ? "text-success border-success/30 bg-success/5" 
                : "text-destructive border-destructive/30 bg-destructive/5"
            )}
          >
            {cameraStatus === "active" ? (
              <>
                <Camera className="h-3 w-3" />
                Camera Active
              </>
            ) : (
              <>
                <CameraOff className="h-3 w-3" />
                Camera Inactive
              </>
            )}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-xs gap-1",
              faceDetected
                ? "text-success border-success/30 bg-success/5"
                : "text-amber-500 border-amber-500/30 bg-amber-500/5"
            )}
          >
            {faceDetected ? (
              <>
                <Eye className="h-3 w-3" />
                Candidate Detected
              </>
            ) : (
              <>
                <EyeOff className="h-3 w-3" />
                Candidate Not Detected
              </>
            )}
          </Badge>
        </div>
      )}

      {/* Event indicators */}
      {events.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tabSwitchCount.current > 0 && (
            <Badge variant="outline" className="text-xs gap-1 text-warning border-warning/30">
              <MonitorOff className="h-3 w-3" />
              {tabSwitchCount.current} tab switch{tabSwitchCount.current > 1 ? "es" : ""}
            </Badge>
          )}
          {events.filter((e) => e.type === "copy_paste").length > 0 && (
            <Badge variant="outline" className="text-xs gap-1 text-warning border-warning/30">
              <AlertTriangle className="h-3 w-3" />
              Paste detected
            </Badge>
          )}
        </div>
      )}

      {/* Warning overlay */}
      <AnimatePresence>
        {showWarning && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 mt-2 p-3 rounded-lg bg-danger/90 text-danger-foreground text-sm z-50"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {warningMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Hidden attached video element for browser frame decoding */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden pointer-events-none" />
    </div>
  );
}

// Hook for proctoring in interview context
export function useProctoring(isActive: boolean) {
  const [events, setEvents] = useState<ProctoringEvent[]>([]);
  const [trustScore, setTrustScore] = useState(100);

  const recordEvent = useCallback((event: ProctoringEvent) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  const updateTrustScore = useCallback((score: number) => {
    setTrustScore(score);
  }, []);

  return {
    events,
    trustScore,
    recordEvent,
    updateTrustScore,
  };
}

export type { ProctoringEvent };
