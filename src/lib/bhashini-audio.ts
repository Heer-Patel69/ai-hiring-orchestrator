/**
 * Low-latency audio helpers for the Bhashini voice pipeline.
 * - Captures mic PCM at 16 kHz mono and encodes WAV (Bhashini ASR input format)
 * - Simple energy-based voice activity detection for hands-free turn taking
 * - Sequential playback queue for streamed TTS chunks
 */

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  const targetRate = 16000;
  if (inputRate === targetRate) return input;
  const ratio = inputRate / targetRate;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    output[i] = count > 0 ? sum / count : 0;
  }
  return output;
}

/** Splits streamed text into speakable chunks as soon as a sentence completes. */
export function extractSpeakableChunk(buffer: string, minLength = 40): { chunk: string; rest: string } | null {
  const match = buffer.match(/^([\s\S]*?[.!?。？！]|[\s\S]{120,}?,)\s/);
  if (!match) return null;
  const chunk = match[1].trim();
  if (chunk.length < minLength && buffer.length < 160) return null;
  return { chunk, rest: buffer.slice(match[0].length) };
}

/** Strips markdown so the TTS engine doesn't read symbols aloud. */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class AudioQueue {
  private queue: string[] = [];
  private playing = false;
  private current: HTMLAudioElement | null = null;
  private onStateChange?: (speaking: boolean) => void;
  public volume = 1;

  constructor(onStateChange?: (speaking: boolean) => void) {
    this.onStateChange = onStateChange;
  }

  enqueue(base64Audio: string) {
    if (!base64Audio) return;
    this.queue.push(base64Audio);
    if (!this.playing) void this.playNext();
  }

  private async playNext() {
    const next = this.queue.shift();
    if (!next) {
      this.playing = false;
      this.onStateChange?.(false);
      return;
    }
    this.playing = true;
    this.onStateChange?.(true);
    try {
      const audio = new Audio(`data:audio/wav;base64,${next}`);
      audio.volume = this.volume;
      this.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
    } finally {
      this.current = null;
      void this.playNext();
    }
  }

  stop() {
    this.queue = [];
    if (this.current) {
      this.current.pause();
      this.current = null;
    }
    this.playing = false;
    this.onStateChange?.(false);
  }

  get isSpeaking() {
    return this.playing;
  }
}
