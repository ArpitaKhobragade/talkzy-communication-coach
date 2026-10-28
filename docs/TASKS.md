# Tasks

## Phase 0 - Setup
- [x] git init, dependencies (Next 16, React 19, Tailwind 4, Anthropic SDK, MediaPipe, Vitest, Playwright; 0 audit vulnerabilities)
- [x] Docs written
- [x] Config files, layout shell, design tokens

## Phase 1 - Foundations
- [x] Types + zod schemas
- [x] Content library (8 fields x 3 levels = 24 modules)
- [x] Storage service + daily limit
- [x] Onboarding / consent / profile (age gate, guardian confirmation for under-13)

## Phase 2 - Practice flow
- [x] Library page
- [x] Speech services (recognition, synthesis, voice timing, turn capture)
- [x] Reading phase with read-aloud analysis
- [x] API routes (status, turn, report) + dev coach
- [x] Conversation screen (silence, unclear speech, mic errors, typed fallback, skip audio)

## Phase 3 - Analysis
- [x] Speech metrics
- [x] Vision analyzer (MediaPipe, CPU delegate, load timeout) + summary
- [x] Report builder + quote verification
- [x] Report page

## Phase 4 - Progress and polish
- [x] Dashboard, history, progress charts, recommendations
- [x] Settings and privacy page (export, delete transcripts, delete all)
- [x] Responsive check at 375 / 768 / 1440

## Phase 5 - Verify and ship
- [x] Unit tests (81) and e2e tests (13)
- [x] lint / typecheck / build green
- [x] README with setup instructions

## Phase 6 - Voice stack and feedback upgrade (owner request)
- [x] LLM provider layer (Groq gpt-oss-120b default, Anthropic optional)
- [x] Sarvam STT + Cartesia TTS proxy routes (origin check, rate limit, size/type validation)
- [x] Silero VAD segments, cloud capture, Cartesia playback with browser fallback
- [x] Fix voice drop-outs: patient end-of-answer, recogniser retries, "Try voice again", no permanent voice-off
- [x] End session always visible and keeps the in-progress answer; typing always available
- [x] Report: reading, answering and camera coaching (what went well / improve / how)
- [x] Cloud-mode e2e with mock services and real-speech fixture

## Not done / future
- [ ] Manual verification with a real microphone and real API key (see TEST_PLAN.md)
- [ ] Validate vision accuracy on real faces and postures
- [ ] Server-side accounts and cross-device sync (out of scope for v1)
- [ ] More content, or AI-generated passages
