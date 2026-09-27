import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type RecordingStatus = "not_started" | "recording" | "uploading" | "finalizing" | "ready" | "failed";

interface UseInterviewRecordingOptions {
  applicationId: string | null;
  candidateId: string | null;
  onRecordingComplete?: (recordingUrl: string) => void;
}

export function useInterviewRecording({
  applicationId,
  candidateId,
  onRecordingComplete,
}: UseInterviewRecordingOptions) {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("not_started");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Start recording - accepts an optional existing preflight stream to prevent device conflicts
  const startRecording = useCallback(async (providedStream?: MediaStream) => {
    if (!applicationId || !candidateId) {
      setError("Missing application or candidate ID");
      console.warn("Recording failed: Missing IDs", { applicationId, candidateId });
      return false;
    }

    try {
      let stream = providedStream;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            facingMode: "user",
            frameRate: { ideal: 24, max: 30 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100,
          },
        });
      }

      streamRef.current = stream;
      chunksRef.current = [];
      startTimeRef.current = new Date();

      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=h264,opus",
        "video/webm",
        "video/mp4",
      ];
      
      let selectedMimeType = "video/webm";
      for (const mimeType of mimeTypes) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 1200000,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setRecordingStatus("finalizing");
        await handleRecordingComplete();
      };

      mediaRecorder.onerror = (event: any) => {
        console.error("MediaRecorder error:", event.error || event);
        setError("Recording error occurred");
        setRecordingStatus("failed");
      };

      mediaRecorderRef.current = mediaRecorder;
      
      // Timeslice chunks every 3 seconds for safe chunked persistence
      mediaRecorder.start(3000);
      setIsRecording(true);
      setRecordingStatus("recording");
      setError(null);
      setUploadProgress(0);

      // Create initial recording entry in database
      const { data: recordingEntry } = await supabase
        .from("interview_recordings")
        .insert({
          application_id: applicationId,
          status: "recording",
          duration_minutes: 0,
        })
        .select()
        .maybeSingle();

      if (recordingEntry) {
        setRecordingId(recordingEntry.id);
      }

      return true;
    } catch (err: any) {
      console.warn("Failed to start recording:", err);
      let errorMessage = "Failed to access camera/microphone";
      if (err.name === "NotAllowedError") {
        errorMessage = "Camera/microphone access denied.";
      } else if (err.name === "NotReadableError") {
        errorMessage = "Camera/microphone is already in use by another task.";
      }
      
      setError(errorMessage);
      setRecordingStatus("failed");
      return false;
    }
  }, [applicationId, candidateId]);

  // Handle recording completion and upload
  const handleRecordingComplete = useCallback(async () => {
    if (chunksRef.current.length === 0 || !applicationId || !candidateId) {
      setRecordingStatus("failed");
      return;
    }

    try {
      setRecordingStatus("uploading");
      setUploadProgress(20);
      
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (blob.size < 1000) {
        console.warn("Recording blob too small");
      }

      const timestamp = Date.now();
      const fileName = `${candidateId}/${applicationId}_${timestamp}.webm`;

      const durationMinutes = startTimeRef.current
        ? Math.ceil((Date.now() - startTimeRef.current.getTime()) / 60000)
        : 1;

      setUploadProgress(50);

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("interview-recordings")
        .upload(fileName, blob, {
          contentType: "video/webm",
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        console.warn("Upload to interview-recordings storage error:", uploadError);
      }

      setUploadProgress(80);
      setRecordingStatus("finalizing");

      const { data: urlData } = supabase.storage
        .from("interview-recordings")
        .getPublicUrl(fileName);

      const videoUrl = urlData?.publicUrl || fileName;

      // Update interview_recordings entry with ready status
      const { data: recording } = await supabase
        .from("interview_recordings")
        .upsert({
          application_id: applicationId,
          video_url: videoUrl,
          duration_minutes: durationMinutes,
          status: "ready",
        }, {
          onConflict: "application_id",
        })
        .select()
        .maybeSingle();

      setUploadProgress(100);
      setRecordingUrl(videoUrl);
      setRecordingStatus("ready");
      if (recording) {
        setRecordingId(recording.id);
      }
      
      onRecordingComplete?.(videoUrl);
      chunksRef.current = [];
    } catch (err: any) {
      console.warn("Failed to finalize recording:", err);
      setError(err.message || "Failed to finalize recording");
      setRecordingStatus("failed");
    }
  }, [applicationId, candidateId, onRecordingComplete]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.warn("Error stopping MediaRecorder:", err);
      }
      setIsRecording(false);
    }

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  const getStream = useCallback(() => streamRef.current, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  return {
    isRecording,
    recordingStatus,
    recordingUrl,
    recordingId,
    error,
    uploadProgress,
    startRecording,
    stopRecording,
    getStream,
  };
}
