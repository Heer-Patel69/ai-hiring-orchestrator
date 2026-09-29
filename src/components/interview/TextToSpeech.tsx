import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TextToSpeechProps {
  text: string;
  autoPlay?: boolean;
  onSpeakingChange?: (isSpeaking: boolean) => void;
  className?: string;
}

export function TextToSpeech({
  text,
  autoPlay = false,
  onSpeakingChange,
  className,
}: TextToSpeechProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const prevTextRef = useRef<string>("");

  const speak = useCallback((textToSpeak: string) => {
    if (!textToSpeak || !window.speechSynthesis) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to find a good English voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (v) => v.lang.startsWith("en-") && (v.name.includes("Google") || v.name.includes("Microsoft"))
    ) || voices.find((v) => v.lang.startsWith("en-"));
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsLoading(false);
      onSpeakingChange?.(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      onSpeakingChange?.(false);
    };

    utterance.onerror = (event) => {
      console.error("Speech error:", event);
      setIsSpeaking(false);
      setIsLoading(false);
      onSpeakingChange?.(false);
    };

    utteranceRef.current = utterance;
    setIsLoading(true);
    window.speechSynthesis.speak(utterance);
  }, [onSpeakingChange]);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    onSpeakingChange?.(false);
  }, [onSpeakingChange]);

  const toggleSpeech = useCallback(() => {
    if (isSpeaking) {
      stop();
    } else {
      speak(text);
    }
  }, [isSpeaking, stop, speak, text]);

  // Auto-play when text changes and autoPlay is enabled
  useEffect(() => {
    if (autoPlay && text && text !== prevTextRef.current) {
      prevTextRef.current = text;
      speak(text);
    }
  }, [text, autoPlay, speak]);

  // Load voices
  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis?.getVoices();
    };
    
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis?.cancel();
    };
  }, []);

  return (
    <Button
      type="button"
      size="sm"
      variant={isSpeaking ? "default" : "outline"}
      className={cn("gap-1.5", className)}
      onClick={toggleSpeech}
      disabled={!text || isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isSpeaking ? (
        <VolumeX className="h-4 w-4" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </Button>
  );
}

// Hook for TTS with word-by-word boundary support and robust audio playback
export interface UseTextToSpeechOptions {
  onWordBoundary?: (wordIndex: number, currentWord: string, totalWords: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export function useTextToSpeech(options?: UseTextToSpeechOptions) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [currentWord, setCurrentWord] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const callbacks = useRef(options); callbacks.current = options;
  const active = useRef<SpeechSynthesisUtterance | null>(null);
  const generation = useRef(0);
  const voiceId = useRef<string | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout>>();
  const waitingVoices = useRef<(() => void) | null>(null);
  const resolveVoices = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    generation.current++; clearTimeout(watchdog.current);
    if (waitingVoices.current) window.speechSynthesis?.removeEventListener("voiceschanged", waitingVoices.current);
    waitingVoices.current = null;
    resolveVoices.current?.(); resolveVoices.current = null;
    if (active.current) active.current.onstart = active.current.onend = active.current.onerror = active.current.onboundary = null;
    active.current = null; window.speechSynthesis?.cancel();
    setIsSpeaking(false); setCurrentWordIndex(-1); setCurrentWord("");
  }, []);
  const speak = useCallback(async (text: string, customOnWord?: (idx: number, word: string) => void) => {
    stop();
    if (!text || !window.speechSynthesis) { callbacks.current?.onEnd?.(); return; }
    const synth = window.speechSynthesis;
    const token = generation.current;
    if (!synth.getVoices().length) await new Promise<void>(resolve => {
      resolveVoices.current = resolve;
      const loaded = () => {
        if (!synth.getVoices().length) return;
        clearTimeout(watchdog.current); synth.removeEventListener("voiceschanged", loaded); waitingVoices.current = null; resolveVoices.current = null; resolve();
      };
      waitingVoices.current = loaded; synth.addEventListener("voiceschanged", loaded);
      watchdog.current = setTimeout(() => { synth.removeEventListener("voiceschanged", loaded); waitingVoices.current = null; resolve(); }, 5000);
    });
    if (token !== generation.current) return;
    const voices = synth.getVoices();
    const selected = voiceId.current ? voices.find(v => v.voiceURI === voiceId.current) :
      voices.find(v => v.lang.startsWith("en") && /Natural|Google|Microsoft/.test(v.name)) || voices.find(v => v.lang.startsWith("en"));
    if (!selected) {
      console.error("[TTS] The selected voice is unavailable. Load browser voices and retry speech.");
      callbacks.current?.onError?.("The selected interviewer voice is unavailable. Enable browser voices and retry speech.");
      callbacks.current?.onEnd?.(); return;
    }
    voiceId.current = selected.voiceURI;
    const tokens = text.trim().split(/\s+/); setWords(tokens);
    const utterance = new SpeechSynthesisUtterance(text);
    active.current = utterance; utterance.voice = selected; utterance.rate = 1; utterance.pitch = 1;
    const started = performance.now();
    const finish = () => {
      if (token !== generation.current) return;
      clearTimeout(watchdog.current); active.current = null; setIsSpeaking(false); setCurrentWordIndex(-1); callbacks.current?.onEnd?.();
    };
    // A failure to start is an error, never a pretend speaking state.
    watchdog.current = setTimeout(() => {
      if (token === generation.current) { console.error("[TTS] Playback did not start"); stop(); callbacks.current?.onError?.("Speech playback did not start. Enable browser audio and replay the question."); callbacks.current?.onEnd?.(); }
    }, 10000);
    utterance.onstart = () => {
      if (token !== generation.current) return;
      clearTimeout(watchdog.current); setIsSpeaking(true);
      watchdog.current = setTimeout(() => {
        if (token !== generation.current) return;
        stop(); callbacks.current?.onError?.("Speech playback stopped responding. Replay the question or continue with a typed answer."); callbacks.current?.onEnd?.();
      }, Math.max(30000, text.length * 100));
      if (import.meta.env.DEV) console.debug(`[TTS] Playback start ${Math.round(performance.now()-started)}ms`);
    };
    utterance.onboundary = event => {
      if (token !== generation.current || event.name !== "word") return;
      const index = Math.min(text.slice(0, event.charIndex).trim().split(/\s+/).filter(Boolean).length, tokens.length-1);
      setCurrentWordIndex(index); setCurrentWord(tokens[index]); customOnWord?.(index, tokens[index]); callbacks.current?.onWordBoundary?.(index, tokens[index], tokens.length);
    };
    utterance.onend = finish;
    utterance.onerror = event => { if (token === generation.current) { console.error("[TTS] Playback error", event.error); callbacks.current?.onError?.("The interviewer audio could not be played. Enable browser sound and replay the question."); finish(); } };
    if (synth.paused) synth.resume(); synth.speak(utterance);
  }, [stop]);
  useEffect(() => { window.speechSynthesis?.getVoices(); return stop; }, [stop]);
  return { speak, stop, isSpeaking, currentWordIndex, currentWord, words };
}
