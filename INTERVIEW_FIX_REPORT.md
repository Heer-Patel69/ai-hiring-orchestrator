# Candidate interview fixes — 29 September 2026

The existing candidate live interview was modified in place. Authentication, job/application routes, evaluation, and dashboards remain in the application. These are local source changes; the frontend/backend have not been deployed. The new turn-ledger migration was applied to the configured PostgreSQL database and checked with concurrent requests.

## Root causes and changes

| Problem | Cause found in code | Change and verification |
|---|---|---|
| Duplicate turns/questions | Repeated speech results, unstable callback effects, overlapping submissions, separate greetings, and no durable request identity | Final-result indices and utterance UUIDs, one submission mutex, bounded history, one greeting, and an atomic PostgreSQL turn ledger. Completed requests replay; processing or changed-payload duplicates are rejected. Frontend tests and a real concurrent database check passed. A real 10-turn provider conversation produced zero exact repeated questions. |
| Camera freezes/disappears | Borrowed tracks stopped during effect cleanup; recovery reacquired microphone unnecessarily; video mounting/source recovery raced renders | Parent owns session streams; preview reattaches/plays the actual stream; recovery obtains video only and preserves microphone. Borrowed-track, rerender, late permission, and recovery tests passed. Physical camera continuity is **not verified**. |
| Recording failures/false status | Recording badge followed interview state; metadata used a nonexistent application-ID conflict target; codec assumptions and finalization/upload races | Actual MediaRecorder state, runtime MIME selection, stable screen/camera canvas and microphone destination, final chunks before upload, metadata by row ID, one stop/upload promise, signed viewer URLs, explicit partial/error state, local download and retry. Mocked browser/storage lifecycle tests passed; real deployed metadata schema inspected. A complete hardware recording/upload is **not verified**. |
| Unreliable listening | Interim/final text mixed, duplicate final events, recognition active during playback, repeated recognition setup, microphone permission churn | Stable recognition instance and callbacks, final-only submission after 1.1 seconds of silence, actual start/end state, playback/processing suspension and automatic allowed-state resume, mic-enabled gating, shared Bhashini mic, explicit errors. Recognition lifecycle tests passed. |
| TTS repeats or changes voice | Voice list readiness, stale callbacks, optimistic speaking flags, parallel sentence synthesis, silent fallback | Voice URI/service locked per session; real playback events drive speaking; stale callbacks ignored; Bhashini sentence synthesis serialized; audio queue cancellation resolves pending playback. Browser TTS tests passed. Bhashini playback cannot be verified with the rejected provider key. |
| Slow/robotic conversation | Unbounded context, client/provider orchestration overlap, weak follow-up instructions, no cancellation/timing visibility | Authenticated backend streaming, bounded context, first-token/total timings, request timeouts and cancellation; concise contextual single-question prompt with previous-question history. Real provider first-token observations were 137–436 ms. This excludes ASR/TTS and is not a before/after latency benchmark. |
| Viewport overflow | Unbounded flex children and column minimums; editor/problem/transcript competing for page height | 100dvh shell, shrinkable grid/flex children, responsive column proportions, internal panel scrolling, bounded problem area and persistent answer input. Actual-component fixture checked at four desktop sizes. |
| Listener/stream races | Unstable effect dependencies, repeated proctoring callbacks, late permission completions and obsolete requests | Stable callback refs, idempotent logger intervals, track/device listeners removed, owned streams stopped, late media allocations disposed, obsolete requests aborted. Proctoring no longer records fake recording-start events. |

Interruption is an explicit **Interrupt & answer** control. Hands-free acoustic barge-in is not implemented or verified. Standard browser recognition displays interim text without submitting it; Bhashini remains utterance-based batch ASR with final captions, not streaming partial ASR.

## Files changed

- Session/layout: `src/pages/candidate/AIInterviewRoomPage.tsx`, `src/index.css`, `src/components/interview/CodeEditorPanel.tsx`.
- Voice/media: `ContinuousVoicePanel.tsx`, `VideoPanel.tsx`, `TextToSpeech.tsx`, `BhashiniVoiceAgent.tsx` under `src/components/interview/`; `src/lib/interview-turns.ts`, `src/lib/bhashini-audio.ts`.
- Recording/proctoring: `src/hooks/useSessionRecording.ts`, `useInterviewRecording.ts`, `useAntiCheat.ts`, `useProctoringLogger.ts`; `src/components/interview/ProctoringMonitor.tsx`, `InterviewRecordingViewer.tsx`.
- Backend: `server/src/app.js`, `prompt.js`, `turn-store.js`, `dev.js`, `server/package.json`; `supabase/migrations/20260929000000_interview_turn_idempotency.sql`; `.env.development.local` contains only the local backend URL.
- Schema-field type corrections: `src/pages/dashboard/FairnessDashboardPage.tsx`, `LearningDashboardPage.tsx`.
- Verification: six frontend test files, backend turn-store tests, `server/scripts/verify-interview-{providers,storage}.js`, `verify-turn-ledger.js`, and `test-results/interview-components.{html,tsx}`.

The separate legacy recruiter `/interview` demo was not converted. This work targets `/candidate/interview/live`.

## Checks performed

- **19 frontend tests passed**: transcript finalization, recognition playback gating/resume, camera ownership/recovery, actual TTS start/stale callback/voice selection, recording finalization/codec/retry/partial failure.
- **3 backend tests passed**. Real PostgreSQL concurrent claims allowed exactly one owner, replayed a completed turn, and rejected changed payloads. Only the generated diagnostic ledger row was removed afterward.
- TypeScript application check and production build passed. Targeted interview lint had no errors. The main session page retains seven hook-dependency warnings; the combined component/hook TTS module has one Fast Refresh warning. Vite reports large bundle chunks.
- Actual components with Monaco at 100% browser zoom: 1920×1080, 1536×864, 1366×768, and 1440×900. Document dimensions matched each viewport and panel/input bounds remained inside it. This fixture did not simulate authenticated interview success or camera playback.
- Real Groq provider test with fictional test answers: ten completed turns, zero exact repeated questions, contextual technical follow-ups. One provider failure required resuming the diagnostic for the tenth turn. Results: `test-results/provider-check.json`.
- Application started locally. The protected live route initially redirected to login; the final browser recheck showed Chrome `ERR_BLOCKED_BY_CLIENT` for the local login page. No authenticated test application was supplied, so the requested complete 8–10-turn spoken, fullscreen, screen-share, recording/storage, network and teardown scenario remains **unverified**. No claim of continuous live camera or successful real recording storage is made.

## External blockers and remaining limits

1. **Bhashini rejects the configured ULCA API key.** A real pipeline probe returned HTTP 400 with “Error in fetching ulcaApiKey. Please check if it exists.” Canonical credential precedence was corrected, but provider access still fails. Supply a valid provisioned key/service configuration before testing ASR/TTS. See [Bhashini pipeline configuration](https://bhashini-developer-portal-dev.bhashini.co.in/docs/api/pipeline-config-call/).
2. **The recordings bucket limits files to 100 MiB.** A long interview can exceed this. The code now surfaces failure and retains the local recording, but long-session persistence remains unresolved. Adjust the applicable project/bucket limits and implement resumable or segmented upload for production-length sessions; this change does not implement that upload strategy. See [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).
3. Browser speech recognition and available voices depend on browser/OS permissions and services. Physical microphone, playback echo, camera recovery, and final screen-recording audio quality require a signed-in hardware run.
4. A refresh restores session timing and requires fresh media permissions; it cannot recover a previous in-memory recording. The durable ledger deliberately rejects a previously failed/processing turn instead of retrying it and risking duplicate generation.

The code and focused checks are complete; full end-to-end acceptance remains pending the authenticated test session, working speech-provider credentials, and a recording upload configuration suitable for the interview duration.
