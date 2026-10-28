import { expect, test } from "@playwright/test";

const validTurn = {
  moduleId: "computer-science-beginner",
  goal: "clarity",
  level: "beginner",
  ageBand: "13to17",
  remainingSec: 300,
  event: "answer",
  history: [
    { role: "coach", text: "What is a program?" },
    { role: "student", text: "A list of instructions for a computer to follow step by step." },
  ],
};

test("status reports development mode without an API key and never leaks secrets", async ({ request }) => {
  const res = await request.get("/api/status");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ mode: "dev", llm: null, stt: "browser", tts: "browser" });
});

test("coach turn: valid request gets a labelled scripted reply", async ({ request }) => {
  const res = await request.post("/api/coach/turn", { data: validTurn });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.mode).toBe("dev");
  expect(typeof body.text).toBe("string");
  expect(body.text.length).toBeGreaterThan(10);
});

test("coach turn: invalid, oversized and wrongly-typed requests are rejected", async ({ request }) => {
  expect((await request.post("/api/coach/turn", { data: { ...validTurn, goal: "hack" } })).status()).toBe(400);
  expect((await request.post("/api/coach/turn", { data: { ...validTurn, moduleId: "nope" } })).status()).toBe(404);
  const huge = { ...validTurn, history: [{ role: "student", text: "x".repeat(300_000) }] };
  expect((await request.post("/api/coach/turn", { data: huge })).status()).toBe(413);
  const wrongType = await request.post("/api/coach/turn", { headers: { "content-type": "text/plain" }, data: "hello" });
  expect(wrongType.status()).toBe(415);
  const badJson = await request.post("/api/coach/turn", { headers: { "content-type": "application/json" }, data: "{not json" });
  expect(badJson.status()).toBe(400);
});

test("report route in dev mode says AI feedback is unavailable instead of inventing any", async ({ request }) => {
  const res = await request.post("/api/coach/report", {
    data: {
      moduleId: "computer-science-beginner",
      goal: "clarity",
      level: "beginner",
      ageBand: "13to17",
      turns: [{ role: "student", text: "hello there", inputMode: "typed" }],
      speech: {
        voiceTurns: 0, typedTurns: 1, totalWords: 2, voiceWords: 0, speakingSec: 0, wpm: null, fillerCount: 0, fillerPer100: null,
        fillers: [], repetitionCount: 0, repetitions: [], pauseCount: 0, longestPauseSec: 0, avgLatencySec: null, avgAnswerWords: 2,
        uniqueWords: 2, lexicalVariety: null, longWordPct: null,
      },
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ai).toBeNull();
  expect(body.reason).toMatch(/Development mode/);
});

test("rate limiting kicks in on rapid repeated calls", async ({ request }) => {
  let limited = 0;
  for (let i = 0; i < 60; i++) {
    // A distinct client address keeps this from exhausting the shared bucket other tests use.
    const r = await request.post("/api/coach/turn", { data: validTurn, headers: { "x-forwarded-for": "203.0.113.77" } });
    if (r.status() === 429) limited++;
  }
  expect(limited).toBeGreaterThan(0);
});
