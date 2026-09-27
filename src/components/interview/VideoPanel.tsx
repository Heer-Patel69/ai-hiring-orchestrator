import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Circle,
  Clock,
  Brain,
  User,
  Volume2,
} from "lucide-react";

interface VideoPanelProps {
  isRecording: boolean;
  elapsedTime: number;
  remainingTime: number;
  aiSpeaking: boolean;
  className?: string;
  mediaStream?: MediaStream | null;
}

export function VideoPanel({
  isRecording,
  elapsedTime,
  remainingTime,
  aiSpeaking,
  className,
  mediaStream,
}: VideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (mediaStream) {
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      return;
    }

    let activeStream: MediaStream | null = null;
    const initCamera = async () => {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        activeStream = ms;
        setStream(ms);
        if (videoRef.current) {
          videoRef.current.srcObject = ms;
        }
      } catch (error) {
        console.error("Camera error:", error);
        setCameraError("Unable to access camera");
      }
    };

    initCamera();

    return () => {
      if (!mediaStream && activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [mediaStream]);

  const toggleVideo = useCallback(() => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setVideoEnabled(!videoEnabled);
    }
  }, [stream, videoEnabled]);

  const toggleAudio = useCallback(() => {
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setAudioEnabled(!audioEnabled);
    }
  }, [stream, audioEnabled]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Candidate Video */}
      <div className="relative rounded-xl overflow-hidden bg-secondary aspect-video">
        {cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <VideoOff className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{cameraError}</p>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "w-full h-full object-cover",
              !videoEnabled && "hidden"
            )}
          />
        )}

        {!videoEnabled && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-secondary">
            <User className="h-16 w-16 text-muted-foreground" />
          </div>
        )}

        {/* Recording Indicator */}
        {isRecording && (
          <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 rounded-full bg-danger/90 text-danger-foreground">
            <Circle className="h-3 w-3 fill-current animate-pulse" />
            <span className="text-xs font-medium">REC</span>
          </div>
        )}

        {/* Timer */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
            <Clock className="h-3 w-3 mr-1" />
            {formatTime(elapsedTime)}
          </Badge>
          {remainingTime > 0 && (
            <Badge
              variant="secondary"
              className={cn(
                "bg-background/80 backdrop-blur-sm",
                remainingTime < 60 && "bg-danger/80 text-danger-foreground"
              )}
            >
              -{formatTime(remainingTime)}
            </Badge>
          )}
        </div>

        {/* Controls */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
          <Button
            size="sm"
            variant={videoEnabled ? "secondary" : "destructive"}
            className="rounded-full h-10 w-10 p-0"
            onClick={toggleVideo}
          >
            {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            variant={audioEnabled ? "secondary" : "destructive"}
            className="rounded-full h-10 w-10 p-0"
            onClick={toggleAudio}
          >
            {audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
        </div>

        <Badge className="absolute bottom-3 left-3 bg-background/80 backdrop-blur-sm text-foreground">
          You
        </Badge>
      </div>

      {/* AI Interviewer Avatar */}
      <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 aspect-video border border-primary/20">
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={aiSpeaking ? { scale: [1, 1.1, 1] } : { scale: 1 }}
            transition={{ duration: 0.5, repeat: aiSpeaking ? Infinity : 0 }}
            className="relative"
          >
            <div className={cn(
              "h-24 w-24 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg",
              aiSpeaking && "ring-4 ring-primary/30 ring-offset-2 ring-offset-background"
            )}>
              <Brain className="h-12 w-12 text-primary-foreground" />
            </div>
            
            {/* Sound waves animation */}
            <AnimatePresence>
              {aiSpeaking && (
                <>
                  {[1, 2, 3].map((i) => (
                    <motion.div
                      key={i}
                      initial={{ scale: 1, opacity: 0.5 }}
                      animate={{ scale: 1.5 + i * 0.3, opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        delay: i * 0.3,
                      }}
                      className="absolute inset-0 rounded-full border-2 border-primary"
                    />
                  ))}
                </>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Speaking Indicator */}
        <div className="absolute top-3 right-3">
          <AnimatePresence>
            {aiSpeaking && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
              >
                <Badge className="bg-primary text-primary-foreground">
                  <Volume2 className="h-3 w-3 mr-1 animate-pulse" />
                  Speaking
                </Badge>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Badge className="absolute bottom-3 left-3 bg-primary text-primary-foreground">
          AI Interviewer
        </Badge>
      </div>
    </div>
  );
}
