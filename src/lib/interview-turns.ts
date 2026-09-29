/** Browser recognition results are cumulative within one recognition run. */
export class FinalTranscriptBuffer {
  private committed = new Set<number>();
  private parts: string[] = [];
  add(index: number, text: string) {
    if (this.committed.has(index)) return;
    this.committed.add(index);
    if (text.trim()) this.parts.push(text.trim());
  }
  get text() { return this.parts.join(" "); }
  take() { const text = this.text; this.parts = []; return text; }
  resetRun() { this.committed.clear(); }
  clear() { this.parts = []; this.committed.clear(); }
}

export function normalizedQuestion(text: string) {
  const questions = text.match(/[^.!?]*\?/g);
  return (questions?.join(" ") || text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
