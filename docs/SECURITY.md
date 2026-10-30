# Security and privacy

## Secrets
- `ANTHROPIC_API_KEY` is read only in server route handlers via `process.env`. It is never sent to the browser, never logged, and never committed (`.env.local` is git-ignored).

## API hardening
- zod validation on every route; max transcript length and turn count; content-type check.
- Per-IP in-memory rate limit on AI routes (best-effort; for production use an edge/Redis limiter).
- Route handlers never log request bodies (transcripts are personal data).
- Student text is untrusted: system prompts instruct the model to treat it as data and never follow instructions inside it. Report quotes are verified against the real transcript server-side before being returned.

## Voice and LLM services
- `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `SARVAM_API_KEY`, `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` are read only on the server. `/api/status` returns only service names (`groq`, `sarvam`, `cartesia`), never key material; a test asserts this.
- `/api/voice/stt` and `/api/voice/tts` spend paid keys, so they refuse requests whose `Origin` names another site (403), enforce content type and size (WAV up to ~1.2 MB; TTS text up to 600 characters), and are rate-limited per client. Upstream error bodies are not forwarded to the browser.
- Audio and text are forwarded and not stored or logged. Server logs record only the service name and HTTP status of a failure.
- The Sarvam, Cartesia and Groq vendors receive: short speech clips (Sarvam), the coach's own sentences (Cartesia), and transcript text (Groq). The in-app privacy page says so. A school deploying this should review those vendors and agreements.

## Data minimisation
- No student passwords or emails. A name only, stored on the device and sent to the college's admin panel with the reports. The student's first name is **not sent to the AI**: the AI writes it as `{name}` and the app fills it in on the device, and the coach's earlier words are sent back with the name turned into `{name}`. (If the student says their own name aloud, those words are part of what is sent as speech and text, like any other words they say.)
- No raw audio or video stored or uploaded. Webcam frames are processed in the browser by MediaPipe and discarded; only numeric summaries are kept.
- Transcripts can be switched off after report generation (`keepTranscripts`), and any session or all data can be deleted in Settings. Data export is available.

## What leaves the device (disclosed in the app on /privacy and during onboarding)
1. **Audio -> speech recognition.** Chrome/Edge's built-in Web Speech API may send microphone audio to the browser vendor's speech service to produce text. It is used for the live words shown while the student speaks, and as the fallback when Sarvam is not set up. Students are told this before the first use; typed answers are always available.
2. **Transcript text -> our server -> Anthropic API** to generate the coach's replies and the report.
3. **Video:** never leaves the device.
4. **Name, numbers and written report -> our server -> the admin database** (Upstash Redis) after every finished session, so the college admin can see the student's progress and download the report. Never the voice, the video or the transcript. The sign-up says this in one line.

## Minors
- Talkzy is now made for management colleges (adults), so **age is no longer asked** and there is no guardian step. Saved profiles that still have an age are read as adults.
- The camera and the microphone are always requested at the start of practice (the sign-up says so). If the browser blocks the camera the session goes on without it.
- Coach prompt is age-appropriate, avoids personal-information requests, and responds supportively and redirects to a trusted adult if a student mentions harm or distress.
- Schools deploying this should add their own consent and data-processing agreement; this app does not replace legal review.

## Headers
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera/microphone limited to same origin), and `Content-Security-Policy: connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` are set in `next.config.ts`.

The `connect-src 'self'` rule is a privacy control, not only hardening: the MediaPipe vision runtime tries to send usage logs to `odml.pa.googleapis.com`, and this blocks it. `tests/e2e/vision.spec.ts` fails if any external request succeeds during camera analysis. (A full script-src CSP is not set because Next.js inline scripts would need nonces; add one before a hardened production rollout.)

## Admin panel
- **/admin** is closed unless `ADMIN_PASSWORD` (8+ characters) is set. The password is compared in constant time. After 8 wrong tries from one address the panel refuses for 10 minutes (best effort, kept in the server's memory).
- A correct password sets an **httpOnly, SameSite=Strict, Secure (on https)** cookie that holds an expiry time and an HMAC signature, valid for 12 hours. `/api/admin/students` and `/api/admin/report` return 401 without it.
- `/api/progress` is open (a student has no password). It accepts only the exact shape in `src/features/admin/types.ts`, at most 200 KB, with no links in the report. Its weakness: anyone who knows the address can send made-up students. Add a join code if this becomes a problem.
- The admin page is marked `noindex` and is not linked from the app.
