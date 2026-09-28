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
import { useToast } from "@/hooks/use-toast";

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
  onSendMessage: (message: string) => void;
  className?: string;
  autoListen?: boolean;
  aiSpeaking?: boolean;
  onCandidateSpeech?: (text: string) => void;
}

export function ContinuousVoicePanel({
  messages,
  isLoading,
  onSendMessage,
  className,
  autoListen = true,
  aiSpeaking = false,
  onCandidateSpeech,
}: ContinuousVoicePanelProps) {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isContinuousMode, setIsContinuousMode] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSpeakingEnabled, setIsSpeakingEnabled] = useState(true);
  const [isSupported, setIsSupported] = useState(true);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscriptRef = useRef("");
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRestartingRef = useRef(false);
  const isContinuousModeRef = useRef(false);
  const aiSpeakingRef = useRef(false);
  const isLoadingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isContinuousModeRef.current = isContinuousMode;
  }, [isContinuousMode]);

  useEffect(() => {
    aiSpeakingRef.current = aiSpeaking;
  }, [aiSpeaking]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const onSendMessageRef = useRef(onSendMessage);
  useEffect(() => {
    onSendMessageRef.current = onSendMessage;
  }, [onSendMessage]);

  const onCandidateSpeechRef = useRef(onCandidateSpeech);
  useEffect(() => {
    onCandidateSpeechRef.current = onCandidateSpeech;
  }, [onCandidateSpeech]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, interimTranscript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  // Initialize speech recognition ONCE
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
        onCandidateSpeechRef.current?.(interim);
        // Reset silence timeout on speech
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        // If candidate stops speaking mid-sentence for 1.8s, submit interim speech as final
        silenceTimeoutRef.current = setTimeout(() => {
          if (interim.trim() && !isLoadingRef.current) {
            const spokenText = interim.trim();
            setInterimTranscript("");
            onSendMessageRef.current(spokenText);
          }
        }, 1800);
      }

      if (final && final.trim()) {
        lastTranscriptRef.current = final.trim();
        setInterimTranscript("");
        onCandidateSpeechRef.current?.(final.trim());
        
        // Wait for short silence before sending response
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        
        silenceTimeoutRef.current = setTimeout(() => {
          if (lastTranscriptRef.current && !isLoadingRef.current) {
            const speechToSend = lastTranscriptRef.current;
            lastTranscriptRef.current = "";
            setInterimTranscript("");
            onSendMessageRef.current(speechToSend);
          }
        }, 1100); // 1.1s silence = commit spoken answer
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      
      if (event.error === "not-allowed") {
        toast({
          title: "Microphone Blocked",
          description: "Please allow microphone access in your browser settings.",
          variant: "destructive",
        });
        setIsListening(false);
        setIsContinuousMode(false);
        isContinuousModeRef.current = false;
        return;
      }
      
      // For no-speech or aborted, don't show error - just restart if in continuous mode
      if (event.error === "no-speech" || event.error === "aborted") {
        // Will be handled by onend
        return;
      }
      
      // For other errors, attempt restart with debounce
      if (isContinuousModeRef.current && !aiSpeakingRef.current && !isRestartingRef.current) {
        scheduleRestart();
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      
      // Auto-restart if still in continuous mode and AI is not speaking
      if (isContinuousModeRef.current && !aiSpeakingRef.current && !isRestartingRef.current) {
        scheduleRestart();
      }
    };

    recognitionRef.current = recognition;
  }, [toast]); // Only depend on toast which is stable

  // Debounced restart to prevent rapid reconnection cycles
  const scheduleRestart = useCallback(() => {
    if (isRestartingRef.current || !isContinuousModeRef.current) return;
    
    isRestartingRef.current = true;
    
    // Clear any existing restart timeout
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
    }
    
    // Wait a moment before restarting to avoid rapid cycles
    restartTimeoutRef.current = setTimeout(() => {
      isRestartingRef.current = false;
      
      if (isContinuousModeRef.current && !aiSpeakingRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
          setIsListening(true);
        } catch (e: any) {
          // If already started, ignore
          if (!e.message?.includes("already started")) {
            console.error("Failed to restart recognition:", e);
          }
        }
      }
    }, 300); // 300ms debounce
  }, []);

  // Handle AI speaking state changes
  useEffect(() => {
    if (!recognitionRef.current || !isContinuousMode) return;
    
    if (aiSpeaking) {
      // Stop listening while AI speaks
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      setIsListening(false);
    } else {
      // Resume listening when AI stops speaking
      scheduleRestart();
    }
  }, [aiSpeaking, isContinuousMode, scheduleRestart]);

  const startContinuousListening = useCallback(async () => {
    if (!recognitionRef.current || !isSupported) return;

    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      setIsContinuousMode(true);
      isContinuousModeRef.current = true;
      
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e: any) {
        if (!e.message?.includes("already started")) {
          throw e;
        }
        setIsListening(true);
      }
      
      toast({
        title: "Voice Mode Active",
        description: "Speak naturally — I'll listen continuously and respond.",
      });
    } catch (error) {
      console.error("Failed to start listening:", error);
      toast({
        title: "Microphone Error",
        description: "Could not access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  }, [isSupported, toast]);

  const stopContinuousListening = useCallback(() => {
    setIsContinuousMode(false);
    isContinuousModeRef.current = false;
    
    // Clear any pending restarts
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    isRestartingRef.current = false;
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
    }
    
    setIsListening(false);
    setInterimTranscript("");
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
  }, []);

  // Auto-start continuous listening when autoListen is enabled
  useEffect(() => {
    if (autoListen && isSupported && !isContinuousMode) {
      const timer = setTimeout(() => {
        startContinuousListening();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [autoListen, isSupported, isContinuousMode, startContinuousListening]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (inputValue.trim() && !isLoading) {
        onSendMessage(inputValue.trim());
        setInputValue("");
      }
    },
    [inputValue, isLoading, onSendMessage]
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className={cn("flex flex-col h-full rounded-xl border border-border bg-card", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={cn(
            "h-8 w-8 rounded-full flex items-center justify-center transition-colors",
            isContinuousMode ? "bg-success/10" : "bg-primary/10"
          )}>
            <Brain className={cn(
              "h-4 w-4",
              isContinuousMode ? "text-success" : "text-primary"
            )} />
          </div>
          <div>
            <h3 className="font-semibold text-sm">AI Interviewer</h3>
            <div className="flex items-center gap-1">
              {isContinuousMode ? (
                <Badge variant="outline" className="text-xs gap-1 bg-success/10 text-success border-success/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  {aiSpeaking ? "Speaking" : isListening ? "Listening" : "Ready"}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {isLoading ? "Thinking..." : "Ready"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={isSpeakingEnabled ? "default" : "outline"}
            className="h-8"
            onClick={() => setIsSpeakingEnabled(!isSpeakingEnabled)}
          >
            {isSpeakingEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        <div className="space-y-4">
          {messages.length === 0 && !isContinuousMode && (
            <div className="text-center py-12">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Waves className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Continuous Voice Mode</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Start voice mode for a natural conversation. 
                Speak freely — no need to press buttons!
              </p>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={cn(
                  "flex gap-3",
                  message.role === "user" && "flex-row-reverse"
                )}
              >
                <div
                  className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                    message.role === "assistant"
                      ? "bg-primary/10"
                      : "bg-success/10"
                  )}
                >
                  {message.role === "assistant" ? (
                    <Brain className="h-4 w-4 text-primary" />
                  ) : (
                    <User className="h-4 w-4 text-success" />
                  )}
                </div>

                <div
                  className={cn(
                    "flex-1 space-y-1",
                    message.role === "user" && "text-right"
                  )}
                >
                  <div
                    className={cn(
                      "inline-block rounded-xl px-4 py-2.5 text-sm max-w-[85%]",
                      message.role === "assistant"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-primary text-primary-foreground"
                    )}
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    {message.isStreaming && (
                      <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground px-1">
                    {formatTime(message.timestamp)}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Loading indicator */}
          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <div className="bg-secondary rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Interim transcript */}
          {interimTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3 flex-row-reverse"
            >
              <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
                <User className="h-4 w-4 text-success" />
              </div>
              <div className="text-right">
                <div className="inline-block rounded-xl px-4 py-2.5 text-sm max-w-[85%] bg-primary/20 text-primary border border-primary/30">
                  <div className="flex items-center gap-2">
                    <span className="italic">{interimTranscript}</span>
                    <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Listening indicator */}
          {isContinuousMode && isListening && !aiSpeaking && !interimTranscript && !isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-center py-4"
            >
              <Badge variant="outline" className="gap-2 bg-success/5 border-success/20">
                <Mic className="h-3 w-3 text-success" />
                <span className="text-success">Listening...</span>
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              </Badge>
            </motion.div>
          )}

          {/* AI Speaking indicator */}
          {aiSpeaking && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-center py-4"
            >
              <Badge variant="outline" className="gap-2 bg-primary/5 border-primary/20">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ height: [4, 12, 4] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: i * 0.1,
                      }}
                      className="w-0.5 bg-primary rounded-full"
                    />
                  ))}
                </div>
                <span className="text-primary">AI Speaking...</span>
              </Badge>
            </motion.div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 border-t border-border">
        {/* Voice control */}
        <div className="flex items-center justify-center gap-4 mb-3">
          {!isContinuousMode ? (
            <Button
              onClick={startContinuousListening}
              disabled={!isSupported}
              className="gap-2 bg-success hover:bg-success/90"
              size="lg"
            >
              <Phone className="h-5 w-5" />
              Start Voice Mode
            </Button>
          ) : (
            <Button
              onClick={stopContinuousListening}
              variant="destructive"
              className="gap-2"
              size="lg"
            >
              <PhoneOff className="h-5 w-5" />
              End Voice Mode
            </Button>
          )}
        </div>

        {/* Text input fallback */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant={isListening ? "default" : "outline"}
            className="shrink-0"
            onClick={isContinuousMode ? stopContinuousListening : startContinuousListening}
            disabled={!isSupported}
          >
            {isListening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>

          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isContinuousMode ? "Or type your response..." : "Type your answer..."}
            className="flex-1"
            disabled={isLoading}
          />

          <Button
            type="submit"
            size="icon"
            disabled={!inputValue.trim() || isLoading}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-2">
          <Sparkles className="h-3 w-3 inline mr-1" />
          {isContinuousMode 
            ? "Speak naturally — AI listens continuously"
            : "Enable voice mode for hands-free conversation"
          }
        </p>
      </div>
    </div>
  );
}
