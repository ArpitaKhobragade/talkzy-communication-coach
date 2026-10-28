# Talkzy

**Talkzy helps school and college students speak English with more confidence.** Pick a subject, read a short passage out loud, talk it through with a friendly AI coach, and get a feedback report in very simple language that shows what went well, what to fix and exactly how to fix it.

Live site: <https://talkzy-communication-coach-fk4c.vercel.app>

English only. No accounts. Practice is capped at **20 minutes a day**, and everything is saved on the student's own device.

<p align="center">
  <img src="docs/screenshots/13-wide-desktop.png" alt="Talkzy home screen on a wide desktop: logo on the left and the tabs across the top" width="880">
</p>

## How it works

Each session has two phases and ends with a report.

| | Step | What happens |
|---|---|---|
| 1 | **Reading** | A passage for the student's field appears. They read it out loud. Reading accuracy and pace are measured, and the words they said are matched against the text. |
| 2 | **Conversation** | The coach asks a question out loud, the student answers with their voice (or types), and the coach follows up using the passage and the student's own answers. |
| 3 | **Report** | A personal report is written from what the student actually said and did. |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/05-reading.png" alt="Reading phase: the passage to read out loud"><br><sub><b>Phase 1.</b> Read the passage out loud.</sub></td>
    <td width="50%"><img src="docs/screenshots/06-conversation.png" alt="Conversation phase: the coach asks a question and the student answers"><br><sub><b>Phase 2.</b> Talk it through with the coach. Typing and End session are always available.</sub></td>
  </tr>
</table>

## The reading and the conversation

- **The buttons are at the top of the page** and stay there while scrolling. The student presses **Start reading**, reads, and presses **Finish reading** (it also finishes by itself when the last word is heard). Then **Start conversation** appears (and **Read again**). Without a microphone, **Start conversation** is there from the start.
- **Fast coach:** the coach's opening is made while the student reads, so it starts the moment the conversation does. Each message is spoken in short pieces so the first words start sooner, and the server is placed in Mumbai (`vercel.json`, `bom1`), near the students and the speech service. When the student ends the session, the coach says "Okay, we will now generate your report based on this conversation." while the report is made.
- **Starting is quick:** the microphone and camera are asked for together, the reading screen opens straight away, and the voice detector loads in the background (its files are also downloaded early, while the student reads the set-up screen).
- **Words appear as they are spoken.** Chrome and Edge show their own live words at once, and nothing extra is asked of the speech service. In any other browser, the audio heard so far is sent for transcription every second. Groq's Whisper answers first (about a third of a second, with its own allowance); if it is out of allowance, Sarvam is used instead, limited to 40 requests a minute per server and backing off on errors, because Sarvam's pay-as-you-go plan allows only 60 requests a minute for the whole account. Set `GROQ_STT_PARTIALS=off` to use only Sarvam. During the reading, each passage word is underlined as soon as it is heard (green read, red skipped, orange not clear). A matcher that does not jump ahead keeps the underline steady. The saved transcript always comes from the accurate speech service, never from the live words. The speech service is asked for English letters; if it ever returns Hindi letters, it is asked again for Roman letters.
- **No "Are you done?".** The coach never decides by itself that an answer is finished, and never cuts in. The words stay on the screen, and the student taps the big **Next question** button (or says "next question"). After a few quiet seconds the button is pointed out ("Finished? Tap Next question."). A question to the coach is answered on its own.
- **Interrupting:** speaking over the coach stops the coach, who then listens (it needs the voice detector; turn it off in Settings if the speakers make the coach hear itself).
- **"Next question":** the button, or ending an answer with "next question", "that's all" or "I'm done", sends the answer and moves on at once. With no words at all, it skips the question. "Repeat the question" and "give me a hint" are done at once too.
- **Questions and interruptions:** the student can ask the coach anything, even if it is not about the lesson. The coach answers first, in simple words, and then goes back to the practice with one question.
- **Wait, let me think:** saying "wait", "hold on" or "let me think" makes the coach say one short line and then stay quiet for longer. The coach also waits longer when a sentence stops in the middle ("... because", "umm").
- **Speaking over the coach:** the coach stops and listens at once. With the accurate voice detector it uses that; without it, it listens to the loudness of the microphone. It can be turned off in Settings.
- **Any topic:** the coach follows the student's lead on any harmless topic (science, sport, careers, study advice, English words), practises speaking with them there, and offers to go back to the lesson later. It follows the module's seven questions in order and judges each answer against a note on what a strong answer contains.
- **Ending by voice:** saying "end the session", "I want to stop" or "give me my report" ends the session at once.
- **Coach voice:** Cartesia is used first. If it fails (no credit, a wrong key, too slow), the app uses **Sarvam's own voice** with the same Sarvam key, and does not ask Cartesia again for a few minutes. Only if both fail does the browser voice take over, and the reason is shown. **Settings, Test the coach's voice** says why the studio voice is not working (key, credit, or voice name).

## The feedback report

While the report is made, a **percentage and progress bar** show how far along it is. With the AI on, it usually takes about **3 seconds**.

When it reaches 100%, the report page opens with a header (name, module, a one-line summary and three tiles that show how each part went) and then **boxes**: **Reading**, **Conversation** and **Face and body**. The Reading box shows how much of the passage was read, a speed gauge (too slow, good, too fast), the parts that were skipped, the words to say more clearly with their word parts, and the passage itself with a green line under what was read, a red line under what was skipped and an orange line under what was not clear. In the Conversation box, each thing to fix names the question it was about. Every box says what went well, what to fix and **how to fix it**, in simple English. A **Download PDF** button gives the same report as a **one-page, black-and-white PDF**, made on the device. A link under it opens the next module to practise.

- **Reading:** which parts of the passage were **skipped**, where the student stopped, and each word that was **not said clearly** (the app heard a different word), with the word in parts (such as "pass-word"), what to change, and a **Hear it** button that says the word aloud. The words also change colour on the reading screen while the student reads (read, skipped, unclear).
- **Conversation:** what was wrong, the student's own words, and how to fix it, plus one "say it like this" example.
- **Face and body** (if the camera was on): how the student came across and how to improve, for example "You looked a little nervous: your eyebrows were raised in a worried way, you blinked a lot, you often looked down", "Your face looked tense" (brows pulled down or lips pressed, which can look serious or angry), unusual faces (a wink, puffed cheeks, tongue out), or "You looked relaxed and friendly". It also covers where the head and eyes were, posture and movement. These describe how the student **looked** to a listener, from the shape of the face and body, not what they felt. Each look must last more than a moment to count, and a person's resting face is allowed for. The limits are rough rules (`LOOK_LIMITS` in `src/features/vision/summarize.ts`) and have not been checked on many real faces.

Points about the reading and the numbers (fillers, pace, how much was read) come from the measurements, so they are always true. The AI's own points are checked too: empty praise such as "you answered every question" is never shown.

- **"Instead of this, say it like this"** takes sentences the student really said and shows a clearer way to say them. Every quote is checked against the transcript on the server, so the coach can never show something the student did not say.
- Nothing is uploaded: the PDF is made on the device.
- If the AI step fails, the report still shows the reading, the measured points and the camera.

<table>
  <tr>
    <td width="30%"><img src="docs/screenshots/15-making-report.png" alt="Making the report: a percentage and a progress bar"><br><sub>A percentage while the report is made.</sub></td>
    <td width="70%"><img src="docs/screenshots/07-report.png" alt="The short feedback report: reading and answering side by side"><br><sub>The short report.</sub></td>
  </tr>
</table>

## Your subject, your goal, your modules

The student chooses a **subject or specialization**, a **difficulty** and **what they want to improve** once, when they start. There is a different module for every subject, difficulty, goal and **age group** (**8 x 3 x 5 x 3 = 360 modules**), each with its own passage, its own kind of activity and its own questions. The age groups are **under 13**, **13 to 17** and **18 and older**: the level is about the English, and the age group changes the story, the examples and the tone (a class pet for children, school uniforms for teenagers, work from home for adults; an interview with a club leader, a school club or a campus placement). The **Library shows only the three that match the student's subject, goal and age group**, with their own level first, so nothing has to be chosen again. To change any of it, open **Profile** and tap a section. Everything then updates by itself. How the modules are written, and the rules the tests check, are in [docs/CONTENT-GUIDE.md](docs/CONTENT-GUIDE.md).

The coach asks questions **from easy to difficult**: questions 1 to 3 are warm-ups, 4 and 5 need a reason or an example, and from 6 on they ask for an opinion and a defence of it. The screen shows which kind of question it is.

While the student speaks, their words appear **live** on screen (from the browser's own speech recogniser). The accurate text from Sarvam replaces them a moment after the student stops, and that is the text that is saved and measured.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/16-profile.png" alt="Profile page: sections that open when tapped"><br><sub>Profile: tap a section to change it.</sub></td>
    <td width="50%"><img src="docs/screenshots/03-library.png" alt="Library showing only the student's subject"><br><sub>Library: only the student's subject.</sub></td>
  </tr>
</table>

Speech recognition and the coach's voice use **English (India)** only, so there is no accent setting to change.

## Progress and daily practice

Trends appear by themselves once there are two sessions to compare: filler words per 100 words, average answer length, practice minutes, a streak, and a recommendation for what to practise next.

<table>
  <tr>
    <td width="68%"><img src="docs/screenshots/11-progress.png" alt="Progress page with trends, charts and session history"></td>
    <td width="32%"><img src="docs/screenshots/12-mobile-dashboard.png" alt="Talkzy home screen on a phone"><br><sub>Works on phones.</sub></td>
  </tr>
</table>

More screens: [onboarding](docs/screenshots/01-onboarding.png), [library](docs/screenshots/03-library.png) and [start of a session](docs/screenshots/04-start-session.png).

## What it measures, and what it never claims

- **Measured:** speaking pace, pauses and thinking time, filler words, repeated words, answer length, word variety, reading accuracy.
- **AI assessment (live mode):** grammar, vocabulary, structure and relevance, always labelled as the AI's opinion.
- **Camera (optional, on the device only):** the look of the face (smiling, tense, worried, blinking, unusual faces), whether the face is in view, head direction, posture, hand and body movement. The video never leaves the device. The limits for each look are rough rules (see `LOOK_LIMITS` in `src/features/vision/summarize.ts`) and have not been checked on many real faces.
- Pronunciation is **not scored**. Spoken answers are sent to the speech service in word-for-word mode (`saaras:v3`, set with `SARVAM_VERBATIM=off` to turn it off) so that "umm" and "haa" are kept and counted. Filler counts are still a lower bound, because recognisers drop some.
- The camera feedback says how the student **looked** (for example nervous or tense). It never claims to know what they felt, how confident they are, or whether they are honest.

## Tech

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript**, **Tailwind CSS 4**, Zod for validation.
- **Voice in:** [Silero VAD](https://github.com/snakers4/silero-vad) in the browser finds each stretch of speech, and each segment is sent through the app's own server route to **Sarvam** speech-to-text. The browser's own recogniser is an automatic fallback.
- **Voice out:** **Cartesia Sonic** through a server route. The browser voice is the fallback.
- **AI:** **Groq** writes the coach's replies (`openai/gpt-oss-20b`, fast) and the report (`openai/gpt-oss-120b`, more accurate). Anthropic is an optional alternative.
- **Camera:** MediaPipe Face and Pose Landmarker, running on the device through WebAssembly. The models start loading as soon as the camera box is ticked, so they are ready when the session begins.
- **Report files:** jsPDF, in the browser.
- **Tests:** Vitest (5,524 unit tests, including checks of all 360 modules) and Playwright (37 end-to-end tests).
- **AI quality check:** `npm run eval` runs made-up sessions with planted mistakes through the real AI and marks the result. See [How well does the AI feedback work?](docs/EVALUATION.md).

API keys are read only by server code and never sent to the browser. A Content-Security-Policy (`connect-src 'self'`) stops the page contacting any outside server.

## Run it locally

You need **Node.js 20 or newer** and a recent **Chrome or Edge**.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

`npm install` also runs `npm run setup:vision`, which copies the MediaPipe runtime and downloads two small pretrained models (about 9 MB) and the Silero voice-detection files (about 17 MB). If the download fails the app still works, only without body-language analysis; run `npm run setup:vision` again to retry.

### Add your keys

Everything is optional. Without keys the app runs in a clearly labelled **development mode** (scripted coach, no AI report, browser voice).

```bash
cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
```

| Variable | Used for | Without it |
|---|---|---|
| `GROQ_API_KEY` | The coach's replies and the AI-written report | Development mode |
| `GROQ_CHAT_MODEL`, `GROQ_REPORT_MODEL` | Optional. Which Groq models talk and write the report (defaults: `openai/gpt-oss-20b` and `openai/gpt-oss-120b`) | The defaults |
| `SARVAM_API_KEY` | Speech-to-text for the student's voice | The browser's own recogniser |
| `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` | The coach's spoken voice | The browser's own voice |
| `ANTHROPIC_API_KEY` | Optional alternative to Groq | n/a |

Restart `npm run dev`, then open <http://localhost:3000/api/status>. With everything set it shows `{"mode":"live","llm":"groq","stt":"sarvam","tts":"cartesia"}`. Anything shown as `dev` or `browser` means that key is missing or misspelt. `.env.local` is git-ignored.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` and `npm start` | Production build and server |
| `npm run lint` and `npm run typecheck` | ESLint and TypeScript |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests against a production build, using mock voice and AI services. The first run needs `npx playwright install chromium`. |
| `npm run setup:vision` | Re-copy the camera and voice-detection files |

## Deploy to Vercel

1. Push the repository to GitHub and import it at [vercel.com/new](https://vercel.com/new). The framework is set to Next.js by `vercel.json`.
2. Add `GROQ_API_KEY`, `SARVAM_API_KEY`, `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` under **Settings → Environment Variables** (Production and Preview), then deploy.
3. If students see a Vercel login page, turn off **Vercel Authentication** under **Settings → Deployment Protection**.

The rate limiter is in memory and per server instance. Use a shared limiter if you expect heavy traffic.

## Privacy and minors

No accounts and no passwords: a display name only. Under-13s need a guardian's confirmation. The camera is opt-in each session. Raw audio and video are never stored. Students can turn off transcript saving, and can delete a session or all their data from Settings. Short speech clips go through the app's server to Sarvam to be turned into text and are then discarded. The app explains this before first use. Schools that deploy it should add their own consent process. See [docs/SECURITY.md](docs/SECURITY.md).

## Project layout

```
docs/                     Product, architecture, design, security, decisions and test plan
src/app/                  Pages (home, library, practice, report, progress, profile, settings, privacy) and API routes
src/components/           UI, including the reading and conversation screens
src/features/content/     8 subjects x 3 levels x 5 goals x 3 age groups = 360 modules (passage, key terms, questions easy to hard)
src/features/speech/      Speech metrics, reading alignment, voice timing, recognition and synthesis
src/features/vision/      On-device face and pose analysis
src/features/coach/       Prompts, dev-mode coach, quote checking, rule-based coaching
src/features/report/      The short report, and PDF and text export
evals/                    The AI quality check (made-up sessions, marking, results)
src/features/progress/    Daily limit, streaks, trends, recommendations
src/services/             Local storage, API client, hooks
tests/unit, tests/e2e     Vitest and Playwright
```

## Known limits

- Pronunciation is not scored, and the camera numbers describe geometry only. Camera accuracy on real people has not been validated.
- Chrome's own speech recogniser is covered by fakes in the tests, not by a real microphone.
- 24 passages means regular students will see content again, although the AI coach varies its questions.
- Data lives in each browser, with no sync between devices.
