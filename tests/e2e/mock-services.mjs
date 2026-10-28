// Local stand-ins for Sarvam (speech-to-text), Cartesia (text-to-speech) and Groq (LLM), so the
// end-to-end tests can exercise the cloud-voice path without real keys or network access.
// They check that OUR app sends correctly-shaped requests; they say nothing about the real services.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 3101);

const TRANSCRIPTS = [
  "A brand is the promise a company makes to its customers, and I think it matters because people buy from names they trust.",
  "For example my local bakery remembers every regular customer by name, so people keep coming back each morning before school.",
  "I would say a discount can help at first, but it can also make people think the product is worth less.",
  "In my opinion honest advertising works better because customers feel respected and tell their friends.",
];

const log = { stt: [], tts: [], chat: [] };
const state = { sttMode: "ok", sttCalls: 0 };

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** A short, valid mono 16-bit WAV (quiet tone) so the browser's <audio> can really play it. */
function tinyWav() {
  const rate = 16000;
  const n = Math.round(rate * 0.4);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 330) * 800), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/__log") return json(res, 200, log);
  if (req.method === "POST" && url.pathname === "/__reset") {
    log.stt = [];
    log.tts = [];
    log.chat = [];
    state.sttMode = "ok";
    state.sttCalls = 0;
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/__mode") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (body.stt) state.sttMode = body.stt;
    if (typeof body.sttCalls === "number") state.sttCalls = body.sttCalls;
    return json(res, 200, state);
  }
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });

  // ---- Sarvam: POST /speech-to-text (multipart) ----
  if (req.method === "POST" && url.pathname === "/speech-to-text") {
    const raw = await readBody(req);
    const text = raw.toString("latin1");
    const partial = req.headers["x-talkzy-purpose"] === "partial";
    // Words sent while the student is still speaking are not logged and do not use up a made-up transcript:
    // they get the first words of the transcript that comes next, so the test can see words appear before the final text.
    if (partial) {
      if (state.sttMode === "fail") return json(res, 500, { error: { message: "mock failure" } });
      const next = TRANSCRIPTS[state.sttCalls % TRANSCRIPTS.length];
      return json(res, 200, { request_id: "mock", transcript: next.split(" ").slice(0, 7).join(" "), language_code: "en-IN" });
    }
    log.stt.push({
      apiKey: req.headers["api-subscription-key"],
      bytes: raw.length,
      hasWav: text.includes("RIFF"),
      languageCode: /name="language_code"\r\n\r\n([^\r]+)/.exec(text)?.[1],
      keyterms: /name="keyterms"\r\n\r\n([^\r]+)/.exec(text)?.[1],
    });
    if (state.sttMode === "fail") return json(res, 500, { error: { message: "mock failure" } });
    // A short reply to "Are you done?" (the app sends the command words as hints): the student says yes.
    if ((log.stt.at(-1)?.keyterms ?? "").includes("move on")) return json(res, 200, { request_id: "mock", transcript: "Yes, move on.", language_code: "en-IN" });
    // A slow speech service: the accurate transcript only arrives some seconds after the student stops.
    if (state.sttMode === "slow") await new Promise((r) => setTimeout(r, 7000));
    const transcript = TRANSCRIPTS[state.sttCalls++ % TRANSCRIPTS.length];
    return json(res, 200, { request_id: "mock", transcript, language_code: "en-IN" });
  }

  // ---- Groq Whisper: POST /audio/transcriptions (the quick words shown while the student is still speaking) ----
  if (req.method === "POST" && url.pathname === "/audio/transcriptions") {
    await readBody(req);
    if (state.sttMode === "fail") {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
      return res.end(JSON.stringify({ error: { message: "mock: out of allowance" } }));
    }
    const next = TRANSCRIPTS[state.sttCalls % TRANSCRIPTS.length];
    return json(res, 200, { text: ` ${next.split(" ").slice(0, 7).join(" ")}` });
  }

  // ---- Cartesia: POST /tts/bytes ----
  if (req.method === "POST" && url.pathname === "/tts/bytes") {
    const body = JSON.parse((await readBody(req)).toString());
    log.tts.push({
      authorization: req.headers["authorization"],
      version: req.headers["cartesia-version"],
      model: body.model_id,
      voiceId: body.voice?.id,
      container: body.output_format?.container,
      transcript: String(body.transcript).slice(0, 80),
    });
    res.writeHead(200, { "content-type": "audio/wav" });
    return res.end(tinyWav());
  }

  // ---- Groq: POST /chat/completions (OpenAI-compatible) ----
  if (req.method === "POST" && url.pathname === "/chat/completions") {
    const body = JSON.parse((await readBody(req)).toString());
    const system = body.messages?.[0]?.content ?? "";
    const userText = body.messages?.[1]?.content ?? "";
    const isReport = system.includes("post-session feedback report");
    log.chat.push({
      authorization: req.headers["authorization"],
      model: body.model,
      reasoning_effort: body.reasoning_effort,
      include_reasoning: body.include_reasoning,
      isReport,
    });

    if (!isReport) {
      return json(res, 200, { choices: [{ message: { content: "That is a thoughtful point. Can you give me an example from your own life?" } }] });
    }

    // Quote the first real student answer verbatim, plus one made-up quote that the server must drop.
    const answer = /Student answer 1 \([^)]*\): (.+)/.exec(userText)?.[1] ?? "";
    const realQuote = answer.split(" ").slice(0, 7).join(" ");
    const report = {
      headline: "You explained your ideas clearly today.",
      strengths: [{ title: "Clear main point", detail: "You started with your idea.", quote: realQuote }],
      improvements: [{ title: "Add examples", detail: "A real example makes it stronger.", quote: "this sentence was never spoken by the student", tip: "Add one real-life example to each answer." }],
      grammar: [{ quote: "an invented grammar mistake", issue: "none", suggestion: "none" }],
      vocabulary: { summary: "Good everyday vocabulary.", upgrades: [] },
      structure: { summary: "Answers were mostly well organised.", perAnswer: [{ answerNumber: 1, relevance: 4, completeness: 3, organization: 4, comment: "Clear." }] },
      reading: { summary: "You read the passage steadily.", wentWell: ["You took your time."], improve: [{ issue: "Rushed the last lines", howTo: "Pause at each full stop." }] },
      exercises: [{ title: "One-minute talk", instructions: "Talk about brands for one minute.", minutes: 3 }],
      nextSessionFocus: "Add an example to every answer.",
    };
    return json(res, 200, { choices: [{ message: { content: JSON.stringify(report) } }] });
  }

  json(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`[mock-services] listening on ${PORT}`));
