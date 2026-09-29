import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ProctoringEventType =
  | "face_detected"
  | "face_not_visible"
  | "multiple_faces"
  | "looking_away"
  | "tab_switch"
  | "copy_paste"
  | "audio_anomaly"
  | "suspicious_movement"
  | "recording_started"
  | "recording_stopped"
  | "camera_blocked"
  | "camera_too_dark"
  | "screen_share_detected"
  | "screen_share_started"
  | "screen_share_stopped"
  | "screen_share_wrong_surface"
  | "screen_share_restored";

export interface ProctoringEvent {
  type: ProctoringEventType;
  timestamp: Date;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  timestampInVideo?: number;
  metadata?: Record<string, any>;
}

interface UseProctoringLoggerOptions {
  applicationId: string | null;
  recordingId?: string | null;
  candidateId: string | null;
  batchSize?: number;
  flushInterval?: number;
}

export function useProctoringLogger({
  applicationId,
  recordingId,
  candidateId,
  batchSize = 10,
  flushInterval = 5000,
}: UseProctoringLoggerOptions) {
  const eventBuffer = useRef<ProctoringEvent[]>([]);
  const lastLoggedTimes = useRef<Map<string, number>>(new Map());
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const recordedRef = useRef(false);

  // Flush events to database
  const flushEvents = useCallback(async () => {
    if (eventBuffer.current.length === 0 || !applicationId || !candidateId) return;

    const eventsToFlush = [...eventBuffer.current];
    eventBuffer.current = [];

    try {
      const logsToInsert = eventsToFlush.map((event) => ({
        application_id: applicationId,
        recording_id: recordingId || null,
        candidate_id: candidateId,
        event_type: event.type,
        severity: event.severity === "critical" ? "high" : event.severity,
        description: event.description,
        timestamp_in_video: event.timestampInVideo || null,
        metadata: event.metadata || {},
        trust_score_impact: getSeverityImpact(event.severity),
      }));

      const { error } = await supabase
        .from("proctoring_logs")
        .insert(logsToInsert);

      if (error) {
        console.warn("Failed to log proctoring events:", error);
        // Put events back in buffer for retry
        eventBuffer.current = [...eventsToFlush, ...eventBuffer.current];
      }
    } catch (error) {
      console.warn("Error flushing proctoring events:", error);
      eventBuffer.current = [...eventsToFlush, ...eventBuffer.current];
    }
  }, [applicationId, recordingId, candidateId]);

  // Get trust score impact based on severity
  const getSeverityImpact = (severity: string): number => {
    switch (severity) {
      case "critical": return -15;
      case "high": return -10;
      case "medium": return -5;
      case "low": return -2;
      default: return 0;
    }
  };

  // Log a single event with deduplication to prevent React render spam
  const logEvent = useCallback((event: ProctoringEvent) => {
    const now = Date.now();
    const eventKey = `${event.type}:${event.description}`;
    const lastTime = lastLoggedTimes.current.get(eventKey) || 0;

    // Suppress identical events that occurred within the last 6 seconds
    if (now - lastTime < 6000) {
      return;
    }
    lastLoggedTimes.current.set(eventKey, now);

    // Calculate timestamp in video
    const timestampInVideo = startTimeRef.current
      ? Math.floor((event.timestamp.getTime() - startTimeRef.current.getTime()) / 1000)
      : undefined;

    eventBuffer.current.push({
      ...event,
      timestampInVideo,
    });

    // Flush if buffer is full
    if (eventBuffer.current.length >= batchSize) {
      void flushEvents();
    }
  }, [batchSize, flushEvents]);

  const flushRef = useRef(flushEvents); flushRef.current = flushEvents;
  useEffect(() => () => { if (flushTimerRef.current) clearInterval(flushTimerRef.current); void flushRef.current(); }, []);

  // Start logging session
  const startLogging = useCallback((recordingActive = false) => {
    if (flushTimerRef.current) return;
    startTimeRef.current = new Date();
    
    // Set up periodic flush
    flushTimerRef.current = setInterval(() => {
      void flushRef.current();
    }, flushInterval);

    // Log recording start
    recordedRef.current = recordingActive;
    if (recordingActive) logEvent({
      type: "recording_started",
      timestamp: new Date(),
      severity: "low",
      description: "Interview recording and monitoring started",
    });
  }, [flushEvents, flushInterval, logEvent]);

  // Stop logging session
  const stopLogging = useCallback(async () => {
    // Log recording stop
    if (recordedRef.current) logEvent({
      type: "recording_stopped",
      timestamp: new Date(),
      severity: "low",
      description: "Interview recording and monitoring stopped",
    });
    recordedRef.current = false;

    // Clear timer and flush remaining events
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    await flushEvents();
  }, [flushEvents, logEvent]);

  // Log camera activity detection
  const logCameraActivity = useCallback((
    activityType: "face_detected" | "face_not_visible" | "multiple_faces" | "looking_away" | "camera_blocked" | "camera_too_dark",
    details?: string
  ) => {
    const severityMap: Record<string, "low" | "medium" | "high" | "critical"> = {
      face_detected: "low",
      face_not_visible: "medium",
      multiple_faces: "high",
      looking_away: "medium",
      camera_blocked: "high",
      camera_too_dark: "high",
    };

    logEvent({
      type: activityType,
      timestamp: new Date(),
      severity: severityMap[activityType] || "medium",
      description: details || `Camera status: ${activityType.replace(/_/g, " ")}`,
    });
  }, [logEvent]);

  const logProctoringEvent = useCallback((
    type: ProctoringEventType,
    severity: "low" | "medium" | "high" | "critical",
    description: string,
  ) => {
    logEvent({ type, severity, description, timestamp: new Date() });
  }, [logEvent]);

  return {
    logEvent,
    logProctoringEvent,
    logCameraActivity,
    startLogging,
    stopLogging,
    flushEvents,
  };
}
