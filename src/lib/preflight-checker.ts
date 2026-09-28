/**
 * Interview Preflight & Proctoring Validation Engine
 * 
 * Verifies:
 * 1. Microphone input level
 * 2. Camera feed active & luminance threshold (blocks black/too-dark cameras)
 * 3. Mandatory entire-screen sharing (blocks window/tab shares)
 */

export interface CameraLuminanceResult {
  isDark: boolean;
  averageLuminance: number;
  message?: string;
}

/**
 * Samples video frame luminance onto an offscreen canvas.
 * Luminance formula: Y = 0.299*R + 0.587*G + 0.114*B
 * Minimum acceptable average luminance: 15 (out of 255)
 */
export function checkFrameLuminance(videoElement: HTMLVideoElement): CameraLuminanceResult {
  if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    return { isDark: true, averageLuminance: 0, message: "Camera feed inactive or no frames" };
  }

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { isDark: false, averageLuminance: 128 };
  }

  try {
    ctx.drawImage(videoElement, 0, 0, 64, 48);
    const imageData = ctx.getImageData(0, 0, 64, 48);
    const data = imageData.data;
    let totalLuminance = 0;
    const pixelCount = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
    }

    const averageLuminance = Math.round(totalLuminance / pixelCount);

    // If average luminance is below 15, the feed is almost pitch black
    if (averageLuminance < 15) {
      return {
        isDark: true,
        averageLuminance,
        message: "Your camera image is too dark. Please turn on a light or adjust your camera before continuing.",
      };
    }

    return {
      isDark: false,
      averageLuminance,
    };
  } catch (err) {
    console.warn("Could not analyze frame luminance:", err);
    return { isDark: false, averageLuminance: 100 };
  }
}

export type DisplaySurfaceType = "monitor" | "window" | "browser" | "unknown";

export interface ScreenShareVerification {
  isValid: boolean;
  surface: DisplaySurfaceType;
  message?: string;
}

/**
 * Verifies that the display media track represents an entire monitor.
 * Strictly rejects individual application windows (e.g., Antigravity, IDEs, browsers)
 * or browser tabs.
 */
export function verifyEntireScreenShare(stream: MediaStream): ScreenShareVerification {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    return {
      isValid: false,
      surface: "unknown",
      message: "No video track found for screen share.",
    };
  }

  const settings = videoTrack.getSettings() as any;
  const label = (videoTrack.label || "").toLowerCase();
  const displaySurface: string = (settings.displaySurface || "").toLowerCase();

  // 1. Explicit detection from track settings displaySurface
  if (displaySurface === "browser") {
    return {
      isValid: false,
      surface: "browser",
      message: "Incorrect sharing mode. You selected a browser tab. Please select ENTIRE SCREEN.",
    };
  }

  if (displaySurface === "window") {
    return {
      isValid: false,
      surface: "window",
      message: "Incorrect sharing mode. You selected an individual application window. You must share your ENTIRE SCREEN.",
    };
  }

  // 2. Explicit detection from Chromium track label
  // Chromium formats labels as:
  // "screen:0:0" / "screen:1:0" / "Screen 1" / "Entire screen" -> Entire screen (monitor)
  // "window:12345:0" / "window:..." / application title -> Individual window
  // "web-contents-media-stream:..." -> Browser tab
  if (label.includes("window:") || label.startsWith("window")) {
    return {
      isValid: false,
      surface: "window",
      message: "Incorrect sharing mode. You selected an individual application window. You must share your ENTIRE SCREEN.",
    };
  }

  if (label.includes("web-contents") || label.includes("tab:") || label.startsWith("tab")) {
    return {
      isValid: false,
      surface: "browser",
      message: "Incorrect sharing mode. You selected a browser tab. Please select ENTIRE SCREEN.",
    };
  }

  // If displaySurface is "monitor" or label explicitly indicates screen
  if (displaySurface === "monitor" || label.startsWith("screen") || label.includes("screen:") || label.includes("entire screen")) {
    return {
      isValid: true,
      surface: "monitor",
    };
  }

  // 3. If displaySurface is reported and is NOT monitor, reject it
  if (displaySurface && displaySurface !== "monitor") {
    return {
      isValid: false,
      surface: (displaySurface as DisplaySurfaceType) || "unknown",
      message: `Sharing surface '${displaySurface}' is not permitted. Please select ENTIRE SCREEN.`,
    };
  }

  // 4. Strict resolution verification for legacy browsers that omit displaySurface
  // Note: An individual maximized window does NOT match the full native screen dimensions
  // because of the Windows/OS taskbar, window border, and chrome.
  const trackWidth = settings.width || 0;
  const trackHeight = settings.height || 0;
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const dpr = window.devicePixelRatio || 1;
  const expectedWidth = Math.round(screenWidth * dpr);
  const expectedHeight = Math.round(screenHeight * dpr);

  const matchesExactMonitor = 
    (trackWidth === screenWidth && trackHeight === screenHeight) ||
    (trackWidth === expectedWidth && trackHeight === expectedHeight);

  if (matchesExactMonitor) {
    return {
      isValid: true,
      surface: "monitor",
    };
  }

  // Reject anything that cannot be proven to be the entire screen
  return {
    isValid: false,
    surface: "unknown",
    message: "Could not verify that the entire screen is being shared. Please choose 'Entire Screen' when prompted.",
  };
}
