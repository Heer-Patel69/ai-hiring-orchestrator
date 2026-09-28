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
}

export function useTextToSpeech(options?: UseTextToSpeechOptions) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [currentWord, setCurrentWord] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const wordsRef = useRef<string[]>([]);
  const onWordRef = useRef(options?.onWordBoundary);
  const onEndRef = useRef(options?.onEnd);

  useEffect(() => {
    onWordRef.current = options?.onWordBoundary;
    onEndRef.current = options?.onEnd;
  }, [options?.onWordBoundary, options?.onEnd]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const speak = useCallback((text: string, customOnWord?: (idx: number, word: string) => void) => {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) return;

    clearTimer();
    window.speechSynthesis.cancel();
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    const splitWords = text.trim().split(/\s+/).filter(Boolean);
    setWords(splitWords);
    wordsRef.current = splitWords;
    setCurrentWordIndex(0);
    setCurrentWord(splitWords[0] || "");
    if (splitWords.length > 0) {
      customOnWord?.(0, splitWords[0]);
      onWordRef.current?.(0, splitWords[0], splitWords.length);
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95; // Slightly measured for professional clarity
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(
      (v) => v.lang.startsWith("en-") && (v.name.includes("Google") || v.name.includes("Microsoft") || v.name.includes("Natural"))
    ) || voices.find((v) => v.lang.startsWith("en-"));
    
    if (voice) utterance.voice = voice;

    let boundaryFired = false;

    utterance.onstart = () => {
      setIsSpeaking(true);
      // Fallback timer: advances word-by-word at ~260ms cadence if browser doesn't emit onboundary
      let wordIdx = 0;
      timerRef.current = setInterval(() => {
        if (!boundaryFired && wordIdx < wordsRef.current.length - 1) {
          wordIdx++;
          setCurrentWordIndex(wordIdx);
          const w = wordsRef.current[wordIdx];
          setCurrentWord(w);
          customOnWord?.(wordIdx, w);
          onWordRef.current?.(wordIdx, w, wordsRef.current.length);
        }
      }, 260);
    };

    utterance.onboundary = (event) => {
      if (event.name === "word") {
        boundaryFired = true;
        clearTimer();
        // Calculate word index from charIndex
        const textBefore = text.slice(0, event.charIndex);
        const idx = textBefore.trim().split(/\s+/).filter(Boolean).length;
        const currentIdx = Math.min(idx, wordsRef.current.length - 1);
        setCurrentWordIndex(currentIdx);
        const w = wordsRef.current[currentIdx] || "";
        setCurrentWord(w);
        customOnWord?.(currentIdx, w);
        onWordRef.current?.(currentIdx, w, wordsRef.current.length);
      }
    };

    utterance.onend = () => {
      clearTimer();
      setIsSpeaking(false);
      setCurrentWordIndex(wordsRef.current.length);
      setCurrentWord("");
      onEndRef.current?.();
    };

    utterance.onerror = (err) => {
      console.warn("SpeechSynthesis error:", err);
      clearTimer();
      setIsSpeaking(false);
      setCurrentWordIndex(-1);
      setCurrentWord("");
      onEndRef.current?.();
    };

    // Chrome audio engine workaround: resume if speech engine is in suspended state
    setTimeout(() => {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 100);

    window.speechSynthesis.speak(utterance);
  }, [clearTimer]);

  const stop = useCallback(() => {
    clearTimer();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setCurrentWordIndex(-1);
    setCurrentWord("");
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [clearTimer]);

  return { speak, stop, isSpeaking, currentWordIndex, currentWord, words };
}
