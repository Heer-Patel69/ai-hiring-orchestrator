import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Brain,
  User,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Loader2,
  Sparkles,
  Phone,
  PhoneOff,
  Waves,
} from "lucide-react";
import { FinalTranscriptBuffer } from "@/lib/interview-turns";
import { useToast } from "@/hooks/use-toast";

export type VoiceState =
  | "IDLE"
  | "LISTENING"
  | "PROCESSING_SPEECH"
  | "THINKING"
  | "AI_SPEAKING"
  | "INTERRUPTED"
  | "ERROR";

export interface Message {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface ContinuousVoicePanelProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (message: string, utteranceId?: string) => void | Promise<void>;
  onListeningChange?: (listening: boolean) => void;
  className?: string;
  autoListen?: boolean;
  aiSpeaking?: boolean;
  onCandidateSpeech?: (text: string) => void;
  onBargeIn?: () => void;
}

export function ContinuousVoicePanel({
  messages,
  isLoading,
  onSendMessage,
  className,
  autoListen = true,
  aiSpeaking = false,
  onCandidateSpeech,
  onBargeIn,
  onListeningChange,
}: ContinuousVoicePanelProps) {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isContinuousMode, setIsContinuousMode] = useState(autoListen);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const callbacks = useRef({ onSendMessage, onCandidateSpeech, onBargeIn, onListeningChange });
  callbacks.current = { onSendMessage, onCandidateSpeech, onBargeIn, onListeningChange };
  const gate = useRef({ aiSpeaking, isLoading, autoListen, isContinuousMode });
  gate.current = { aiSpeaking, isLoading, autoListen, isContinuousMode };
  const submitting = useRef(false);
  const finals = useRef(new FinalTranscriptBuffer());
  const silence = useRef<ReturnType<typeof setTimeout>>();
  const restart = useRef<ReturnType<typeof setTimeout>>();
  const recognitionActive = useRef(false);
  const mounted = useRef(false);
  const allowed = useCallback(() => mounted.current && gate.current.autoListen && gate.current.isContinuousMode &&
    !gate.current.aiSpeaking && !gate.current.isLoading && !submitting.current, []);

  const clearPending = useCallback(() => {
    clearTimeout(silence.current);
    finals.current.clear();
    setInterimTranscript("");
    callbacks.current.onCandidateSpeech?.("");
  }, []);
  const commit = useCallback(async (text: string) => {
    if (!text.trim() || submitting.current || gate.current.isLoading) return;
    submitting.current = true;
    const utteranceId = crypto.randomUUID();
    clearPending();
    recognitionRef.current?.abort();
    setVoiceState("PROCESSING_SPEECH");
    if (import.meta.env.DEV) console.debug(`[STT] Final transcript turn=${utteranceId}`);
    try { await callbacks.current.onSendMessage(text.trim(), utteranceId); }
    finally {
      submitting.current = false;
      if (allowed()) restart.current = setTimeout(() => {
        if (allowed() && !recognitionActive.current) {
          try { recognitionRef.current?.start(); } catch { /* onend also restarts */ }
        }
      }, 200);
    }
  }, [allowed, clearPending]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages, interimTranscript]);

  useEffect(() => {
    mounted.current = true;
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) { setIsSupported(false); return () => { mounted.current = false; }; }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      if (!allowed()) { recognition.abort(); return; }
      finals.current.resetRun();
      recognitionActive.current = true;
      setIsListening(true);
      callbacks.current.onListeningChange?.(true);
      setVoiceState("LISTENING");
    };
    recognition.onresult = (event: any) => {
      if (!allowed()) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finals.current.add(i, event.results[i][0].transcript);
      }
      for (let i = 0; i < event.results.length; i++) {
        if (!event.results[i].isFinal) interim += event.results[i][0].transcript;
      }
      const live = [finals.current.text, interim.trim()].filter(Boolean).join(" ");
      setInterimTranscript(live);
      callbacks.current.onCandidateSpeech?.(live);
      clearTimeout(silence.current);
      // Interim results are display-only. Wait for final results and a natural pause.
      if (!interim.trim() && finals.current.text) silence.current = setTimeout(() => {
        if (allowed()) void commit(finals.current.take());
      }, 1100);
    };
    recognition.onend = () => {
      recognitionActive.current = false;
      if (!mounted.current) return;
      setIsListening(false);
      callbacks.current.onListeningChange?.(false);
      if (allowed()) {
        clearTimeout(restart.current);
        restart.current = setTimeout(() => {
          if (allowed()) { try { recognition.start(); } catch { setVoiceState("ERROR"); } }
        }, 200);
      }
    };
    recognition.onerror = (event: any) => {
      if (!mounted.current || event.error === "aborted" || event.error === "no-speech") return;
      console.warn("[STT] Recognition error", event.error);
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
        gate.current.isContinuousMode = false;
        setIsContinuousMode(false);
        clearPending();
        toast({ title: "Microphone unavailable", description: "Check microphone permissions and your input device, then enable voice again.", variant: "destructive" });
      }
      setVoiceState("ERROR");
    };
    return () => {
      mounted.current = false;
      clearTimeout(silence.current); clearTimeout(restart.current);
      recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
      recognition.abort(); recognitionRef.current = null;
      callbacks.current.onListeningChange?.(false);
    };
  }, [toast, allowed, commit, clearPending]);

  // Recognition is suspended during playback to prevent the AI's own voice becoming an answer.
  useEffect(() => {
    clearTimeout(restart.current);
    if (!allowed()) {
      clearPending(); recognitionRef.current?.abort();
      setIsListening(false); callbacks.current.onListeningChange?.(false);
      setVoiceState(aiSpeaking ? "AI_SPEAKING" : isLoading ? "THINKING" : "IDLE");
    } else if (!recognitionActive.current) {
      restart.current = setTimeout(() => {
        if (allowed()) { try { recognitionRef.current?.start(); } catch { /* wait for onend */ } }
      }, 200);
    }
    return () => clearTimeout(restart.current);
  }, [aiSpeaking, isLoading, autoListen, isContinuousMode, allowed, clearPending]);

  const startContinuousListening = useCallback(() => setIsContinuousMode(true), []);
  const stopContinuousListening = useCallback(() => setIsContinuousMode(false), []);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isLoading && !submitting.current) {
      callbacks.current.onBargeIn?.();
      void commit(inputValue); setInputValue("");
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      data-voice-state={voiceState}
      className={cn(
        "flex flex-col h-full min-h-0 bg-card/60 backdrop-blur-xl rounded-xl border border-border/60 overflow-hidden shadow-sm",
        className
      )}
    >
      {/* Messages Scroll Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2" ref={scrollRef}>
        <div className="space-y-3 pb-2">
          {messages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-8 w-8 mx-auto mb-2 text-primary opacity-60" />
              <p className="text-xs font-medium">Interview starting...</p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                The AI interviewer is preparing your first question.
              </p>
              {!isContinuousMode && isSupported && (
                <Button
                  onClick={startContinuousListening}
                  variant="outline"
                  size="sm"
                  className="mt-3 text-xs gap-1.5 border-primary/30 text-primary"
                >
                  <Phone className="h-3.5 w-3.5" />
                  Enable Microphone
                </Button>
              )}
            </div>
          )}

          {messages.map((message) => {
            const isAI = message.role === "assistant";
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex gap-2.5", !isAI && "flex-row-reverse")}
              >
                <div
                  className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs",
                    isAI ? "bg-primary/10 text-primary border border-primary/20" : "bg-secondary text-secondary-foreground"
                  )}
                >
                  {isAI ? <Brain className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                </div>

                <div className={cn("max-w-[85%] space-y-1", !isAI && "text-right")}>
                  <div
                    className={cn(
                      "inline-block rounded-xl px-3 py-2 text-sm leading-relaxed text-left",
                      isAI
                        ? "bg-secondary/70 border border-border/50 text-foreground"
                        : "bg-primary text-primary-foreground font-medium shadow-sm"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                  <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                    <span>{formatTime(new Date(message.timestamp))}</span>
                  </div>
                </div>
              </motion.div>
            );
          })}

          {/* Thinking indicator */}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2.5"
            >
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                <Brain className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-secondary/70 rounded-xl px-3 py-2 border border-border/50">
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Thinking...</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Live Interim Transcript Bubble */}
          {interimTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2.5 flex-row-reverse"
            >
              <div className="h-7 w-7 rounded-full bg-success/15 flex items-center justify-center shrink-0 text-success border border-success/30">
                <User className="h-3.5 w-3.5" />
              </div>
              <div className="text-right max-w-[85%]">
                <div className="inline-block rounded-xl px-3 py-2 text-sm bg-success/10 text-foreground border border-success/30 shadow-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="italic">"{interimTranscript}"</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shrink-0" />
                  </div>
                </div>
                <p className="text-[10px] text-success font-medium mt-0.5 mr-1">Listening...</p>
              </div>
            </motion.div>
          )}

          {/* Internal scroll anchor - keeps main window fixed */}
          <div ref={messagesEndRef} className="h-0 w-full shrink-0" aria-hidden="true" />
        </div>
      </div>

      {aiSpeaking && <Button variant="outline" size="sm" className="shrink-0 mx-2 my-1" onClick={() => {
        setVoiceState("INTERRUPTED"); callbacks.current.onBargeIn?.(); setIsContinuousMode(true);
      }}>Interrupt &amp; answer</Button>}
      {/* Compact Bottom Toolbar & Input Bar */}
      <div className="shrink-0 p-2 sm:p-2.5 border-t border-border/60 bg-card/70">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          {/* Microphone continuous mode toggle */}
          <Button
            type="button"
            size="sm"
            variant={isContinuousMode ? "default" : "outline"}
            className={cn(
              "h-8 px-2.5 shrink-0 gap-1 text-xs font-medium",
              isContinuousMode && "bg-success hover:bg-success/90 text-success-foreground"
            )}
            onClick={isContinuousMode ? stopContinuousListening : startContinuousListening}
            disabled={!isSupported}
            title={isContinuousMode ? "Voice mode active — click to pause" : "Click to enable continuous voice mode"}
          >
            {isContinuousMode ? (
              <>
                <Mic className="h-3.5 w-3.5 animate-pulse" />
                <span className="hidden sm:inline">Voice On</span>
              </>
            ) : (
              <>
                <MicOff className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Voice Off</span>
              </>
            )}
          </Button>

          {/* Text input fallback */}
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isContinuousMode ? "Speak or type your answer..." : "Type your answer..."}
            className="flex-1 h-8 text-sm bg-background/80"
            disabled={isLoading}
          />

          <Button
            type="submit"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={!inputValue.trim() || isLoading}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>

        {/* State Indicator Footnote */}
        <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full inline-block",
                isListening ? "bg-success animate-pulse" : "bg-muted-foreground/40"
              )}
            />
            {{ IDLE: "Voice idle", LISTENING: "Listening...", PROCESSING_SPEECH: "Understanding...", THINKING: "Thinking...", AI_SPEAKING: "Speaking — use Interrupt to answer", INTERRUPTED: "Speech interrupted", ERROR: "Voice unavailable — check permissions" }[voiceState]}
          </span>
          <span className="text-[10px] opacity-75">Auto-submits on speech pause</span>
        </div>
      </div>
    </div>
  );
}
