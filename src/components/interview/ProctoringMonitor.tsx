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

  // Helper to log event both locally and to database
  const logProctoringEvent = useCallback((event: ProctoringEvent) => {
    setEvents((prev) => [...prev, event]);
    onEvent(event);
    
    // Log to database if configured
    if (applicationId && candidateId) {
      proctoringLogger.logEvent(event);
    }
  }, [onEvent, applicationId, candidateId, proctoringLogger]);

  // Camera monitoring setup
  useEffect(() => {
    if (!isActive || !enableCameraMonitoring) return;

    const setupCameraMonitoring = async () => {
      try {
        let stream = mediaStream;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user" },
            audio: false,
          });
        }

        // Create hidden video element for monitoring
        const video = document.createElement("video");
        video.srcObject = stream;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        try {
          await video.play();
        } catch (_) {}
        videoRef.current = video;

        setCameraStatus("active");

        // Log camera active
        logProctoringEvent({
          type: "face_detected",
          timestamp: new Date(),
          severity: "low",
          description: "Camera active, monitoring started",
        });

        // Brightness-based camera obstruction & covered detection
        faceCheckIntervalRef.current = setInterval(() => {
          if (videoRef.current && (videoRef.current.readyState >= 2 || videoRef.current.videoWidth > 0)) {
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 48;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              try {
                ctx.drawImage(videoRef.current, 0, 0, 64, 48);
                const imageData = ctx.getImageData(0, 0, 64, 48);
                const data = imageData.data;
                
                // Calculate average brightness
                let totalBrightness = 0;
                for (let i = 0; i < data.length; i += 4) {
                  totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
                }
                const avgBrightness = totalBrightness / (data.length / 4);
                
                // Average brightness below 20 indicates camera is covered, blocked, or pitch black
                if (avgBrightness < 20) {
                  if (faceDetected) {
                    setFaceDetected(false);
                    setCameraStatus("blocked");
                    
                    const event: ProctoringEvent = {
                      type: "camera_blocked",
                      timestamp: new Date(),
                      severity: "high",
                      description: "Camera blocked or covered by hand/obstruction",
                    };
                    logProctoringEvent(event);

                    setTrustScore((prev) => {
                      const newScore = Math.max(0, prev - 15);
                      onTrustScoreChange?.(newScore);
                      return newScore;
                    });

                    setWarningMessage("Camera covered! Please keep camera unobstructed.");
                    setShowWarning(true);
                    toast({
                      title: "Camera Blocked Detected",
                      description: "Your camera is covered. Please uncover your camera to avoid trust score deductions.",
                      variant: "destructive",
                    });
                    setTimeout(() => setShowWarning(false), 5000);
                  }
                } else if (!faceDetected && avgBrightness >= 25) {
                  setFaceDetected(true);
                  setCameraStatus("active");
                  
                  logProctoringEvent({
                    type: "face_detected",
                    timestamp: new Date(),
                    severity: "low",
                    description: "Camera feed unobstructed and active",
                  });
                }
              } catch (_) {}
            }
          }
        }, 1500); // Check every 1.5 seconds

      } catch (error) {
        console.error("Camera access failed:", error);
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
      if (faceCheckIntervalRef.current) {
        clearInterval(faceCheckIntervalRef.current);
      }
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, [isActive, enableCameraMonitoring, faceDetected, logProctoringEvent, onTrustScoreChange]);

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
          onTrustScoreChange?.(newScore);
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
        onTrustScoreChange?.(newScore);
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

      {/* Camera Status */}
      {enableCameraMonitoring && (
        <div className="mt-2 flex items-center gap-2">
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs gap-1",
              cameraStatus === "active" 
                ? "text-success border-success/30" 
                : "text-danger border-danger/30"
            )}
          >
            {cameraStatus === "active" ? (
              <>
                <Camera className="h-3 w-3" />
                Camera Active
              </>
            ) : cameraStatus === "blocked" ? (
              <>
                <CameraOff className="h-3 w-3" />
                Camera Blocked
              </>
            ) : (
              <>
                <Video className="h-3 w-3 animate-pulse" />
                Checking...
              </>
            )}
          </Badge>
          {faceDetected && cameraStatus === "active" && (
            <Badge variant="outline" className="text-xs gap-1 text-success border-success/30">
              <Eye className="h-3 w-3" />
              Face Visible
            </Badge>
          )}
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
