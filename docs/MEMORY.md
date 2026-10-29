# Memory (current state)

- **Version:** v7 (the Settings and Check pages show it). Each upload folder is one version: `ai-communication-coach-upload` is v1, then `-v2`, `-v3` and so on. Always upload the newest one.
- **Done:** the full student journey (onboarding, library, reading with live underline, a free AI conversation, report with a percentage bar, progress, settings and privacy, a check page, a "make room" screen when the browser is full).
- **The coach:** a free conversation with no fixed questions. The AI writes the opening (while the student reads), every reply and the goodbye. It answers the student's questions first, then asks one follow-up. Feelings come first, facts must be true, no grading, no invented past. No "Are you done?": the coach answers when the student stops. Names are written as `{name}` and never sent to the AI.
- **Voice:** one voice only, the Cartesia voice ID. If Cartesia fails the coach is silent and the words are shown. Sarvam's voice only with `TTS_BACKUP=sarvam`.
- **Models:** Groq chat Qwen, then gpt-oss-20b, then gpt-oss-120b (each has 8,000 tokens a minute on the free plan, about 3 coach turns a minute); report gpt-oss-120b; live words Groq Whisper then Sarvam; saved transcript Sarvam.
- **Verified:** lint, typecheck, build, 5,561 unit tests, 44 Playwright end-to-end tests (mock voice and AI services), and live sessions with the real AI (made-up students, read line by line, replayed after each fix).
- **Not verified:** the coach's real voice (the Cartesia account had no credit when this was written), a real microphone and accent, Chrome's real recogniser, camera accuracy on real people. On the owner's computer the camera showed "Body-language analysis is unavailable" and the reading underline did not work; this was **not yet investigated** (the model files were checked and are on the live site; the cause may be a slow connection or the browser).
- **Owner setup:** keys live in `.env.local` and in Vercel (never committed, never pasted into chat). Redeploy after changing a key.
- **Gotchas:** e2e tests run against production builds (`npm run test:e2e` builds first) on ports 3100 to 3102. `public/vad`, `public/models` and `public/mediapipe` are not in git: `npm install` (the `postinstall` script) downloads them, including on Vercel.
- **Next step:** find why the camera analysis and the underline fail on the owner's computer; top up the Cartesia credit and listen to the real voice; consider a paid Groq plan.
- **Environment:** Node 22.19, npm 10.9, Windows.
