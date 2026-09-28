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

  const appIdRef = useRef<string | null>(applicationId);
  const candIdRef = useRef<string | null>(candidateId);

  useEffect(() => {
    if (applicationId) appIdRef.current = applicationId;
    if (candidateId) candIdRef.current = candidateId;
  }, [applicationId, candidateId]);

  // Robust resolver for candidate and application IDs
  const resolveIds = useCallback(async () => {
    let app = appIdRef.current || applicationId;
    let cand = candIdRef.current || candidateId;

    if (!cand) {
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user?.id) {
          cand = data.user.id;
          candIdRef.current = cand;
        }
      } catch (e) {
        console.warn("Could not resolve user for recording:", e);
      }
    }

    if (!app && typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      app = sp.get("application") || sp.get("appId");
      if (app) appIdRef.current = app;
    }

    if (!app && cand) {
      try {
        const { data } = await supabase
          .from("applications")
          .select("id")
          .eq("candidate_id", cand)
          .order("applied_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.id) {
          app = data.id;
          appIdRef.current = app;
        }
      } catch (e) {
        console.warn("Could not resolve active application for recording:", e);
      }
    }

    return { app, cand };
  }, [applicationId, candidateId]);

  // Handle recording completion and upload
  const handleRecordingComplete = useCallback(async () => {
    if (chunksRef.current.length === 0) {
      setRecordingStatus("not_started");
      return;
    }

    const { app, cand } = await resolveIds();

    try {
      setRecordingStatus("uploading");
      setUploadProgress(20);
      
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (blob.size < 1000) {
        console.warn("Recording blob too small:", blob.size);
      }

      const timestamp = Date.now();
      const targetCand = cand || "anonymous";
      const targetApp = app || "unlinked_app";
      const fileName = `${targetCand}/${targetApp}_${timestamp}.webm`;

      const durationMinutes = startTimeRef.current
        ? Math.max(1, Math.ceil((Date.now() - startTimeRef.current.getTime()) / 60000))
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

      let videoUrl = "";
      try {
        const { data: signedData } = await supabase.storage
          .from("interview-recordings")
          .createSignedUrl(fileName, 60 * 60 * 24 * 365);
        if (signedData?.signedUrl) {
          videoUrl = signedData.signedUrl;
        }
      } catch (e) {
        console.warn("Failed to create signed URL:", e);
      }

      if (!videoUrl) {
        const { data: urlData } = supabase.storage
          .from("interview-recordings")
          .getPublicUrl(fileName);
        videoUrl = urlData?.publicUrl || fileName;
      }

      // Update interview_recordings entry with ready status
      if (app) {
        try {
          const { data: recording } = await supabase
            .from("interview_recordings")
            .upsert({
              application_id: app,
              candidate_id: cand || undefined,
              video_url: videoUrl,
              recording_url: videoUrl,
              duration_minutes: durationMinutes,
              status: "ready",
            }, {
              onConflict: "application_id",
            })
            .select()
            .maybeSingle();

          if (recording) {
            setRecordingId(recording.id);
          }
        } catch (dbErr) {
          console.warn("Failed to update interview_recordings table:", dbErr);
        }
      }

      setUploadProgress(100);
      setRecordingUrl(videoUrl);
      setRecordingStatus("ready");
      
      onRecordingComplete?.(videoUrl);
      chunksRef.current = [];
    } catch (err: any) {
      console.warn("Failed to finalize recording:", err);
      setError(err.message || "Failed to finalize recording");
      setRecordingStatus("failed");
    }
  }, [resolveIds, onRecordingComplete]);

  // Start recording - accepts an optional existing preflight stream to prevent device conflicts
  const startRecording = useCallback(async (providedStream?: MediaStream) => {
    const { app, cand } = await resolveIds();

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

      // Create initial recording entry in database if app is known
      if (app) {
        try {
          const { data: recordingEntry } = await supabase
            .from("interview_recordings")
            .insert({
              application_id: app,
              candidate_id: cand || undefined,
              status: "recording",
              duration_minutes: 0,
            })
            .select()
            .maybeSingle();

          if (recordingEntry) {
            setRecordingId(recordingEntry.id);
          }
        } catch (dbErr) {
          console.warn("Failed to insert initial recording row:", dbErr);
        }
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
  }, [resolveIds, handleRecordingComplete]);

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
