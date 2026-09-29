import { describe, it, expect } from "vitest";
import { FinalTranscriptBuffer, normalizedQuestion } from "./interview-turns";

describe("final transcript ownership", () => {
  it("commits each final result index once even when a provider redelivers it", () => {
    const buffer = new FinalTranscriptBuffer();
    buffer.add(0, "I implemented Redis"); buffer.add(0, "I implemented Redis"); buffer.add(1, "to cache requests.");
    expect(buffer.take()).toBe("I implemented Redis to cache requests.");
    buffer.add(1, "to cache requests."); expect(buffer.take()).toBe("");
  });
  it("accepts the same text as a legitimate new utterance after a recognition restart", () => {
    const buffer = new FinalTranscriptBuffer(); buffer.add(0, "Yes"); expect(buffer.take()).toBe("Yes");
    buffer.resetRun(); buffer.add(0, "Yes"); expect(buffer.take()).toBe("Yes");
  });
  it("clears pending speech when interrupted", () => {
    const buffer = new FinalTranscriptBuffer(); buffer.add(0, "Unfinished"); buffer.clear(); expect(buffer.take()).toBe("");
  });
  it("identifies a repeated question even if the acknowledgement changes", () => {
    expect(normalizedQuestion("Interesting. Why did you choose Redis?")).toBe(normalizedQuestion("Thank you. Why did you choose Redis?"));
  });
});
