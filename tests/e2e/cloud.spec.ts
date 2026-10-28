import { expect, test } from "@playwright/test";
import { findModule } from "../../src/features/content/modules";
import { completeOnboarding } from "./helpers";

// Cloud mode: Silero VAD (real, in the browser) + Sarvam speech-to-text + Cartesia voice + Groq LLM.
// The three services are local mocks (tests/e2e/mock-services.mjs), and the "microphone" plays a
// looped recording of real synthesised speech. So this verifies that OUR code detects speech,
// uploads segments, sends correctly-shaped requests to each service and uses the answers; it does
// not prove the real Sarvam, Cartesia or Groq services behave the same way.
const MOCK = "http://localhost:3101";

test.beforeEach(async ({ request, page }) => {
  await request.post(`${MOCK}/__reset`);
  // The test microphone makes a steady sound, so letting it interrupt the coach would cut every message short.
  await page.addInitScript(() => {
    localStorage.setItem("acc.v1.settings", JSON.stringify({ cameraDefault: false, keepTranscripts: true, speechRate: 0.95, coachVoice: true, bargeIn: false, speechLang: "en-IN" }));
  });
});

async function startPractice(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  // The page has finished checking the services, and it names no outside service to the student.
  await expect(page.getByRole("button", { name: "Begin" })).toBeEnabled();
  await expect(page.getByText(/Sarvam|Cartesia|Groq/i)).toHaveCount(0);
}

test("status reports cloud services without exposing keys", async ({ request }) => {
  const res = await request.get("/api/status");
  expect(await res.json()).toEqual({ mode: "live", llm: "groq", stt: "sarvam", tts: "cartesia" });
});

test("cloud voice journey: VAD + Sarvam + Cartesia + Groq, AI report with verified quotes", async ({ page, request }) => {
  const browserRequests: string[] = [];
  page.on("request", (r) => browserRequests.push(r.url()));

  await completeOnboarding(page);
  await expect(page.getByText(/Development mode/)).toHaveCount(0);
  await startPractice(page);
  await page.getByRole("button", { name: "Begin" }).click();

  // Reading phase (voice detection loads in the background of Begin).
  await expect(page.getByLabel("Reading passage")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /start conversation/i }).click({ timeout: 70_000 });

  // Coach speaks through Cartesia; student speech is found by Silero and transcribed by Sarvam.
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya");
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 30_000 });
  // Whatever the reading used up, the answers start from the first made-up transcript again.
  await request.post(`${MOCK}/__mode`, { data: { sttCalls: 0 } });
  await expect(page.getByTestId("live-transcript")).toContainText(/A brand is the promise a company makes/, { timeout: 60_000 });

  // The coach waits for the student: "Next question" sends the answer, and the Groq coach asks a follow-up that is spoken again.
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByTestId("coach-message")).toContainText("Can you give me an example from your own life", { timeout: 60_000 });

  // A second spoken answer, then end the session from the always-visible top bar.
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("live-transcript")).toContainText(/my local bakery/, { timeout: 60_000 });
  // End while this second answer is still in progress: it must be kept, not thrown away.
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });

  // The report page: the AI's headline, what went well and what to fix in the conversation box, and the camera line.
  const report = page.getByTestId("report");
  await expect(report).toBeVisible();
  await expect(page.getByTestId("report-headline")).toContainText("You explained your ideas clearly today.");
  const conversation = page.getByTestId("conversation-box").locator("xpath=ancestor::section");
  await expect(conversation.getByText("You started with your idea.")).toBeVisible();
  await expect(conversation.getByText("Add examples")).toBeVisible();
  await expect(conversation.getByText("Add one real-life example to each answer.")).toBeVisible();
  await expect(page.getByTestId("camera-box").locator("xpath=ancestor::section")).toContainText(/camera was off/i);
  await expect(page.getByText(/AI-written|Development mode/)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain("this sentence was never spoken by the student"); // fabricated quote dropped
  expect(html).not.toContain("an invented grammar mistake");

  // Measurements came from VAD segments (real speech timing), not from typed answers.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  expect(stored.mode).toBe("live");
  expect(stored.report.ai.strengths[0].quote).toContain("A brand is the promise a company"); // the real quote was kept
  expect(stored.speech.voiceTurns).toBeGreaterThanOrEqual(2);
  expect(stored.speech.speakingSec).toBeGreaterThan(3);
  expect(stored.turns.filter((t: { inputMode?: string }) => t.inputMode === "voice").length).toBeGreaterThanOrEqual(2);

  // What each service actually received.
  const log = await (await request.get(`${MOCK}/__log`)).json();
  expect(log.stt.length).toBeGreaterThanOrEqual(2);
  expect(log.stt[0]).toMatchObject({ apiKey: "test-sarvam", hasWav: true, languageCode: "en-IN" });
  // The reading's own key terms are sent to Sarvam as recognition hints.
  expect(JSON.parse(log.stt[0].keyterms)).toEqual(findModule("business-marketing", "intermediate", "clarity", "18plus")!.keyTerms);
  expect(log.tts.length).toBeGreaterThanOrEqual(2);
  expect(log.tts[0]).toMatchObject({ authorization: "Bearer test-cartesia", model: "sonic-3.6", voiceId: "test-voice-id", container: "mp3" });
  const chats = log.chat as { model: string; reasoning_effort: string; include_reasoning: boolean; isReport: boolean; authorization: string }[];
  expect(chats.filter((c) => !c.isReport).every((c) => c.model === "openai/gpt-oss-20b")).toBe(true); // conversation: smaller, faster model
  expect(chats.filter((c) => c.isReport).every((c) => c.model === "openai/gpt-oss-120b")).toBe(true); // report: larger, more accurate model
  expect(chats.every((c) => c.include_reasoning === false && c.authorization === "Bearer test-groq")).toBe(true);
  expect(chats.find((c) => !c.isReport)?.reasoning_effort).toBe("low");
  expect(chats.find((c) => c.isReport)?.reasoning_effort).toBe("low");

  // The browser only ever talked to this app, never to a service directly (keys stay on the server).
  const direct = browserRequests.filter((u) => u.includes(":3101") || /sarvam|cartesia|groq/i.test(u));
  expect(direct).toEqual([]);
});

test("cloud speech failure never dead-ends: falls back or offers retry, typing and End always work", async ({ page, request }) => {
  await request.post(`${MOCK}/__mode`, { data: { stt: "fail" } });
  await completeOnboarding(page);
  await startPractice(page);
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByLabel("Reading passage")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /start conversation/i }).click({ timeout: 70_000 });
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 30_000 });

  // Two failed segments in a row: the app tells the student and keeps going.
  await expect(page.getByText(/voice service had trouble|voice connection was interrupted|Voice answers are paused/i).first()).toBeVisible({ timeout: 90_000 });

  // Typing still works, and the session can be ended at any time.
  if (!(await page.getByLabel("Type your answer").isVisible())) await page.getByRole("button", { name: "Type instead" }).click();
  await page.getByLabel("Type your answer").fill("A brand is the promise a company makes to its customers every single day.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByTestId("coach-message")).toContainText("Can you give me an example", { timeout: 60_000 });
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Your feedback report" })).toBeVisible();
});

test("words appear while you speak, before the accurate transcript arrives, with no browser recogniser needed", async ({ page, request }) => {
  // The speech service answers 7 seconds late for a finished stretch of speech. The first words of what is being said are
  // sent while the student is still speaking, and those come back at once.
  await request.post(`${MOCK}/__mode`, { data: { stt: "slow" } });
  await completeOnboarding(page);
  await startPractice(page);
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByLabel("Reading passage")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /start conversation/i }).click({ timeout: 70_000 });
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 30_000 });
  // Whatever the reading used up, the answer starts from the first made-up transcript again.
  await request.post(`${MOCK}/__mode`, { data: { sttCalls: 0 } });

  const live = page.getByTestId("live-transcript");
  await expect(live).toContainText("A brand is the promise a company", { timeout: 60_000 });
  // The accurate transcript replaces the first words once it arrives, and it is longer.
  await expect(live).toContainText(/matters because people buy from names they trust/, { timeout: 60_000 });
});

test("the check page finds everything working with the fake microphone and the test services", async ({ page }) => {
  await page.goto("/check");
  await page.getByRole("button", { name: "Run the check" }).click();
  await expect(page.getByTestId("check-summary")).toBeVisible({ timeout: 90_000 });
  for (const id of ["server", "ai", "storage", "mic", "vad", "stt", "tts"]) {
    await expect(page.getByTestId(`check-${id}`), id).toHaveAttribute("data-state", "ok");
  }
  await expect(page.getByTestId("check-summary")).toContainText("Everything works");
});
