# Talkzy

A web app that helps school and college students improve their spoken English. A student picks a subject, **reads a passage**, has a **live spoken conversation** with an AI coach about it, and gets a **personal feedback report** based on what they actually said. Sessions are capped at **20 minutes per day**, and progress is tracked over time.

English only. No accounts. Data stays on the student's device.

## What it does

| Step | What happens |
|------|--------------|
| 1. Profile | Student chooses subject/field (8 fields), difficulty (3 levels) and goal (fluency, clarity, vocabulary, confidence, interviews). Under-13s need a guardian confirmation. |
| 2. Reading | A passage for their field appears. They can read it aloud: words light up as they are heard, and reading accuracy and pace are measured. |
| 3. Conversation | The coach **speaks** (text-to-speech), the student **answers by microphone** (speech recognition), and the coach asks relevant follow-ups using the passage and earlier answers. Handles silence, unclear speech, mic errors; typed answers are always available. |
| 4. Analysis | Measured: pace, pauses, thinking time, filler words, repetitions, answer length, word variety, reading accuracy. AI-assessed (live mode): grammar, vocabulary, structure, relevance. Optional on-device webcam observations: face visibility, head direction, posture, movement. |
| 5. Report | Written in very simple English. Three parts (reading, answering, camera), each with **what went well**, **what to fix** and **how to fix it**. An **"Instead of this, say it like this"** section takes sentences you really said and shows a clearer way to say them (written by the AI, or worked out from your own words when there is no AI). The camera part covers your face in the picture, looking at the camera, your face while talking, how you sat, and your hands and body. Exercises and next-session focus follow. Every number is labelled **Measured**, **Calculated** or **AI assessment**. **Download PDF** or **Download as text** (made on the device, nothing uploaded). |
| 6. Progress | History, trends (they appear by themselves once there are two sessions to compare), streak, daily-limit ring, and a recommendation for what to practise next. |

## Quick start

Requirements: **Node.js 20+** (developed on 22) and a recent **Chrome or Edge** for voice features.

```bash
npm install
```

`npm install` also runs `npm run setup:vision`, which copies the MediaPipe WASM runtime into `public/mediapipe/`, downloads two small pretrained models (about 9 MB total, from Google's official MediaPipe model storage) into `public/models/`, and copies the Silero voice-detection model and ONNX runtime (about 17 MB, from `node_modules`) into `public/vad/`. If the model download fails the app still works, only without body-language analysis; re-run it with `npm run setup:vision`.

```bash
npm run dev
```

Open <http://localhost:3000>.

### Services (all optional: the app degrades gracefully without them)

| Service | Used for | Environment variables | Without it |
|---------|----------|-----------------------|------------|
| **Groq** (`openai/gpt-oss-120b`) | The coach's replies and the AI-written report | `GROQ_API_KEY` | Development mode (scripted coach, no AI report) |
| **Sarvam AI** | Speech-to-text for the student's voice | `SARVAM_API_KEY` | The browser's own recogniser (Chrome/Edge/Safari only) |
| **Cartesia Sonic 3.6** | The coach's spoken voice | `CARTESIA_API_KEY` + `CARTESIA_VOICE_ID` | The browser's own voice |
| **Silero VAD** | Detects when the student starts and stops speaking (runs in the browser, no key) | none | n/a |
| Anthropic (optional) | Alternative LLM instead of Groq | `ANTHROPIC_API_KEY` (+ `LLM_PROVIDER=anthropic` to force it) | n/a |

1. Copy the example file and fill in your keys and the Cartesia voice ID:

   ```bash
   cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
   ```

   ```ini
   GROQ_API_KEY=...
   SARVAM_API_KEY=...
   CARTESIA_API_KEY=...
   CARTESIA_VOICE_ID=...
   ```
2. Restart `npm run dev`.
3. Open <http://localhost:3000/api/status>. It should show `{"mode":"live","llm":"groq","stt":"sarvam","tts":"cartesia"}`. Anything shown as `dev` or `browser` means that key is missing or misspelt.

Keys are read only by server code, never sent to the browser, and `.env.local` is git-ignored. The browser calls this app's own `/api/voice/stt` and `/api/voice/tts` routes, which add the keys. If a service fails mid-session the app falls back (Cartesia to the browser voice, Sarvam to the browser recogniser, Groq to scripted questions) and says so on screen.

### How the voice conversation works

1. The coach's words are spoken with the Cartesia voice (or the browser voice).
2. **Silero VAD** (in the browser) finds each stretch of speech. Each segment is sent as a short WAV to **Sarvam** and the text comes back while the student keeps talking.
3. An answer ends after **about 3 seconds of quiet** (so thinking pauses are not cut off), or when the student presses **I'm done speaking**.
4. The student can **type instead** at any moment, and can press **End session** (top bar) at any moment; whatever was being said is kept.
5. If voice has a problem, the app switches to the browser recogniser automatically, or shows **Try voice again**. It never tells the student that voice is permanently off.
### Using the microphone and camera

- With Sarvam configured, voice works in any modern browser. Without it, voice needs Chrome, Edge or Safari (Firefox falls back to typed answers). Use `http://localhost` or `https`.
- Use **headphones**: the app takes turns (the mic is off while the coach speaks) but speakers can still leak into the mic.
- Permissions are requested only when the student presses **Begin**, and the camera is off by default.
- **Privacy note:** with Sarvam configured, short clips of speech go to this app's server and on to Sarvam to be transcribed, then are discarded. Without it, the browser's own recogniser may send audio to the browser vendor. The coach's sentences (not the student's answers) go to Cartesia for the voice. The app explains all of this before first use. Raw audio and video are never recorded or stored by this app.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm test` | Unit tests (Vitest, 139 tests) |
| `npm run test:e2e` | End-to-end tests (Playwright, 18 tests): builds the app, then runs it as a production server in two configurations (no keys on :3100, and wired to mock Sarvam/Cartesia/Groq services on :3102/:3101). First run needs `npx playwright install chromium`. It does not use port 3000, so `npm run dev` can stay open. |
| `npm run setup:vision` | (Re)copy vision and voice-detection assets (`public/mediapipe`, `public/models`, `public/vad`) |

## Project layout

```
docs/                     PRD, ARCHITECTURE, DESIGN, RULES, SECURITY, DECISIONS, TEST_PLAN, TASKS, MEMORY
src/app/                  Pages (dashboard, library, practice, report, progress, profile, settings, privacy) and API routes
src/components/           UI components (practice/ holds the reading + conversation screens)
src/features/content/     8 fields x 3 levels = 24 modules (passages, key terms, questions)
src/features/speech/      Metrics, reading-aloud alignment, voice timing, recognition + synthesis wrappers
src/features/vision/      MediaPipe face/pose analysis (on-device) and frame summaries
src/features/coach/       Prompts, dev-mode coach, quote verification, rule-based report notes
src/features/progress/    Daily limit, streaks, trends, recommendations
src/services/             localStorage storage, API client, hooks
tests/unit, tests/e2e     Vitest and Playwright
```

## How it is built

- **Next.js (App Router) + TypeScript + Tailwind.** Route handlers (`/api/coach/turn`, `/api/coach/report`, `/api/status`) validate input with zod, cap sizes, rate-limit per client and never log transcripts.
- **Voice:** Silero VAD (browser, WebAssembly) finds speech segments; each goes through `/api/voice/stt` to Sarvam. The coach is spoken through `/api/voice/tts` (Cartesia). The browser's own recogniser and voice are automatic fallbacks. Turn-taking is half-duplex. Pauses (1 s+) and thinking time come from the VAD segments; pace is words recognised divided by speaking time. The routes check the request origin, rate-limit, validate size and type, and never log audio or text.
- **Vision:** MediaPipe Face Landmarker + Pose Landmarker (pretrained) in the browser via WebAssembly. A Content-Security-Policy (`connect-src 'self'`) keeps the browser from contacting any outside server, which also blocks the usage-logging ping MediaPipe tries to send.
- **AI:** Groq `openai/gpt-oss-120b` (or Anthropic). The report must quote the student verbatim; the server **removes any quote that is not in the transcript** before returning it. The report is organised as: how you did while reading, how you did while answering, and camera feedback (what you did and how to improve), each with what went well, what to improve and how.
- **Pipecat / SmallWebRTC are not used.** The same providers are called from this Next.js app over HTTP, so there is no Python server to run.
- **Storage:** `localStorage` behind `src/services/storage.ts` (zod-validated; corrupt data cannot crash the app). No raw audio/video, ever.

## Honesty about what is and is not measured

- Pronunciation is **not scored**. Reading aloud only lists words the recogniser did not hear clearly, labelled approximate.
- Filler counts are a lower bound: browser recognisers often drop "um"/"uh". "like" and "so" are not counted.
- Pace/pauses can be affected by room noise (voice detection is an energy gate).
- Grammar, vocabulary, structure and relevance are AI opinions, shown as such.
- Body-language numbers describe geometry (face in view, head direction, shoulders, movement). The app never infers emotion, confidence, personality or honesty, and says so in the report.
- Trends appear only once there are two completed sessions to compare.

## Privacy and minors

See [docs/SECURITY.md](docs/SECURITY.md) and the in-app **Privacy** page. In short: no accounts or passwords; display name only; under-13s need guardian confirmation; camera is opt-in per session; transcript saving can be turned off; any session or all data can be deleted or exported from Settings. Schools deploying this should add their own consent process and review the speech and AI vendors used.

## Deploying (Vercel)

1. Push to GitHub and import into Vercel.
2. Set `GROQ_API_KEY`, `SARVAM_API_KEY`, `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` (and optionally the model variables) in the project's Environment Variables, separately for Preview and Production.
3. `npm install` runs the vision asset setup during the build. The in-memory rate limiter is per instance; use an edge or Redis limiter for production traffic.

## Known limitations

- **The real Sarvam, Cartesia and Groq services have not been called.** They were integrated from their published API documentation and tested against local mocks (including real Silero speech detection on recorded speech). The mocks prove our requests are shaped as documented, not that the real services accept them. Your first run with real keys is the real test: use the manual checklist in [docs/TEST_PLAN.md](docs/TEST_PLAN.md). If a call fails, the app falls back and the server log shows the HTTP status (never the audio or text).
- Chrome's own speech recogniser is not covered by automated tests (fakes only).
- Vision was exercised with a synthetic camera feed (pipeline loads and runs, no face present); accuracy on real faces and postures has not been validated.
- 24 passages means regular users will repeat content; the live coach varies its questions, the scripted dev coach does not.
- Data is per-browser (no cross-device sync).
