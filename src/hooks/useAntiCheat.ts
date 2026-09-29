import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export interface AntiCheatEvent {
  type: 
    | "tab_switch" 
    | "window_blur" 
    | "fullscreen_exit" 
    | "devtools_open" 
    | "copy_attempt" 
    | "paste_attempt"
    | "right_click"
    | "screenshot_attempt"
    | "camera_blocked"
    | "multiple_monitors";
  timestamp: Date;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface AntiCheatConfig {
  enforceFullscreen?: boolean;
  maxTabSwitches?: number;
  maxFocusLoss?: number;
  blockCopyPaste?: boolean;
  blockRightClick?: boolean;
  blockDevTools?: boolean;
  blockScreenshot?: boolean;
  autoTerminateOnViolation?: boolean;
  onTerminate?: () => void;
  onEvent?: (event: AntiCheatEvent) => void;
}

export interface AntiCheatState {
  isActive: boolean;
  isFullscreen: boolean;
  tabSwitchCount: number;
  focusLossCount: number;
  trustScore: number;
  events: AntiCheatEvent[];
  violations: number;
  shouldTerminate: boolean;
}

const DEFAULT_CONFIG: Required<AntiCheatConfig> = {
  enforceFullscreen: true,
  maxTabSwitches: 3,
  maxFocusLoss: 5,
  blockCopyPaste: true,
  blockRightClick: true,
  blockDevTools: true,
  blockScreenshot: true,
  autoTerminateOnViolation: false,
  onTerminate: () => {},
  onEvent: () => {},
};

export function useAntiCheat(config: AntiCheatConfig = {}) {
  const { toast } = useToast();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  const [state, setState] = useState<AntiCheatState>({
    isActive: false,
    isFullscreen: false,
    tabSwitchCount: 0,
    focusLossCount: 0,
    trustScore: 100,
    events: [],
    violations: 0,
    shouldTerminate: false,
  });

  const stateRef = useRef(state);
  const fullscreenWarningShownRef = useRef(false);
  const devToolsCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Keep ref in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const configRef = useRef(mergedConfig); configRef.current = mergedConfig;

  // Add event helper
  const addEvent = useCallback((event: AntiCheatEvent) => {
    setState((prev) => {
      const severityPenalty = {
        low: 2,
        medium: 5,
        high: 10,
        critical: 20,
      };
      
      const newTrustScore = Math.max(0, prev.trustScore - severityPenalty[event.severity]);
      const newViolations = prev.violations + 1;
      
      return {
        ...prev,
        events: [...prev.events, event],
        trustScore: newTrustScore,
        violations: newViolations,
      };
    });
    
    configRef.current.onEvent?.(event);
  }, []);

  // Request fullscreen
  const requestFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setState((prev) => ({ ...prev, isFullscreen: true }));
        return true;
      }
      return true;
    } catch (error) {
      console.error("Failed to enter fullscreen:", error);
      toast({
        title: "Fullscreen Required",
        description: "Please allow fullscreen mode to continue the assessment.",
        variant: "destructive",
      });
      return false;
    }
  }, [toast]);

  // Exit fullscreen
  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      setState((prev) => ({ ...prev, isFullscreen: false }));
    } catch (error) {
      console.error("Failed to exit fullscreen:", error);
    }
  }, []);

  // Start anti-cheat monitoring
  const startMonitoring = useCallback(async () => {
    // Request fullscreen if configured
    if (mergedConfig.enforceFullscreen) {
      const success = await requestFullscreen();
      if (!success) {
        toast({
          title: "⚠️ Fullscreen Required",
          description: "The assessment requires fullscreen mode. Please enable it to continue.",
          variant: "destructive",
        });
      }
    }

    setState((prev) => ({ ...prev, isActive: true }));

    toast({
      title: "🔒 Proctoring Active",
      description: "Assessment monitoring has started. Stay focused on this window.",
    });
  }, [mergedConfig.enforceFullscreen, requestFullscreen, toast]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    setState((prev) => ({ ...prev, isActive: false }));
    exitFullscreen();
    
    if (devToolsCheckIntervalRef.current) {
      clearInterval(devToolsCheckIntervalRef.current);
    }
  }, [exitFullscreen]);

  // Tab visibility handler
  useEffect(() => {
    if (!state.isActive) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        const newCount = stateRef.current.tabSwitchCount + 1;
        
        setState((prev) => ({ ...prev, tabSwitchCount: newCount }));
        
        const event: AntiCheatEvent = {
          type: "tab_switch",
          timestamp: new Date(),
          severity: newCount >= mergedConfig.maxTabSwitches ? "critical" : newCount >= 2 ? "high" : "medium",
          description: `Tab switched away (${newCount}/${mergedConfig.maxTabSwitches} allowed)`,
        };
        
        addEvent(event);

        if (newCount >= mergedConfig.maxTabSwitches) {
          toast({
            title: "🚨 Maximum Tab Switches Reached",
            description: "Your session may be terminated for suspicious activity.",
            variant: "destructive",
          });
          
          if (mergedConfig.autoTerminateOnViolation) {
            setState((prev) => ({ ...prev, shouldTerminate: true }));
            mergedConfig.onTerminate?.();
          }
        } else {
          toast({
            title: `⚠️ Tab Switch Detected (${newCount}/${mergedConfig.maxTabSwitches})`,
            description: "Please stay on this tab. Further switches will affect your score.",
            variant: "destructive",
          });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [state.isActive, mergedConfig.maxTabSwitches, mergedConfig.autoTerminateOnViolation, addEvent, toast]);

  // Window focus handler (detects Alt+Tab to other apps)
  useEffect(() => {
    if (!state.isActive) return;

    const handleBlur = () => {
      const newCount = stateRef.current.focusLossCount + 1;
      
      setState((prev) => ({ ...prev, focusLossCount: newCount }));
      
      const event: AntiCheatEvent = {
        type: "window_blur",
        timestamp: new Date(),
        severity: newCount >= mergedConfig.maxFocusLoss ? "high" : "medium",
        description: `Window lost focus - possible external application use (${newCount} times)`,
      };
      
      addEvent(event);

      if (newCount >= mergedConfig.maxFocusLoss) {
        toast({
          title: "🚨 Multiple Focus Loss Detected",
          description: "Using external applications during assessment is not allowed.",
          variant: "destructive",
        });
      } else if (newCount >= 2) {
        toast({
          title: "⚠️ Window Focus Lost",
          description: "Please stay focused on the assessment. External apps are not allowed.",
          variant: "destructive",
        });
      }
    };

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [state.isActive, mergedConfig.maxFocusLoss, addEvent, toast]);

  // Fullscreen change handler
  useEffect(() => {
    if (!state.isActive || !mergedConfig.enforceFullscreen) return;

    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setState((prev) => ({ ...prev, isFullscreen: isNowFullscreen }));

      if (!isNowFullscreen && stateRef.current.isActive) {
        const event: AntiCheatEvent = {
          type: "fullscreen_exit",
          timestamp: new Date(),
          severity: "high",
          description: "Exited fullscreen mode during assessment",
        };
        
        addEvent(event);

        // Show persistent warning and try to re-enter fullscreen
        if (!fullscreenWarningShownRef.current) {
          fullscreenWarningShownRef.current = true;
          
          toast({
            title: "🚨 Fullscreen Required",
            description: "Please return to fullscreen mode to continue. Click anywhere to restore.",
            variant: "destructive",
          });

          // Try to re-enter fullscreen after a short delay
          setTimeout(() => {
            if (stateRef.current.isActive && !document.fullscreenElement) {
              requestFullscreen();
              fullscreenWarningShownRef.current = false;
            }
          }, 1000);
        }
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [state.isActive, mergedConfig.enforceFullscreen, addEvent, requestFullscreen, toast]);

  // Copy/Paste blocking
  useEffect(() => {
    if (!state.isActive || !mergedConfig.blockCopyPaste) return;

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      
      const event: AntiCheatEvent = {
        type: "copy_attempt",
        timestamp: new Date(),
        severity: "medium",
        description: "Attempted to copy content",
      };
      
      addEvent(event);
      
      toast({
        title: "Copy Blocked",
        description: "Copying is not allowed during the assessment.",
        variant: "destructive",
      });
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      
      const event: AntiCheatEvent = {
        type: "paste_attempt",
        timestamp: new Date(),
        severity: "high",
        description: "Attempted to paste content",
      };
      
      addEvent(event);
      
      toast({
        title: "Paste Blocked",
        description: "Pasting external content is not allowed.",
        variant: "destructive",
      });
    };

    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    
    return () => {
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
    };
  }, [state.isActive, mergedConfig.blockCopyPaste, addEvent, toast]);

  // Right-click blocking
  useEffect(() => {
    if (!state.isActive || !mergedConfig.blockRightClick) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      
      const event: AntiCheatEvent = {
        type: "right_click",
        timestamp: new Date(),
        severity: "low",
        description: "Right-click context menu blocked",
      };
      
      addEvent(event);
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [state.isActive, mergedConfig.blockRightClick, addEvent]);

  // DevTools and screenshot blocking
  useEffect(() => {
    if (!state.isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block DevTools shortcuts
      if (mergedConfig.blockDevTools) {
        // F12
        if (e.key === "F12") {
          e.preventDefault();
          const event: AntiCheatEvent = {
            type: "devtools_open",
            timestamp: new Date(),
            severity: "critical",
            description: "DevTools shortcut (F12) blocked",
          };
          addEvent(event);
          toast({
            title: "🚨 Developer Tools Blocked",
            description: "Opening developer tools is not allowed during assessment.",
            variant: "destructive",
          });
          return;
        }

        // Ctrl+Shift+I/J/C (DevTools)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "J", "C"].includes(e.key.toUpperCase())) {
          e.preventDefault();
          const event: AntiCheatEvent = {
            type: "devtools_open",
            timestamp: new Date(),
            severity: "critical",
            description: `DevTools shortcut (Ctrl+Shift+${e.key.toUpperCase()}) blocked`,
          };
          addEvent(event);
          toast({
            title: "🚨 Developer Tools Blocked",
            description: "Opening developer tools is not allowed.",
            variant: "destructive",
          });
          return;
        }
      }

      // Block screenshot
      if (mergedConfig.blockScreenshot && e.key === "PrintScreen") {
        e.preventDefault();
        const event: AntiCheatEvent = {
          type: "screenshot_attempt",
          timestamp: new Date(),
          severity: "high",
          description: "Screenshot attempt blocked",
        };
        addEvent(event);
        toast({
          title: "Screenshot Blocked",
          description: "Taking screenshots is not allowed during the assessment.",
          variant: "destructive",
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [state.isActive, mergedConfig.blockDevTools, mergedConfig.blockScreenshot, addEvent, toast]);

  // DevTools detection via timing
  useEffect(() => {
    if (!state.isActive || !mergedConfig.blockDevTools) return;

    const checkDevTools = () => {
      const threshold = 160;
      const start = performance.now();
      
      // This check exploits the fact that console operations are slower when DevTools is open
      // eslint-disable-next-line no-debugger
      const check = () => {
        const end = performance.now();
        if (end - start > threshold) {
          const event: AntiCheatEvent = {
            type: "devtools_open",
            timestamp: new Date(),
            severity: "critical",
            description: "Developer tools detected as open",
          };
          addEvent(event);
          toast({
            title: "🚨 Developer Tools Detected",
            description: "Please close developer tools to continue.",
            variant: "destructive",
          });
        }
      };
      
      // Use a method that triggers only when DevTools is open
      const img = new Image();
      Object.defineProperty(img, "id", {
        get: function () {
          check();
        },
      });
      console.log("%c", img as any);
    };

    devToolsCheckIntervalRef.current = setInterval(checkDevTools, 3000);
    
    return () => {
      if (devToolsCheckIntervalRef.current) {
        clearInterval(devToolsCheckIntervalRef.current);
      }
    };
  }, [state.isActive, mergedConfig.blockDevTools, addEvent, toast]);

  // Click handler to re-enter fullscreen
  useEffect(() => {
    if (!state.isActive || !mergedConfig.enforceFullscreen) return;

    const handleClick = () => {
      if (!document.fullscreenElement && stateRef.current.isActive) {
        requestFullscreen();
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [state.isActive, mergedConfig.enforceFullscreen, requestFullscreen]);

  return {
    ...state,
    startMonitoring,
    stopMonitoring,
    requestFullscreen,
    exitFullscreen,
    addEvent,
  };
}
