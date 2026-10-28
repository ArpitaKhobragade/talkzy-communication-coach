# Test plan

## Definition of "working"
A student can complete: onboarding -> choose module -> read -> converse -> report -> history/progress, and data deletion works.

## Unit tests (Vitest)
- Filler/repetition detection, pace, pauses, lexical variety.
- Reading alignment (accuracy, missed words) including out-of-order and partial reads.
- Daily limit logic (remaining minutes, midnight rollover).
- Progress trends and recommendation selection.
- Report quote verification (fabricated quotes are dropped).
- Storage: schema validation, corrupt data recovery, delete-all.
- API schemas reject oversize/invalid bodies.

## End-to-end (Playwright, Chromium, dev mode)
- Onboarding with age gate (under-13 needs guardian confirmation).
- Full journey using typed answers and a mocked SpeechRecognition/SpeechSynthesis (the mock proves our integration logic; it does **not** prove real speech recognition).
- Report renders; session appears in history and progress.
- Delete one session and delete all data.
- Mic permission denied path shows the typed fallback.
- Layout at 375 / 768 / 1440 px has no horizontal scroll.

## Status
Automated: 114 unit tests (Vitest) and 16 e2e tests (Playwright). E2E covers API validation and rate limits, onboarding age gate, a full mocked-voice journey, mic-denied fallback, daily limit, delete flows, 375/768/1440 layout, the on-device vision pipeline with no external requests, and a **cloud-mode journey**: real Silero VAD on a recording of real synthesised speech, mock Sarvam / Cartesia / Groq servers that record what our app sends, the AI report with fabricated quotes removed, ending mid-answer, and a Sarvam-failure fallback. Also run: `npm run lint`, `npm run typecheck`, `npm run build`.

Not automated (the test doubles prove our logic, not the real services):
- Chrome's real speech recognition and speech synthesis.
- **The real Sarvam, Cartesia and Groq APIs.** Integrations follow their published docs and are tested against mocks only.
- MediaPipe accuracy on real faces/postures (tests use Chromium's synthetic camera feed).
- Silero VAD on real human voices in real rooms (tests use a recording of synthesised speech).

## Manual checklist (do before relying on voice, AI or vision)
1. **Voice, Chrome with headphones:** Begin, allow mic, read aloud (words highlight), start conversation. Coach speaks; speak a 3-4 sentence answer; it should end after ~2 s of quiet; the follow-up should refer to what you said (live mode).
2. **Silence:** stay quiet 12 s, the coach should offer a hint; repeat until the "I'm ready" pause appears.
3. **Unclear speech:** mumble or cover the mic; coach asks you to repeat.
4. **Mic blocked:** deny permission; notice appears and typed answers work.
5. **Pace and pauses:** speak for about 30 s with two deliberate 2-second pauses; the report should show a pace in a plausible range and about 2 long pauses.
6. **Camera:** enable it; sit in frame, look at the screen, then turn away; report percentages should move accordingly. Deny camera: session continues.
7. **Live AI (set `ANTHROPIC_API_KEY`):** report has strengths/improvements with quotes you actually said, and no punctuation or pronunciation criticism. Grammar items quote real mistakes.
8. **Failure handling:** set a wrong API key; coach falls back to scripted questions with a visible label, and the report explains why AI feedback is missing.
9. **Minors:** choose "Under 13" and confirm the guardian checkbox is required.

### Cloud voice checklist (real keys: Groq, Sarvam, Cartesia + voice ID)
1. Open `/api/status`: expect `{"mode":"live","llm":"groq","stt":"sarvam","tts":"cartesia"}`.
2. **Coach voice:** the coach should speak in your Cartesia voice with no cut-off. If you hear the browser voice instead, check `CARTESIA_VOICE_ID` and the server log for `[voice/tts] failed: cartesia_http_<status>`.
3. **Long answer:** speak for 40+ seconds with a few 1-2 second thinking pauses. The answer must not be cut off; the live text should keep growing; after you stop it should send about 3 seconds later.
4. **"Next question"** sends the answer immediately (with no words it skips the question). After a pause of about two seconds the coach asks "Are you done?": say "yes" (next question) or "no" (the same answer goes on). **Type instead** works at any moment. **End session** (top bar) works at any moment and keeps the sentence you were saying.
5. **Recognition quality:** say domain words from the passage (they are sent to Sarvam as hints). If transcripts are empty, check the server log for `[voice/stt] failed: sarvam_http_<status>` (401/403 means a bad key; 4xx on `keyterms` is retried without it automatically).
6. **Failure handling:** put a wrong `SARVAM_API_KEY`; after two failed segments the app should switch to the browser recogniser or offer "Try voice again", never a dead end.
7. **Report:** it should have three sections (reading, answering, camera) each with what went well, what to improve and how; quotes must be words you said; with the camera on, the camera section should name specific things (face out of view, looking away, posture, movement) with a fix for each.

## Gates before each commit
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
