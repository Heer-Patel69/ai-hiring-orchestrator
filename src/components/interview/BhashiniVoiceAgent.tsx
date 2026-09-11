import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  AudioQueue,
  blobToBase64,
  downsampleTo16k,
  encodeWav,
  extractSpeakableChunk,
  sanitizeForSpeech,
} from "@/lib/bhashini-audio";
import {
  Brain,
  User,
  Mic,
  Volume2,
  VolumeX,
  Loader2,
  Sparkles,
  Phone,
  PhoneOff,
  Waves,
} from "lucide-react";

export interface VoiceMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: Date;
}

interface BhashiniVoiceAgentProps {
  jobField?: string;
  toughnessLevel?: string;
  jobTitle?: string;
  candidateName?: string;
  language?: string;
  onMessage?: (message: VoiceMessage) => void;
  onConnectionChange?: (connected: boolean) => void;
  onSpeakingChange?: (isSpeaking: boolean) => void;
  className?: string;
  autoConnect?: boolean;
}

// Voice activity detection tuning (kept tight for fast turn-taking)
const SILENCE_THRESHOLD = 0.012;
const SILENCE_HANG_MS = 650;
const MIN_SPEECH_MS = 350;
const MAX_UTTERANCE_MS = 30000;

export function BhashiniVoiceAgent({
  jobField = "Technical",
  toughnessLevel = "medium",
  jobTitle = "Software Engineer",
  candidateName,
  language = "en",
  onMessage,
  onConnectionChange,
  onSpeakingChange,
  className,
  autoConnect = false,
}: BhashiniVoiceAgentProps) {
  const { toast } = useToast();
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const speakingSinceRef = useRef<number>(0);
  const lastVoiceAtRef = useRef<number>(0);
  const capturingRef = useRef(false);
  const busyRef = useRef(false);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const queueRef = useRef<AudioQueue | null>(null);
  const startedRef = useRef(false);

  const onMessageRef = useRef(onMessage);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectionChangeRef.current = onConnectionChange;
    onSpeakingChangeRef.current = onSpeakingChange;
  }, [onMessage, onConnectionChange, onSpeakingChange]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const pushMessage = useCallback((role: "assistant" | "user", content: string) => {
    const msg: VoiceMessage = { id: crypto.randomUUID(), role, content, timestamp: new Date() };
    setMessages((prev) => [...prev, msg]);
    onMessageRef.current?.(msg);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const clean = sanitizeForSpeech(text);
      if (!clean) return;
      try {
        const { data, error } = await supabase.functions.invoke("bhashini-voice", {
          body: { action: "tts", text: clean, language },
        });
        if (error) throw error;
        if (data?.audioContent) queueRef.current?.enqueue(data.audioContent);
      } catch (e) {
        console.error("Bhashini TTS failed:", e);
      }
    },
    [language]
  );

  /** Streams the interviewer reply and speaks each sentence the moment it's ready. */
  const respond = useCallback(
    async (userText: string) => {
      historyRef.current.push({ role: "user", content: userText });
      setIsThinking(true);

      let full = "";
      let buffer = "";
      const pending: Promise<void>[] = [];

      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/interview-agent`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: historyRef.current,
            jobField,
            toughnessLevel,
            jobTitle,
          }),
        });

        if (!res.ok || !res.body) throw new Error(`Interview agent error ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const delta = json?.choices?.[0]?.delta?.content;
              if (!delta) continue;
              full += delta;
              buffer += delta;
              let cut = extractSpeakableChunk(buffer);
              while (cut) {
                pending.push(speak(cut.chunk));
                buffer = cut.rest;
                cut = extractSpeakableChunk(buffer);
              }
            } catch {
              /* partial JSON, ignore */
            }
          }
        }

        if (buffer.trim()) pending.push(speak(buffer.trim()));
        await Promise.all(pending);

        if (full.trim()) {
          historyRef.current.push({ role: "assistant", content: full });
          pushMessage("assistant", full.trim());
        }
      } catch (e) {
        console.error("Interview agent stream failed:", e);
        toast({
          title: "Connection issue",
          description: "The interviewer could not respond. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsThinking(false);
      }
    },
    [jobField, jobTitle, toughnessLevel, speak, pushMessage, toast]
  );

  const transcribeAndRespond = useCallback(
    async (samples: Float32Array, sampleRate: number) => {
      busyRef.current = true;
      try {
        const pcm16k = downsampleTo16k(samples, sampleRate);
        const wav = encodeWav(pcm16k, 16000);
        const audioContent = await blobToBase64(wav);

        const { data, error } = await supabase.functions.invoke("bhashini-voice", {
          body: { action: "asr", audioContent, language, samplingRate: 16000 },
        });
        if (error) throw error;

        const transcript = (data?.transcript ?? "").trim();
        if (transcript.length < 2) return;

        pushMessage("user", transcript);
        await respond(transcript);
      } catch (e) {
        console.error("Bhashini ASR failed:", e);
      } finally {
        busyRef.current = false;
      }
    },
    [language, pushMessage, respond]
  );

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    chunksRef.current = [];
    capturingRef.current = false;
    setIsListening(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    setConnectionState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!activeRef.current) return;
        const input = event.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        setLevel(rms);

        const now = Date.now();
        const voiced = rms > SILENCE_THRESHOLD;

        // Don't record while the interviewer is talking or a turn is in flight
        if (mutedRef.current || busyRef.current || queueRef.current?.isSpeaking) {
          chunksRef.current = [];
          capturingRef.current = false;
          return;
        }

        if (voiced) {
          if (!capturingRef.current) {
            capturingRef.current = true;
            speakingSinceRef.current = now;
            chunksRef.current = [];
            setIsListening(true);
          }
          lastVoiceAtRef.current = now;
        }

        if (capturingRef.current) {
          chunksRef.current.push(new Float32Array(input));

          const speechMs = now - speakingSinceRef.current;
          const silenceMs = now - lastVoiceAtRef.current;

          if ((silenceMs > SILENCE_HANG_MS && speechMs > MIN_SPEECH_MS) || speechMs > MAX_UTTERANCE_MS) {
            const total = chunksRef.current.reduce((n, c) => n + c.length, 0);
            const merged = new Float32Array(total);
            let offset = 0;
            for (const c of chunksRef.current) {
              merged.set(c, offset);
              offset += c.length;
            }
            chunksRef.current = [];
            capturingRef.current = false;
            setIsListening(false);
            void transcribeAndRespond(merged, ctx.sampleRate);
          }
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      queueRef.current = new AudioQueue((speaking) => {
        setIsSpeaking(speaking);
        onSpeakingChangeRef.current?.(speaking);
      });

      activeRef.current = true;
      setConnectionState("connected");
      onConnectionChangeRef.current?.(true);

      const greeting = candidateName
        ? `Hello ${candidateName}, I'm Alex, your AI interviewer for the ${jobTitle} role. Let's begin — tell me when you're ready.`
        : `Hello, I'm Alex, your AI interviewer for the ${jobTitle} role. Let's begin — tell me when you're ready.`;
      pushMessage("assistant", greeting);
      historyRef.current.push({ role: "assistant", content: greeting });
      void speak(greeting);
    } catch (e) {
      console.error("Failed to start voice session:", e);
      setConnectionState("error");
      toast({
        title: "Microphone access required",
        description: "Please allow microphone access to start the voice interview.",
        variant: "destructive",
      });
    }
  }, [candidateName, jobTitle, pushMessage, speak, toast, transcribeAndRespond]);

  const stop = useCallback(() => {
    activeRef.current = false;
    queueRef.current?.stop();
    queueRef.current = null;
    stopCapture();
    setIsThinking(false);
    setIsSpeaking(false);
    setConnectionState("idle");
    onConnectionChangeRef.current?.(false);
    onSpeakingChangeRef.current?.(false);
  }, [stopCapture]);

  useEffect(() => {
    if (autoConnect && !startedRef.current) {
      startedRef.current = true;
      void start();
    }
    return () => {
      activeRef.current = false;
      queueRef.current?.stop();
      stopCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  const connected = connectionState === "connected";
  const status = isSpeaking ? "Interviewer speaking" : isThinking ? "Thinking..." : isListening ? "Listening" : connected ? "Ready" : "Not connected";

  return (
    <div className={cn("flex flex-col rounded-xl border border-border bg-card/60 backdrop-blur-xl overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("relative flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15", connected && "ring-1 ring-primary/40")}>
            <Brain className="h-4 w-4 text-primary" />
            {isSpeaking && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">AI Interviewer</p>
            <p className="truncate text-xs text-muted-foreground">{status}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:inline-flex gap-1 text-xs">
            <Sparkles className="h-3 w-3" /> Bhashini Voice
          </Badge>
          <Button size="icon" variant="ghost" onClick={() => setMuted((m) => !m)} disabled={!connected} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          {connected ? (
            <Button size="sm" variant="destructive" onClick={stop} className="gap-1.5">
              <PhoneOff className="h-4 w-4" /> End
            </Button>
          ) : (
            <Button size="sm" onClick={start} disabled={connectionState === "connecting"} className="gap-1.5">
              {connectionState === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              Start
            </Button>
          )}
        </div>
      </div>

      {/* Transcript */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="space-y-3 p-4">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}
              >
                {m.role === "assistant" && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15">
                    <Brain className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                  )}
                >
                  {m.content}
                </div>
                {m.role === "user" && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isThinking && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing response...
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Mic level footer */}
      <div className="flex items-center gap-3 border-t border-border px-4 py-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", isListening ? "bg-primary/20" : "bg-secondary")}>
          {isListening ? <Waves className="h-4 w-4 text-primary" /> : <Mic className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${Math.min(100, level * 900)}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{muted ? "Muted" : "Hands-free"}</span>
      </div>
    </div>
  );
}
