import { act, cleanup, render, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContinuousVoicePanel } from "./ContinuousVoicePanel";

vi.mock("framer-motion", () => ({ motion: { div: ({ children, ...props }: any) => <div>{children}</div> }, AnimatePresence: ({ children }: any) => children }));
class Recognition {
  static current: Recognition;
  onstart: (() => void) | null = null; onend: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null; onerror: ((event: any) => void) | null = null;
  start = vi.fn(() => this.onstart?.()); abort = vi.fn(() => this.onend?.());
  constructor() { Recognition.current = this; }
  result(text: string, isFinal: boolean, index = 0) {
    const entry: any = [{ transcript: text }]; entry.isFinal = isFinal;
    const results: any[] = []; results[index] = entry;
    // The real results array contains every previous index as well.
    for (let i=0;i<index;i++) { const prev: any = [{ transcript: "" }]; prev.isFinal=true; results[i]=prev; }
    this.onresult?.({ resultIndex:index, results });
  }
}
beforeEach(() => { vi.useFakeTimers(); (window as any).SpeechRecognition = Recognition; });
afterEach(() => { cleanup(); vi.useRealTimers(); delete (window as any).SpeechRecognition; });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

it("shows interim speech, sends finals once, and suppresses duplicate final events", async () => {
  const send = vi.fn(async (_text: string, _id?: string) => {});
  render(<ContinuousVoicePanel messages={[]} isLoading={false} onSendMessage={send} />);
  await advance(250);
  act(() => Recognition.current.result("Redis caching", false)); await advance(2000); expect(send).not.toHaveBeenCalled();
  act(() => { Recognition.current.result("Redis caching", true); Recognition.current.result("Redis caching", true); });
  await advance(1200); expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toBe("Redis caching"); expect(send.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
});
it("waits for a complete final result after an interim continuation", async () => {
  const send = vi.fn(); render(<ContinuousVoicePanel messages={[]} isLoading={false} onSendMessage={send} />); await advance(250);
  act(() => Recognition.current.result("I implemented", true)); await advance(500);
  act(() => Recognition.current.result("caching", false, 1)); await advance(1500); expect(send).not.toHaveBeenCalled();
  act(() => Recognition.current.result("caching", true, 1)); await advance(1200); expect(send).toHaveBeenCalledWith("I implemented caching", expect.any(String));
});
it("suspends recognition during playback and resumes after speech finishes", async () => {
  const send = vi.fn(); const view=render(<ContinuousVoicePanel messages={[]} isLoading={false} aiSpeaking onSendMessage={send} />); await advance(500);
  expect(Recognition.current.start).not.toHaveBeenCalled();
  act(() => Recognition.current.result("AI speaker echo", true)); await advance(1500); expect(send).not.toHaveBeenCalled();
  view.rerender(<ContinuousVoicePanel messages={[]} isLoading={false} aiSpeaking={false} onSendMessage={send} />); await advance(250);
  expect(Recognition.current.start).toHaveBeenCalledTimes(1);
});
it("cleans handlers and timers on unmount without restarting recognition", async () => {
  const view=render(<ContinuousVoicePanel messages={[]} isLoading={false} onSendMessage={vi.fn()} />); await advance(250);
  const recognition=Recognition.current; view.unmount(); await advance(2000);
  expect(recognition.onresult).toBeNull(); expect(recognition.onend).toBeNull(); expect(recognition.start).toHaveBeenCalledTimes(1);
});
it("allows deliberate interruption without treating speaker audio as barge-in", () => {
  const interrupt=vi.fn(); render(<ContinuousVoicePanel messages={[]} isLoading={false} aiSpeaking onSendMessage={vi.fn()} onBargeIn={interrupt} />);
  fireEvent.click(screen.getByRole("button", { name: "Interrupt & answer" })); expect(interrupt).toHaveBeenCalledOnce();
});
