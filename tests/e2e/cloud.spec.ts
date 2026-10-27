import { expect, test } from "@playwright/test";
import { getModule } from "../../src/features/content/modules";
import { completeOnboarding } from "./helpers";

// Cloud mode: Silero VAD (real, in the browser) + Sarvam speech-to-text + Cartesia voice + Groq LLM.
// The three services are local mocks (tests/e2e/mock-services.mjs), and the "microphone" plays a
// looped recording of real synthesised speech. So this verifies that OUR code detects speech,
// uploads segments, sends correctly-shaped requests to each service and uses the answers; it does
// not prove the real Sarvam, Cartesia or Groq services behave the same way.
const MOCK = "http://localhost:3101";

test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__reset`);
});

async function startPractice(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await expect(page.getByText(/Sarvam AI/).first()).toBeVisible(); // honest data-flow wording for cloud speech
}

test("status reports cloud services without exposing keys", async ({ request }) => {
  const res = await request.get("/api/status");
  expect(await res.json()).toEqual({ mode: "live", llm: "groq", stt: "sarvam", tts: "cartesia" });
});

test("cloud voice journey: VAD + Sarvam + Cartesia + Groq, AI report with verified quotes", async ({ page, request }) => {
  const browserRequests: string[] = [];
  page.on("request", (r) => browserRequests.push(r.url()));

  await completeOnboarding(page);
  await expect(page.getByText(/Development mode: no AI key configured/)).toHaveCount(0);
  await startPractice(page);
  await page.getByRole("button", { name: "Begin" }).click();

  // Reading phase (voice detection loads in the background of Begin).
  await expect(page.getByLabel("Reading passage")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /finished reading/ }).click();

  // Coach speaks through Cartesia; student speech is found by Silero and transcribed by Sarvam.
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya");
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("live-transcript")).toContainText(/A brand is the promise a company makes/, { timeout: 60_000 });

  // The Groq coach answers with a follow-up that is spoken again.
  await expect(page.getByTestId("coach-message")).toContainText("Can you give me an example from your own life", { timeout: 60_000 });

  // A second spoken answer, then end the session from the always-visible top bar.
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("live-transcript")).toContainText(/my local bakery/, { timeout: 60_000 });
  // End while this second answer is still in progress: it must be kept, not thrown away.
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });

  // AI-written report: reading + answers + camera sections, quotes verified against the transcript.
  await expect(page.getByText("AI-written feedback").first()).toBeVisible();
  await expect(page.getByText("You explained your ideas clearly today.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /1\. How you did while reading/ })).toBeVisible();
  await expect(page.getByText("You read the passage steadily.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /2\. How you did while answering/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /3\. Camera/ })).toBeVisible();
  await expect(page.getByText(/camera was off/i)).toBeVisible();
  await expect(page.getByText("A brand is the promise a company").first()).toBeVisible(); // real quote kept
  const html = await page.content();
  expect(html).not.toContain("this sentence was never spoken by the student"); // fabricated quote dropped
  expect(html).not.toContain("an invented grammar mistake");

  // Measurements came from VAD segments (real speech timing), not from typed answers.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  expect(stored.mode).toBe("live");
  expect(stored.speech.voiceTurns).toBeGreaterThanOrEqual(2);
  expect(stored.speech.speakingSec).toBeGreaterThan(3);
  expect(stored.turns.filter((t: { inputMode?: string }) => t.inputMode === "voice").length).toBeGreaterThanOrEqual(2);

  // What each service actually received.
  const log = await (await request.get(`${MOCK}/__log`)).json();
  expect(log.stt.length).toBeGreaterThanOrEqual(2);
  expect(log.stt[0]).toMatchObject({ apiKey: "test-sarvam", hasWav: true, languageCode: "en-IN" });
  // The reading's own key terms are sent to Sarvam as recognition hints.
  expect(JSON.parse(log.stt[0].keyterms)).toEqual(getModule("business-marketing-intermediate")!.keyTerms);
  expect(log.tts.length).toBeGreaterThanOrEqual(2);
  expect(log.tts[0]).toMatchObject({ authorization: "Bearer test-cartesia", model: "sonic-3.6", voiceId: "test-voice-id", container: "mp3" });
  const chats = log.chat as { model: string; reasoning_effort: string; include_reasoning: boolean; isReport: boolean; authorization: string }[];
  expect(chats.every((c) => c.model === "openai/gpt-oss-120b" && c.include_reasoning === false && c.authorization === "Bearer test-groq")).toBe(true);
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
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /finished reading/ }).click();
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
