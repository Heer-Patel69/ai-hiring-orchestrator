import { readFile, writeFile } from "node:fs/promises";
import { callGroq, callBhashini, loadConfig } from "../src/app.js";
import { buildInterviewPrompt } from "../src/prompt.js";
const config = loadConfig();
const report = process.argv.includes("--resume") ? JSON.parse(await readFile(new URL("../../test-results/provider-check.json", import.meta.url), "utf8")) : { date: new Date().toISOString(), model: config.groqModel, llm: [], tts: null };
delete report.llmError;
const system = buildInterviewPrompt({ candidate: { fullName: "Integration Test Candidate", skills: ["TypeScript", "Redis"], projects: [{ name: "API caching integration test" }] }, job: { title: "Backend Engineer", requiredSkills: ["TypeScript", "PostgreSQL", "Redis"], description: "Design reliable APIs." }, durationSeconds: 2700, remainingSeconds: 2400, roundNumber: 1 });
const answers = [
  "Start the interview. Introduce yourself briefly and ask one question.",
  "I improved API response time by adding Redis caching and batching database queries.",
  "I chose Redis so our stateless services could share cache entries, and used short TTLs with invalidation after writes.",
  "We measured p95 latency and database query counts before and after deployment, and also tracked cache hit ratio.",
  "Our biggest problem was stale data after concurrent updates. We versioned cache entries and invalidated through an outbox.",
  "I used Postgres transactions for the outbox and idempotent consumers. Events carried unique IDs so retries could be deduplicated.",
  "We investigated failures using distributed traces and added tests for retries, concurrency, and delayed events.",
  "I am not sure what you mean. Can you explain what aspect you want me to describe?",
  "That question is irrelevant, fuck you.",
  "I would handle a production outage by limiting impact first, informing stakeholders, then using metrics and logs to find the cause.",
];
const history = [], questions = new Set();
try {
  for (const [i, answer] of answers.entries()) {
    history.push({ role: "user", content: answer });
    if (report.llm[i]) {
      history.push({ role: "assistant", content: report.llm[i].response });
      const full = report.llm[i].response;
      questions.add((full.match(/[^.!?]*\?/g)?.join(" ") || full).toLowerCase().replace(/[^a-z0-9]+/g," ").trim());
      continue;
    }
    const started = performance.now(); let firstTokenMs = null;
    const res = await callGroq(config, { model: config.groqModel, messages: [{ role: "system", content: system }, ...history], stream: true, max_tokens: 240, temperature: 0.4 }, `integration-${i}`);
    const decoder = new TextDecoder(); let buffer = "", full = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
        const data = JSON.parse(line.slice(6)); const delta = data.choices?.[0]?.delta?.content;
        if (delta) { firstTokenMs ??= Math.round(performance.now()-started); full += delta; }
      }
    }
    if (!full.trim()) throw new Error("Provider returned an empty response");
    const key = (full.match(/[^.!?]*\?/g)?.join(" ") || full).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const repeated = questions.has(key); questions.add(key);
    report.llm.push({ turn: i+1, firstTokenMs, totalMs: Math.round(performance.now()-started), repeated, response: full.trim() });
    history.push({ role: "assistant", content: full });
    console.log(JSON.stringify({ turn:i+1, firstTokenMs, repeated }));
  }
} catch (error) { report.llmError = error.message; console.error("LLM provider test failed:", error.message); }
try {
  const start = performance.now(); const result = await callBhashini(config, "tts", "en", "This is an interview audio integration test.", 22050, "female");
  const content = result.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
  report.tts = { ms: Math.round(performance.now()-start), hasAudio: Boolean(content), bytes: content ? Buffer.from(content,"base64").length : 0 };
  if (content) await writeFile(new URL("../../test-results/provider-tts.wav", import.meta.url), Buffer.from(content,"base64"));
} catch (error) { report.tts = { error: error.message }; }
await writeFile(new URL("../../test-results/provider-check.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ llmTurns: report.llm.length, llmError: report.llmError, tts: report.tts }));
