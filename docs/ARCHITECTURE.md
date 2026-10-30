# Architecture

## Stack
Next.js (App Router) + TypeScript + Tailwind CSS. Anthropic API (server-side only) for conversation and report. Browser Web Speech API for speech-to-text and text-to-speech. MediaPipe Tasks Vision (on-device WASM) for face/pose. Vitest for unit tests, Playwright for end-to-end tests. Deployable to Vercel.

## Request flow
```
Browser UI (client components)
  |-- Web Speech API: SpeechRecognition (mic -> text), SpeechSynthesis (text -> audio)
  |-- Web Audio AnalyserNode: voice-activity timing (speaking time, pauses)
  |-- MediaPipe (WASM, on-device): face + pose landmarks from webcam frames
  |-- localStorage (versioned, zod-validated): profile, settings, sessions
  |
  +--> POST /api/coach/turn    (transcript so far -> next coach utterance)
  +--> POST /api/coach/report  (transcript + computed metrics -> report JSON)
  +--> GET  /api/status        (is live AI configured? -> "live" | "dev")
            |
            Next.js route handlers (validate with zod, rate-limit, no logging of content)
            |
            Anthropic Messages API (key in server env only)  |  dev-mode scripted coach
```

## How a coach turn works (v6)

1. **Opening.** While the student reads, `src/services/opening.ts` asks `/api/coach/turn` (`event: "start"`) for the opening and makes its voice ahead of time.
2. **Turn-taking.** The conversation screen waits for a pause that depends on what was said (0.7 s after a finished sentence, 1.3 s after a very short answer, 2.2 s after a half-finished sentence). As soon as a sentence seems finished (0.2 s of quiet) it asks for the reply early so it is ready. The conversation closes by itself after ten answers (`MAX_STUDENT_TURNS`, counted with `answerCount` because the history sent is short) or when under 75 s are left.
3. **The reply.** `/api/coach/turn` builds the prompt (`coach/server/prompts.ts`: the student, the passage, how a good conversation goes, the pace for the time left, the safety rules), puts a short reminder at the very end of what the AI reads, and calls Groq (`coach/server/llm.ts`: Qwen, then gpt-oss-20b, then gpt-oss-120b, moving on at once when a model is at its per-minute limit). If the reply has no question, grades the student, claims a past, or (for the opening) has no greeting, the AI is asked once to say it again. A closing must be a goodbye that says the report is being made.
4. **The name.** The AI writes the student's first name as `{name}`; `coach/name-token.ts` puts the real name in on the device and turns it back into `{name}` before the coach's earlier words are sent again. The name is never sent to the AI.
5. **The voice.** `speech/speaker.ts` asks `/api/voice/tts` (Cartesia, your voice ID) for each short piece. If it fails, the coach is silent and the words stay on screen.
6. **The end.** `event: "end"` asks the AI for a goodbye ("Okay, I'm generating your report now..."), then the progress screen, then `trySaveSession` (the session is repaired first if a number is out of range; if the browser will not keep it, it is kept in memory and the report opens anyway with a Download PDF button) and the report.

## Layers and rules
- `src/app/**` routes and pages. Thin: compose components, call services.
- `src/components/**` presentational components. No business logic, no storage access.
- `src/features/<name>/**` domain logic (content, speech, vision, coach, progress). Pure functions where possible so they are unit-testable.
- `src/services/**` side-effecting boundaries (localStorage storage, API client).
- `src/lib/**` small shared helpers.
- Server code (`src/app/api/**`, `src/features/coach/server/**`) never imported by client components.
- UI components never contain database/storage logic; they call `services/storage`.

## Data model (client, localStorage)
- `Profile { displayName, ageBand, field, level, goal, consent{ acceptedAt, guardianConfirmed } }`
- `Settings { cameraDefault, keepTranscripts, speakingRate, ... }`
- `Session { id, startedAt, moduleId, durationSec, mode: "live"|"dev", reading{...}, turns[], speechMetrics, visionMetrics|null, report }`
- No raw audio or video is ever stored. Transcripts are kept only if `keepTranscripts` is on.

## Why device-local storage
No accounts means no passwords or student PII on a server (important for minors), and the server stays stateless so it deploys anywhere. Trade-off: no cross-device sync (listed as out of scope).

## Measurement definitions (heuristics, all documented to students)
- **Pace:** words recognised in voice answers / seconds from first to last detected speech in each answer (pauses included). Reported only with 20+ s and 30+ words of voice.
- **Pause:** silence of 1.0 s or more between two stretches of speech inside one answer. **Thinking time:** end of coach speech to first detected speech.
- **Voice detection:** energy gate on microphone loudness over an adaptive noise floor learned only from non-speech frames. Approximate.
- **Filler words:** um, uh, er, erm, hmm, ah, basically, actually, literally, "you know", "i mean". Browser recognisers often drop um/uh, so counts are a lower bound.
- **Camera-facing:** head yaw and pitch both within 25 degrees (from the face landmarker's transform matrix). **Upright:** shoulder tilt up to 8 degrees and nose within 0.4 shoulder-widths of the shoulder midpoint. **Movement / facial movement levels:** mean frame-to-frame displacement thresholds (low / moderate / high). Geometry only: no emotion inference.

## Session phases
`setup (permissions) -> reading -> conversation -> wrap-up (analysis + report) -> report page`.
Daily cap: 20 minutes across all sessions on a local calendar day; the conversation timer is limited to the remaining allowance.
