import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  Video,
  Download,
  Play,
  Pause,
  Eye,
  Lock,
  Archive,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Volume2,
  VolumeX,
  Maximize2,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface InterviewRecording {
  id: string;
  application_id: string;
  video_url: string | null;
  audio_url: string | null;
  duration_minutes: number | null;
  status: string | null;
  viewed_at: string | null;
  viewed_by: string | null;
  downloaded_at: string | null;
  archived_at: string | null;
}

interface ProctoringLog {
  id: string;
  event_type: string;
  severity: string;
  description: string;
  timestamp_in_video: number | null;
  created_at: string;
}

interface InterviewRecordingViewerProps {
  applicationId: string;
  candidateName: string;
  className?: string;
}

export function InterviewRecordingViewer({
  applicationId,
  candidateName,
  className,
}: InterviewRecordingViewerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [recording, setRecording] = useState<InterviewRecording | null>(null);
  const [proctoringLogs, setProctoringLogs] = useState<ProctoringLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"view" | "download" | "archive">("view");
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasViewed, setHasViewed] = useState(false);

  // Fetch recording and proctoring logs
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch recording
        const { data: recordingData, error: recordingError } = await supabase
          .from("interview_recordings")
          .select("*")
          .eq("application_id", applicationId)
          .order("created_at", { ascending: false }).limit(1)
          .maybeSingle();

        if (recordingError) throw recordingError;

        let resolvedRecording: InterviewRecording | null = recordingData;
        let effectiveVideoUrl = recordingData?.video_url || "";

        // Check if there is a cached recording URL in session storage
        if (!effectiveVideoUrl || effectiveVideoUrl.trim() === "") {
          const cachedUrl = typeof window !== "undefined"
            ? sessionStorage.getItem(`interview_recording_${applicationId}`)
            : null;
          if (cachedUrl) {
            effectiveVideoUrl = cachedUrl;
          }
        }

        if (!resolvedRecording && effectiveVideoUrl) {
          resolvedRecording = {
            id: `rec-${applicationId}`,
            application_id: applicationId,
            video_url: effectiveVideoUrl,
            audio_url: null,
            duration_minutes: 5,
            status: "ready",
            viewed_at: null,
            viewed_by: null,
            downloaded_at: null,
            archived_at: null,
          };
        }

        if (resolvedRecording && effectiveVideoUrl) {
          let playableUrl = effectiveVideoUrl;
          if (!playableUrl.startsWith("blob:") && !playableUrl.startsWith("data:")) {
            let storagePath = playableUrl;
            if (storagePath.includes("/interview-recordings/")) {
              storagePath = storagePath.split("/interview-recordings/").pop()?.split("?")[0] || storagePath;
            }
            try {
              const { data: signedData } = await supabase.storage
                .from("interview-recordings")
                .createSignedUrl(storagePath, 7200);
              if (signedData?.signedUrl) {
                playableUrl = signedData.signedUrl;
              }
            } catch (sErr) {
              console.warn("Could not create signed URL:", sErr);
            }
          }
          resolvedRecording.video_url = playableUrl;
        }

        setRecording(resolvedRecording);
        setHasViewed(!!resolvedRecording?.viewed_at);

        // Fetch proctoring logs
        if (resolvedRecording) {
          const { data: logs, error: logsError } = await supabase
            .from("proctoring_logs")
            .select("*")
            .eq("application_id", applicationId)
            .order("created_at", { ascending: true });

          if (!logsError && logs) {
            setProctoringLogs(logs);
          }
        }
      } catch (error) {
        console.error("Error fetching recording:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (applicationId) {
      fetchData();
    }
  }, [applicationId]);

  // Handle video time update
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Handle video loaded
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  // Play/Pause toggle
  const togglePlay = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Handle first view
  const handleFirstView = async () => {
    if (!recording || hasViewed) return;

    try {
      const { error } = await supabase
        .from("interview_recordings")
        .update({
          viewed_at: new Date().toISOString(),
          viewed_by: user?.id,
          status: "viewed",
        })
        .eq("id", recording.id);

      if (error) throw error;
      setHasViewed(true);

      toast({
        title: "Recording Viewed",
        description: "This recording will be archived after download.",
      });
    } catch (error) {
      console.error("Error marking as viewed:", error);
    }
  };

  // Handle download
  const handleDownload = async () => {
    if (!recording?.video_url) return;

    setIsProcessing(true);
    try {
      // Update download timestamp
      await supabase
        .from("interview_recordings")
        .update({
          downloaded_at: new Date().toISOString(),
          downloaded_by: user?.id,
        })
        .eq("id", recording.id);

      // Download the file
      const response = await fetch(recording.video_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `interview_${candidateName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Download Started",
        description: "The recording is being downloaded.",
      });

      // Show archive confirmation
      setConfirmAction("archive");
      setShowConfirmDialog(true);
    } catch (error) {
      console.error("Error downloading:", error);
      toast({
        title: "Download Failed",
        description: "Could not download the recording.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle archive
  const handleArchive = async () => {
    if (!recording) return;

    setIsProcessing(true);
    try {
      // Update status to archived
      const { error } = await supabase
        .from("interview_recordings")
        .update({
          status: "archived",
          archived_at: new Date().toISOString(),
        })
        .eq("id", recording.id);

      if (error) throw error;

      // Delete from storage to free space
      if (recording.video_url) {
        const path = recording.video_url.split("/").slice(-2).join("/");
        await supabase.storage.from("interview-recordings").remove([path]);
      }

      setRecording({ ...recording, status: "archived" });

      toast({
        title: "Recording Archived",
        description: "The recording has been securely archived and removed from active storage.",
      });
    } catch (error) {
      console.error("Error archiving:", error);
      toast({
        title: "Archive Failed",
        description: "Could not archive the recording.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setShowConfirmDialog(false);
    }
  };

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Seek to proctoring event
  const seekToEvent = (timestampInVideo: number | null) => {
    if (videoRef.current && timestampInVideo !== null) {
      videoRef.current.currentTime = timestampInVideo;
    }
  };

  // Get severity color
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high":
      case "critical":
        return "text-danger border-danger/30 bg-danger/10";
      case "medium":
        return "text-warning border-warning/30 bg-warning/10";
      default:
        return "text-info border-info/30 bg-info/10";
    }
  };

  if (isLoading) {
    return (
      <GlassCard className={cn("flex items-center justify-center py-12", className)}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </GlassCard>
    );
  }

  if (!recording) {
    return (
      <GlassCard className={cn("text-center py-8", className)}>
        <Video className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No recording available for this interview</p>
      </GlassCard>
    );
  }

  if (recording.status === "archived") {
    return (
      <GlassCard className={cn("text-center py-8", className)}>
        <Archive className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="font-medium mb-2">Recording Archived</p>
        <p className="text-sm text-muted-foreground">
          This recording was viewed and archived on{" "}
          {recording.archived_at
            ? new Date(recording.archived_at).toLocaleDateString()
            : "N/A"}
        </p>
      </GlassCard>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Video Player */}
      <GlassCard className="p-0 overflow-hidden">
        {!hasViewed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/95 backdrop-blur">
            <Lock className="h-12 w-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">One-Time View Recording</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
              This recording can only be viewed once. After viewing, you can download it
              and it will be archived automatically.
            </p>
            <Button
              onClick={() => {
                setConfirmAction("view");
                setShowConfirmDialog(true);
              }}
            >
              <Eye className="mr-2 h-4 w-4" />
              Start Viewing
            </Button>
          </div>
        )}

        <div className="relative bg-black aspect-video flex items-center justify-center">
          {recording.video_url ? (
            <video
              ref={videoRef}
              src={recording.video_url}
              className="w-full h-full"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              muted={isMuted}
            />
          ) : (
            <div className="text-center p-6 text-muted-foreground">
              <Video className="h-10 w-10 mx-auto mb-2 text-primary/70 animate-pulse" />
              <p className="text-sm font-medium text-foreground">Interview Video Stream Processing</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Candidate audio signals, proctoring events, and Groq-evaluated transcripts are synchronized in the audit logs.
              </p>
            </div>
          )}

          {/* Video Controls */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={togglePlay} className="text-white">
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime -= 10;
                }}
                className="text-white"
              >
                <SkipBack className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime += 10;
                }}
                className="text-white"
              >
                <SkipForward className="h-4 w-4" />
              </Button>

              <div className="flex-1 mx-2">
                <Progress
                  value={(currentTime / duration) * 100}
                  className="h-1 cursor-pointer"
                  onClick={(e) => {
                    if (videoRef.current) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pos = (e.clientX - rect.left) / rect.width;
                      videoRef.current.currentTime = pos * duration;
                    }
                  }}
                />
              </div>

              <span className="text-xs text-white/80 min-w-[80px]">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMuted(!isMuted)}
                className="text-white"
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => videoRef.current?.requestFullscreen()}
                className="text-white"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="p-4 border-t flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {recording.duration_minutes || 0} min
            </Badge>
            {hasViewed && (
              <Badge variant="outline" className="gap-1 text-success border-success/30">
                <CheckCircle2 className="h-3 w-3" />
                Viewed
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isProcessing || !hasViewed}
            >
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirmAction("archive");
                setShowConfirmDialog(true);
              }}
              disabled={isProcessing || !hasViewed || !recording.downloaded_at}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Proctoring Timeline */}
      {proctoringLogs.length > 0 && (
        <GlassCard>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Proctoring Events ({proctoringLogs.length})
          </h3>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {proctoringLogs.map((log) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg border cursor-pointer hover:bg-secondary/50",
                  getSeverityColor(log.severity)
                )}
                onClick={() => seekToEvent(log.timestamp_in_video)}
              >
                <Badge variant="outline" className="min-w-[60px] justify-center">
                  {log.timestamp_in_video !== null
                    ? formatTime(log.timestamp_in_video)
                    : "N/A"}
                </Badge>
                <span className="text-sm flex-1">{log.description}</span>
                <Badge
                  variant="outline"
                  className={cn("text-xs", getSeverityColor(log.severity))}
                >
                  {log.severity}
                </Badge>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "view"
                ? "Start Viewing Recording?"
                : confirmAction === "download"
                ? "Download Recording?"
                : "Archive Recording?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "view" ? (
                <>
                  This is a one-time view recording. Once you start watching, you'll need
                  to download it before it can be archived. The recording will be removed
                  from active storage after archiving.
                </>
              ) : confirmAction === "archive" ? (
                <>
                  Archiving will permanently remove this recording from active storage.
                  Make sure you've downloaded a copy if needed. This action cannot be
                  undone.
                </>
              ) : (
                <>Your download will begin shortly.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirmAction === "view") {
                  await handleFirstView();
                  setShowConfirmDialog(false);
                } else if (confirmAction === "archive") {
                  await handleArchive();
                }
              }}
              disabled={isProcessing}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmAction === "view"
                ? "Start Viewing"
                : confirmAction === "archive"
                ? "Archive Now"
                : "Download"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
