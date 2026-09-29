import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RecordingStatus = "not_started" | "recording" | "uploading" | "finalizing" | "ready" | "failed";
interface Options { applicationId: string | null; candidateId: string | null; onRecordingComplete?: (url: string) => void; }

export function useInterviewRecording(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("not_started");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const owned = useRef<MediaStream | null>(null);
  const sources = useRef<{ camera: MediaStream | null; screen: MediaStream | null }>({ camera: null, screen: null });
  const videos = useRef<HTMLVideoElement[]>([]);
  const drawTimer = useRef<ReturnType<typeof setInterval>>();
  const startedAt = useRef(0);
  const starting = useRef(false);
  const id = useRef<string | null>(null);
  const rowReady = useRef<Promise<void>>(Promise.resolve());
  const completed = useRef<Promise<string | null> | null>(null);
  const resolveCompleted = useRef<((url: string | null) => void) | null>(null);
  const retainedBlob = useRef<Blob | null>(null);
  const localUrl = useRef<string | null>(null);
  const filePath = useRef<string | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const captureFailed = useRef(false);
  const uploading = useRef(false);

  const release = useCallback(() => {
    clearInterval(drawTimer.current);
    owned.current?.getTracks().forEach(t => t.stop()); owned.current = null;
    audioSource.current?.disconnect(); audioSource.current = null;
    void audioContext.current?.close().catch(() => undefined); audioContext.current = null; audioDestination.current = null;
    videos.current.forEach(v => { v.pause(); v.srcObject = null; }); videos.current = [];
  }, []);

  const updateSources = useCallback((camera: MediaStream | null, screen: MediaStream | null) => {
    if (camera && audioContext.current && audioDestination.current && sources.current.camera?.getAudioTracks()[0] !== camera.getAudioTracks()[0]) {
      audioSource.current?.disconnect();
      audioSource.current = audioContext.current.createMediaStreamSource(camera);
      audioSource.current.connect(audioDestination.current);
    }
    sources.current = { camera, screen };
    [camera, screen].forEach((stream, i) => {
      const video = videos.current[i];
      if (video && stream && video.srcObject !== stream) {
        video.srcObject = stream; void video.play().catch(e => console.warn("[Recording] Source playback", e.name));
      }
    });
  }, []);

  const upload = useCallback(async (): Promise<string | null> => {
    const blob = retainedBlob.current; if (!blob) return null;
    if (uploading.current) return null;
    uploading.current = true;
    try {
      const { applicationId, candidateId } = latest.current;
      if (!applicationId || !candidateId) throw new Error("Recording needs an authenticated candidate and application");
      try { await rowReady.current; }
      catch {
        if (!id.current) throw new Error("Recording metadata could not be created");
        const { error: metadataError } = await supabase.from("interview_recordings").upsert({ id: id.current, application_id: applicationId, candidate_id: candidateId, status: "processing", duration_minutes: 0 }, { onConflict: "id" });
        if (metadataError) throw metadataError;
      }
      if (!id.current) throw new Error("Recording metadata could not be created");
      setRecordingStatus("uploading"); setUploadProgress(0);
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      const path = filePath.current || `${candidateId}/${applicationId}/${id.current}.${extension}`; filePath.current = path;
      const { error: storageError } = await supabase.storage.from("interview-recordings").upload(path, blob, { contentType: blob.type.split(";")[0], upsert: true });
      if (storageError) throw storageError;
      setUploadProgress(75); setRecordingStatus("finalizing");
      const { data, error: urlError } = await supabase.storage.from("interview-recordings").createSignedUrl(path, 60 * 60 * 24 * 7);
      if (urlError || !data?.signedUrl) throw urlError || new Error("Recording playback URL could not be created");
      const { error: dbError } = await supabase.from("interview_recordings").update({
        video_url: data.signedUrl, recording_url: data.signedUrl,
        status: captureFailed.current ? "failed" : "ready", duration_minutes: Math.max(1, Math.ceil((Date.now() - startedAt.current) / 60000)),
      }).eq("id", id.current);
      if (dbError) throw dbError;
      setRecordingUrl(data.signedUrl); setRecordingStatus(captureFailed.current ? "failed" : "ready"); setUploadProgress(100);
      setError(captureFailed.current ? "A partial recording was stored because browser capture failed during the interview." : null);
      retainedBlob.current = null; chunks.current = [];
      latest.current.onRecordingComplete?.(data.signedUrl); return data.signedUrl;
    } catch (cause) {
      console.error("[Recording] Persistence failed", cause);
      if (id.current) {
        const { error: metadataError } = await supabase.from("interview_recordings").update({ status: "failed" }).eq("id", id.current);
        if (metadataError) console.warn("[Recording] Failed status could not be saved", metadataError.code);
      }
      const reason = cause instanceof Error ? cause.message : (cause as { message?: string })?.message;
      setError(`${reason || "Recording could not be stored"}. Download your local copy or retry upload before leaving this page.`);
      setRecordingStatus("failed"); return null;
    } finally { uploading.current = false; }
  }, []);

  const startRecording = useCallback(async (provided?: MediaStream, display?: MediaStream) => {
    if (starting.current || recorder.current?.state === "recording") return true;
    starting.current = true;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser does not support recording");
      if (!provided?.getVideoTracks().some(t => t.readyState === "live") || !provided.getAudioTracks().some(t => t.readyState === "live")) throw new Error("Camera and microphone must be live before recording starts");
      const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Recording compositor is unavailable");
      const makeVideo = (stream: MediaStream | undefined) => {
        const v = document.createElement("video"); v.muted = true; v.autoplay = true; v.playsInline = true;
        if (stream) { v.srcObject = stream; void v.play().catch(e => console.warn("[Recording] Playback source", e.name)); } return v;
      };
      videos.current = [makeVideo(provided), makeVideo(display)]; sources.current = { camera: provided, screen: display || null };
      const draw = () => {
        context.fillStyle = "#101827"; context.fillRect(0, 0, 1280, 720);
        const [cam, shared] = videos.current;
        const liveScreen = sources.current.screen?.getVideoTracks().some(t => t.readyState === "live");
        if (shared && liveScreen && shared.readyState >= 2) context.drawImage(shared, 0, 0, 1280, 720);
        if (cam && cam.readyState >= 2 && sources.current.camera?.getVideoTracks().some(t => t.readyState === "live" && t.enabled && !t.muted)) {
          if (liveScreen) context.drawImage(cam, 1008, 516, 256, 192); else context.drawImage(cam, 0, 0, 1280, 720);
        }
      };
      draw(); drawTimer.current = setInterval(draw, 1000 / 24);
      const composite = canvas.captureStream(24);
      // Stable WebAudio output survives replacement of the independent microphone source.
      owned.current = composite;
      const audio = new AudioContext(); audioContext.current = audio;
      await audio.resume();
      audioDestination.current = audio.createMediaStreamDestination();
      audioSource.current = audio.createMediaStreamSource(provided); audioSource.current.connect(audioDestination.current);
      for (const track of audioDestination.current.stream.getAudioTracks()) composite.addTrack(track);
      const mimes = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4"];
      const mimeType = mimes.find(m => MediaRecorder.isTypeSupported(m));
      const next = new MediaRecorder(composite, mimeType ? { mimeType, videoBitsPerSecond: 1200000 } : undefined);
      recorder.current = next; chunks.current = []; startedAt.current = Date.now(); id.current = crypto.randomUUID(); filePath.current = null; captureFailed.current = false;
      completed.current = new Promise(resolve => { resolveCompleted.current = resolve; });
      next.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      next.onstart = () => { setIsRecording(next.state === "recording"); setRecordingStatus("recording"); };
      next.onerror = event => {
        console.error("[Recording] MediaRecorder error", event);
        captureFailed.current = true;
        setError("The browser could not continue recording. Captured data will be retained."); setRecordingStatus("failed"); setIsRecording(false);
        if (next.state !== "inactive") next.stop();
      };
      next.onstop = async () => {
        setIsRecording(false); release();
        const blob = new Blob(chunks.current, { type: next.mimeType || mimeType || "video/webm" });
        if (!blob.size) { setError("No recording data was captured"); setRecordingStatus("failed"); resolveCompleted.current?.(null); return; }
        retainedBlob.current = blob;
        if (localUrl.current) URL.revokeObjectURL(localUrl.current);
        localUrl.current = URL.createObjectURL(blob); setRecordingUrl(localUrl.current);
        resolveCompleted.current?.(await upload());
      };
      next.start(3000); setError(null);
      rowReady.current = (async () => {
        const { applicationId, candidateId } = latest.current;
        if (!applicationId || !candidateId) throw new Error("Recording identity is missing");
        const { data, error } = await supabase.from("interview_recordings").insert({ id: id.current, application_id: applicationId, candidate_id: candidateId, status: "recording", duration_minutes: 0 }).select("id").single();
        if (error) throw error; id.current = data.id; setRecordingId(data.id);
      })();
      void rowReady.current.catch(e => { console.error("[Recording] Metadata creation", e); setError("Recording is running, but metadata could not be saved. Keep a local copy at the end."); });
      return true;
    } catch (cause) {
      release(); console.error("[Recording] Start failed", cause);
      setError(cause instanceof Error ? cause.message : "Recording could not start"); setRecordingStatus("failed"); setIsRecording(false); return false;
    } finally { starting.current = false; }
  }, [release, upload]);

  const stopRecording = useCallback((): Promise<string | null> => {
    if (recorder.current && recorder.current.state !== "inactive") { setRecordingStatus("finalizing"); recorder.current.stop(); }
    return completed.current || Promise.resolve(null);
  }, []);
  const getStream = useCallback(() => sources.current.camera, []);
  useEffect(() => () => {
    if (recorder.current?.state !== "inactive") recorder.current?.stop(); release();
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
  }, [release]);
  return { isRecording, recordingStatus, recordingUrl, recordingId, error, uploadProgress, startRecording, stopRecording, getStream, updateSources, retryUpload: upload };
}
