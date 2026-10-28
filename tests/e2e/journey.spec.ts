import { expect, test } from "@playwright/test";
import { findModule, modulesForProfile } from "../../src/features/content/modules";
import { beginReadingAndConverse, completeOnboarding, completeTypedSession, mockSpeech, profileJson, seedSession } from "./helpers";

const VOICE_ANSWERS = [
  "A brand is the promise a company makes to its customers, and I think it matters because people buy from names they trust every single day.",
  "For example my local bakery remembers every regular customer by name, so people keep coming back to buy bread there each morning before school.",
  "I would say a discount can help at first, but it can also make people think the product is worth less, so brands must be careful with it.",
  "My opinion is that honest advertising works better because customers feel respected, and they tell their friends about the brand they trust.",
  "Teaching a younger student, I would say a brand is like a reputation, the feeling people have when they hear a company name every day.",
  "To sum up, a strong brand needs a clear promise, honest behaviour and steady quality, which together build trust with customers over many years.",
  "That is all I wanted to say about the topic today because I think the main ideas are clear to me now and I can explain them well.",
];

test("age gate: under-13 needs guardian confirmation", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("First name or nickname").fill("Kiran");
  await page.getByRole("radio", { name: /Under 13/ }).check();
  await page.getByLabel(/I have read how my voice/).check();
  await page.getByRole("button", { name: "Save and start" }).click();
  await expect(page.getByText("A parent or guardian must agree before you can use the app.")).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel(/My parent or guardian has read/).check();
  await page.getByRole("button", { name: "Save and start" }).click();
  await expect(page.getByRole("heading", { name: "Hi Kiran!" })).toBeVisible();
});

test("emojis cannot be typed in the name, and the dashboard greeting has no subject line", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/onboarding/);
  const nameInput = page.getByLabel("First name or nickname");
  await nameInput.fill("Arpita 😀🔥");
  await expect(nameInput).toHaveValue("Arpita ");
  await page.getByRole("radio", { name: /18 or older/ }).check();
  await page.getByLabel(/I have read how my voice/).check();
  await page.getByRole("button", { name: "Save and start" }).click();
  await expect(page.getByRole("heading", { name: "Hi Arpita!" })).toBeVisible();
  await expect(page.getByText("School & Everyday Topics")).toHaveCount(0);
});

/**
 * What the fake recogniser "hears", one entry each time the app starts listening: the reading (the whole passage, so the
 * reading ends by itself), then one entry for each time the student speaks: an answer, or the reply "Yes." to the coach's
 * "Are you done?" (which she asks after the student stops). An answer that ends with "next question" is not asked about.
 */
const PASSAGE = findModule("business-marketing", "intermediate", "clarity", "18plus")!.passage.replace(/\n\n/g, " ");
const VOICE_SCRIPT = [PASSAGE, VOICE_ANSWERS[0], "Yes.", `${VOICE_ANSWERS[1]} Next question.`, VOICE_ANSWERS[2], "Yes.", "I want to end the session."];

const spokenByCoach = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test("full voice journey with mocked speech APIs: read, converse, report, history", async ({ page }) => {
  test.setTimeout(240_000);
  await mockSpeech(page, VOICE_SCRIPT);
  await completeOnboarding(page);

  // Dashboard recommends a marketing module (personalised to the chosen field).
  await expect(page.getByText("Recommended for you")).toBeVisible();
  await expect(page.getByText(/Development mode/)).toHaveCount(0);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();

  // Setup -> permissions -> reading.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByLabel("Reading passage")).toBeVisible();
  await expect(page.getByLabel("Reading passage")).toContainText(/brand|customer|market/i);
  // Phase 1: the buttons are at the top of the page. Start reading, then (when the passage is read, or with Finish reading) Start conversation.
  await expect(page.getByText("Phase 1 of 2: Reading")).toBeVisible();
  const actions = page.getByTestId("reading-actions");
  await expect(actions.getByRole("button", { name: "Start reading", exact: true })).toBeVisible();
  expect((await actions.boundingBox())!.y).toBeLessThan(120);
  await actions.getByRole("button", { name: "Start reading", exact: true }).click();
  await expect(actions.getByRole("button", { name: "Finish reading" })).toBeVisible();
  await expect(page.locator("[data-status=read]").first()).toBeVisible({ timeout: 15_000 });
  // The whole passage was read, so the reading finishes and the conversation waits for its own button.
  await expect(actions.getByRole("button", { name: "Start conversation", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("reading-hint")).toContainText(/You read \d+% of the passage/);
  await actions.getByRole("button", { name: "Start conversation", exact: true }).click();

  // The coach speaks (TTS called) and the student answers by "voice".
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya", { timeout: 30_000 });
  await expect(page.getByText("Phase 2 of 2: Conversation")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBeGreaterThan(0);
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("live-transcript")).toContainText(/A brand is the promise/i, { timeout: 15_000 });

  // When the student stops, the coach asks "Are you done?". The student says "Yes.", and the coach moves on.
  await expect.poll(async () => (await spokenByCoach(page)).filter((t) => /Are you done/.test(t)).length, { timeout: 30_000 }).toBe(1);
  await expect(page.getByTestId("coach-message")).not.toContainText("Hi Riya", { timeout: 30_000 });
  // The second answer ends with the words "next question", so it moves on without being asked. The third is checked with "Are you done?" again.
  await expect(page.getByTestId("live-transcript")).toContainText(/my local bakery/i, { timeout: 30_000 });
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("live-transcript")).toContainText(/discount can help/i, { timeout: 40_000 });
  await expect.poll(async () => (await spokenByCoach(page)).filter((t) => /Are you done/.test(t)).length, { timeout: 30_000 }).toBe(2);
  // Then the student asks to end the session, which opens the report.
  await page.waitForURL(/\/report\//, { timeout: 120_000 });

  // The report page: coloured boxes for reading, conversation and face and body, and a download button. No "practise next" link.
  await expect(page.getByTestId("report")).toBeVisible();
  await expect(page.getByTestId("reading-box")).toBeVisible();
  await expect(page.getByTestId("conversation-box")).toBeVisible();
  await expect(page.getByTestId("camera-box").locator("xpath=ancestor::section")).toContainText(/camera was off/i);
  await expect(page.getByRole("button", { name: "Download PDF" }).first()).toBeVisible();
  await expect(page.getByText(/Practise next/)).toHaveCount(0);
  for (const gone of [/Development mode/, /AI-written feedback/, /This was a short session/, /See the full report/, /How these results were measured/, /All the numbers/, /More detail/]) {
    await expect(page.getByText(gone)).toHaveCount(0);
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  const answers = stored.turns.filter((t: { role: string }) => t.role === "student");
  expect(answers).toHaveLength(3);
  expect(answers[1].text).not.toMatch(/next question/i); // the command is not part of the answer

  // History and progress.
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Session history" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open report" })).toHaveCount(1);
});

test("saying 'I want to end the session' ends it straight away", async ({ page }) => {
  // The reading, one answer sent with the button, and then the request to end.
  await mockSpeech(page, [PASSAGE, VOICE_ANSWERS[0], "I want to end the session."]);
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await expect(page.getByTestId("live-transcript")).toContainText(/A brand is the promise/i, { timeout: 40_000 });
  await page.getByRole("button", { name: "Next question" }).click();
  await page.waitForURL(/\/report\//, { timeout: 40_000 });
  await expect(page.getByTestId("report")).toBeVisible();
  // The coach said that the report is being made, before it opened.
  await expect
    .poll(async () => (await spokenByCoach(page)).filter((t) => /we will end the session now and generate your report based on this conversation/i.test(t)).length, { timeout: 15_000 })
    .toBe(1);
  // The answer already given is kept, and the end request is not counted as an answer.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  expect(stored.turns.filter((t: { role: string }) => t.role === "student")).toHaveLength(1);
});

test("ending an answer with 'next question' moves on at once, without asking 'Are you done?'", async ({ page }) => {
  await mockSpeech(page, [PASSAGE, "A brand is the promise a company makes to its customers. Next question.", "I want to end the session."]);
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya", { timeout: 40_000 });
  await expect(page.getByTestId("coach-message")).not.toContainText("Hi Riya", { timeout: 40_000 }); // the coach asked the next question
  await page.waitForURL(/\/report\//, { timeout: 40_000 });
  expect((await spokenByCoach(page)).filter((t) => /Are you done/.test(t))).toHaveLength(0);
  // The answer is kept without the command at its end.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  const answers = stored.turns.filter((t: { role: string }) => t.role === "student");
  expect(answers).toHaveLength(1);
  expect(answers[0].text).not.toMatch(/next question/i);
});

test("when the student stops, the coach asks 'Are you done?' and 'yes' moves to the next question", async ({ page }) => {
  await mockSpeech(page, [PASSAGE, VOICE_ANSWERS[0], "Yes.", "I want to end the session."]);
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await expect(page.getByTestId("live-transcript")).toContainText(/A brand is the promise/i, { timeout: 40_000 });
  // The coach asks, in words and on the screen, and the question has not changed yet.
  await expect(page.getByTestId("coach-prompt")).toHaveText("Are you done?", { timeout: 30_000 });
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya");
  // "Yes." sends the answer and the coach asks the next question.
  await expect(page.getByTestId("coach-message")).not.toContainText("Hi Riya", { timeout: 30_000 });
  await page.waitForURL(/\/report\//, { timeout: 40_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  const answers = stored.turns.filter((t: { role: string }) => t.role === "student");
  expect(answers).toHaveLength(1); // the "Yes." is not an answer
  expect(answers[0].text).toContain("A brand is the promise");
});

test("'No, I want to say more' keeps the answer going, and both parts are sent together", async ({ page }) => {
  test.setTimeout(180_000);
  await mockSpeech(page, [PASSAGE, VOICE_ANSWERS[0], "No, I want to say more.", "Also trust takes many years to build for any brand.", "Yes.", "I want to end the session."]);
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await expect.poll(async () => (await spokenByCoach(page)).filter((t) => /Are you done/.test(t)).length, { timeout: 40_000 }).toBe(1);
  // She says she is listening, the student adds more, and she asks again before moving on.
  await expect.poll(async () => (await spokenByCoach(page)).filter((t) => /I am listening/.test(t)).length, { timeout: 40_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("live-transcript")).toContainText(/trust takes many years/i, { timeout: 40_000 });
  await expect.poll(async () => (await spokenByCoach(page)).filter((t) => /move to the next question/.test(t)).length, { timeout: 60_000 }).toBe(1);
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  const answers = stored.turns.filter((t: { role: string }) => t.role === "student");
  expect(answers).toHaveLength(1);
  expect(answers[0].text).toContain("A brand is the promise");
  expect(answers[0].text).toContain("trust takes many years");
});

test("a question to the coach is answered at once, even when it is not about the lesson", async ({ page }) => {
  await mockSpeech(page, [PASSAGE, "What does promise mean?", "I want to end the session."]);
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya", { timeout: 40_000 });
  await expect(page.getByTestId("coach-message")).not.toContainText("Hi Riya", { timeout: 40_000 });
  await page.waitForURL(/\/report\//, { timeout: 40_000 });
  expect((await spokenByCoach(page)).filter((t) => /Are you done/.test(t))).toHaveLength(0);
});

test("saying 'wait, let me think' makes the coach wait quietly instead of asking anything new", async ({ page }) => {
  await mockSpeech(page, [PASSAGE, "Wait, let me think.", "I want to end the session."]);
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya", { timeout: 40_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.filter((t) => /take your time/i.test(t)).length), { timeout: 40_000 }).toBeGreaterThan(0);
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  // Only the opening message: the coach asked nothing new, and "wait" was not counted as an answer.
  expect(stored.turns.filter((t: { role: string }) => t.role === "coach")).toHaveLength(1);
  expect(stored.turns.filter((t: { role: string }) => t.role === "student")).toHaveLength(0);
});

test("Next question works without saying anything: the coach moves to the next question", async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: /start conversation/i }).click();
  await expect(page.getByText(/Your turn/)).toBeVisible({ timeout: 30_000 });
  const first = await page.getByTestId("coach-message").innerText();
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByTestId("coach-message")).not.toHaveText(first, { timeout: 30_000 });
});

test("saying 'end the session' while answering also ends it", async ({ page }) => {
  await mockSpeech(page, [PASSAGE, "Please end the session now."]);
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await page.waitForURL(/\/report\//, { timeout: 40_000 });
  await expect(page.getByTestId("report")).toBeVisible();
});

test("microphone denied: graceful typed fallback, session still completes", async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await page.getByRole("button", { name: "Begin" }).click();
  // Headless Chromium has no microphone, so permission handling takes the fallback path.
  await expect(page.getByText(/microphone/i).first()).toBeVisible();
  // Two-phase structure: Phase 1 is reading the passage on screen.
  await expect(page.getByText("Phase 1 of 2: Reading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Read this out loud" })).toBeVisible();
  await page.getByRole("button", { name: /start conversation/i }).click();
  await expect(page.getByText(/type your answers/i).first()).toBeVisible();
  await expect(page.getByLabel("Type your answer")).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
  // Nothing was said, so the report says so in one plain sentence, with no warning boxes.
  await expect(page.getByTestId("report-headline")).toContainText(/did not hear any answers/i);
  await expect(page.getByText("This was a short session")).toHaveCount(0);
});

test("daily 20-minute limit blocks a new session", async ({ page }) => {
  const now = Date.now();
  const session = seedSession({ startedAt: now - 60_000, durationSec: 18 * 60 });
  await page.addInitScript(
    ([p, s]) => {
      localStorage.setItem("acc.v1.profile", p);
      localStorage.setItem("acc.v1.sessions", s);
    },
    [JSON.stringify(profileJson), JSON.stringify([session])],
  );
  await page.goto("/");
  await expect(page.getByText(/Less than 5 minutes are left|20-minute practice limit/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Start today.s practice/ })).toHaveCount(0);
  await page.goto("/practice/business-marketing-intermediate");
  await expect(page.getByRole("heading", { name: /enough practice for today/i })).toBeVisible();
});

test("typed session saves, the report is in boxes, the PDF is one black-and-white page, and privacy controls delete it", async ({ page }) => {
  await completeOnboarding(page);
  await completeTypedSession(page);

  // The report page: boxes for reading, conversation and face and body.
  await expect(page.getByTestId("report")).toBeVisible();
  await expect(page.getByTestId("reading-box")).toBeVisible();
  await expect(page.getByTestId("conversation-box")).toBeVisible();
  await expect(page.getByTestId("camera-box")).toBeVisible();
  expect((await page.getByTestId("report").innerText()).split(/\s+/).length).toBeLessThan(320); // short: about one page

  // Download: one page, black and white (a real PDF made on the device).
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).first().click()]);
  expect(pdf.suggestedFilename()).toMatch(/^talkzy-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdfStream = await pdf.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of pdfStream) chunks.push(c as Buffer);
  const pdfBytes = Buffer.concat(chunks);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfBytes.length).toBeGreaterThan(2000);
  const pages = (pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(1);
  await expect(page.getByRole("button", { name: "Download as text" })).toHaveCount(0);

  // Delete this single report from the Progress page.
  await page.goto("/progress");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Nothing here yet")).toBeVisible();

  // Delete everything returns to onboarding with storage cleared.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await page.waitForURL(/\/onboarding/);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("acc.v1.")));
  expect(keys).toEqual([]);
});

test("the report shows what was skipped and which words were not clear, with how to say them", async ({ page }) => {
  const now = Date.now();
  const base = seedSession({ startedAt: now - 3_600_000, durationSec: 600 });
  const session = {
    ...base,
    reading: {
      mode: "aloud",
      durationSec: 90,
      aloud: {
        accuracyPct: 78,
        coveragePct: 72,
        wpm: 120,
        spokenWordCount: 90,
        missedWords: ["vapour", "customers"],
        skipped: ["the sun warms the sea"],
        unreadTail: "the cloud brings rain to the hills",
        misheard: [
          { word: "vapour", heard: "paper" },
          { word: "plants", heard: "plant" },
        ],
      },
    },
  };
  await page.addInitScript(
    ([p, s]) => {
      localStorage.setItem("acc.v1.profile", p);
      localStorage.setItem("acc.v1.sessions", s);
    },
    [JSON.stringify(profileJson), JSON.stringify([session])],
  );
  await page.goto(`/report/${session.id}`);
  const reading = page.getByTestId("reading-box").locator("xpath=ancestor::section");
  await expect(reading.getByTestId("skipped").first()).toContainText("the sun warms the sea");
  await expect(reading).toContainText("You stopped before");
  const words = reading.getByTestId("pronunciation");
  await expect(words).toHaveCount(2);
  await expect(words.first()).toContainText("vapour");
  await expect(words.first()).toContainText("paper");
  await expect(words.first()).toContainText("va-pour");
  await expect(words.nth(1)).toContainText(/ending "s"/);
});

test("the privacy text names no outside services and says what the camera is for", async ({ page }) => {
  await page.goto("/onboarding");
  const text = await page.locator("body").innerText();
  expect(text).toMatch(/How your information is used/);
  expect(text).not.toMatch(/Sarvam|Cartesia|Groq|Anthropic|Google|Microsoft|MediaPipe/i);
  expect(text).toMatch(/camera/i);
});

test("transcript saving can be turned off and transcripts deleted", async ({ page }) => {
  const now = Date.now();
  await page.addInitScript(
    ([p, s]) => {
      localStorage.setItem("acc.v1.profile", p);
      localStorage.setItem("acc.v1.sessions", s);
    },
    [JSON.stringify(profileJson), JSON.stringify([seedSession({ startedAt: now - 86_400_000, durationSec: 600 })])],
  );
  await page.goto("/settings");
  // The saved-data card has no explanatory paragraphs or counts, only the toggle and the buttons.
  await expect(page.getByText(/sessions? saved/)).toHaveCount(0);
  await expect(page.getByText(/Everything is stored only in this browser/)).toHaveCount(0);
  await expect(page.getByText(/Needed to re-read what was said/)).toHaveCount(0);
  await page.getByRole("button", { name: "Delete saved transcripts" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByRole("button", { name: "Delete saved transcripts" })).toBeDisabled();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("acc.v1.sessions") ?? "[]")[0]);
  expect(stored.turns).toEqual([]);
  expect(stored.transcriptKept).toBe(false);
  expect(stored.speech.totalWords).toBeGreaterThan(0); // measurements are kept
});

test("progress shows trends by itself after two sessions, with no 'not enough data' messages before", async ({ page }) => {
  const now = Date.now();
  const sessions = (n: number) =>
    Array.from({ length: n }, (_, i) => seedSession({ startedAt: now - (n - i) * 86_400_000, durationSec: 600, id: `trend-${i}` }));
  const seed = async (list: unknown[]) => {
    await page.addInitScript(
      ([p, s]) => {
        localStorage.setItem("acc.v1.profile", p);
        localStorage.setItem("acc.v1.sessions", s);
      },
      [JSON.stringify(profileJson), JSON.stringify(list)],
    );
  };

  // One session: history only. No trend card, no charts, and no text about needing more sessions.
  await seed(sessions(1));
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Session history" })).toBeVisible();
  await expect(page.getByText("What is changing")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Filler words per 100 words" })).toHaveCount(0);
  await expect(page.getByText(/not enough data|at least (2|two|3)|few sessions|three sessions/i)).toHaveCount(0);
});

test("progress after two sessions shows trends and explains filler words", async ({ page }) => {
  const now = Date.now();
  const two = [0, 1].map((i) => seedSession({ startedAt: now - (2 - i) * 86_400_000, durationSec: 600, id: `two-${i}` }));
  await page.addInitScript(
    ([p, s]) => {
      localStorage.setItem("acc.v1.profile", p);
      localStorage.setItem("acc.v1.sessions", s);
    },
    [JSON.stringify(profileJson), JSON.stringify(two)],
  );
  await page.goto("/progress");
  await expect(page.getByText("What is changing")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Filler words per 100 words" })).toBeVisible();
  await expect(page.getByText(/for every 100 words\. Lower is better/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Average answer length/ })).toBeVisible();
  // Speaking pace was not measured (typed answers), so that chart is simply absent.
  await expect(page.getByRole("heading", { name: /Speaking pace/ })).toHaveCount(0);
});

test("layout has no horizontal scroll at 375, 768 and 1440 px", async ({ page }) => {
  const now = Date.now();
  const session = seedSession({ startedAt: now - 86_400_000, durationSec: 600, id: "layout-1" });
  await page.addInitScript(
    ([p, s]) => {
      localStorage.setItem("acc.v1.profile", p);
      localStorage.setItem("acc.v1.sessions", s);
    },
    [JSON.stringify(profileJson), JSON.stringify([session])],
  );
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/library", "/progress", "/profile", "/settings", "/privacy", "/report/layout-1", "/practice/business-marketing-intermediate"]) {
      await page.goto(path);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `${path} at ${width}px`).toBe(false);
    }
  }
});

test("the page uses the full screen width and the header spans it, in the light theme", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await completeOnboarding(page);
  const logo = await page.getByRole("link", { name: "Talkzy" }).first().boundingBox();
  const nav = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  const hero = await page.getByRole("link", { name: /Start today.s practice/ }).boundingBox();
  expect(logo!.x).toBeLessThan(120); // logo at the left edge, not in a centred column
  expect(nav!.x + nav!.width).toBeGreaterThan(1300); // tabs reach the right side
  expect(hero).not.toBeNull();
  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(scrolls).toBe(false);
  // Light only: no theme switch, and the page colour is the cream Sunrise background.
  await expect(page.getByRole("button", { name: /dark mode|light mode/i })).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 244, 232)");
});

test("library shows only the modules for your subject, with no filters", async ({ page }) => {
  await completeOnboarding(page, { field: /Engineering/, level: /Intermediate/ });
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Engineering modules" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(3);
  await expect(page.getByText("Your level")).toBeVisible();
  // No way to pick another subject, difficulty or goal here: that lives in the profile.
  await expect(page.getByRole("group", { name: /Filter/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /All fields|Any level/ })).toHaveCount(0);
  await expect(page.getByText("What Is a Brand?")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Change subject or goal in your profile/ })).toBeVisible();
});

test("profile sections open when tapped, and changing the subject changes the library", async ({ page }) => {
  await completeOnboarding(page, { field: /Business & Marketing/ });
  await page.goto("/profile");
  // Closed at first: only the current choice is shown.
  await expect(page.getByText("Business & Marketing").first()).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Science/ })).toBeHidden();
  await page.getByText("Your subject or specialization").click();
  await expect(page.getByRole("radio", { name: /^Science/ })).toBeVisible();
  await page.getByRole("radio", { name: /^Science/ }).check();
  await page.locator("summary", { hasText: "What do you want to improve?" }).click();
  await page.getByRole("radio", { name: /Prepare for interviews/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Science modules" })).toBeVisible();
  await expect(page.getByText("Focus: Prepare for interviews").first()).toBeVisible();
});

test("no accent choice in Settings: speech is English (India) only", async ({ page }) => {
  await completeOnboarding(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /Settings/ }).first()).toBeVisible();
  await expect(page.getByText(/English accent/i)).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("while the report is made a percentage and a progress bar are shown", async ({ page }) => {
  await completeOnboarding(page);
  // Make the report take a moment so the bar can be seen.
  await page.route("**/api/status", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, mode: "live", llm: "groq" } });
  });
  await page.route("**/api/coach/report", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ai: null, reason: "Test: no AI." }) });
  });
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: /start conversation/i }).click();
  await expect(page.getByText(/Your turn/)).toBeVisible({ timeout: 30_000 });
  const typing = page.getByLabel("Type your answer");
  if (!(await typing.isVisible())) await page.getByRole("button", { name: "Type instead" }).click();
  await typing.fill("I think prototypes help teams find mistakes early, because a small model is cheaper than a finished product.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText(/Your turn/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  const bar = page.getByRole("progressbar", { name: "Report progress" });
  await expect(bar).toBeVisible();
  await expect(page.getByText(/^\d{1,3}%$/)).toBeVisible();
  await page.waitForURL(/\/report\//, { timeout: 30_000 });
});

test("each age group has its own modules: changing the age group in the profile changes the library", async ({ page }) => {
  await completeOnboarding(page); // 18 or older, Business and Marketing, Intermediate, Explain ideas clearly
  const adult = findModule("business-marketing", "intermediate", "clarity", "18plus")!;
  const child = findModule("business-marketing", "intermediate", "clarity", "under13")!;
  const teen = findModule("business-marketing", "intermediate", "clarity", "13to17")!;
  expect(new Set([adult.title, child.title, teen.title]).size).toBe(3);

  await page.goto("/library");
  await expect(page.getByText(adult.title)).toBeVisible();
  await expect(page.getByText(child.title)).toHaveCount(0);
  await expect(page.getByText(teen.title)).toHaveCount(0);

  await page.goto("/profile");
  await page.locator("summary", { hasText: "About you" }).click();
  await page.getByRole("radio", { name: /13 to 17/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.goto("/library");
  await expect(page.getByText(teen.title)).toBeVisible();
  await expect(page.getByText(adult.title)).toHaveCount(0);

  await page.goto("/profile");
  await page.locator("summary", { hasText: "About you" }).click();
  await page.getByRole("radio", { name: /Under 13/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.goto("/library");
  await expect(page.getByText(child.title)).toBeVisible();
  await expect(page.getByText(teen.title)).toHaveCount(0);
});

test("each goal has its own modules, and the practice starts with an easy question", async ({ page }) => {
  const fluency = findModule("engineering", "beginner", "fluency", "18plus")!;
  const interview = findModule("engineering", "beginner", "interview", "18plus")!;
  await completeOnboarding(page, { field: /Engineering/, level: /Beginner/, goal: /Speak more fluently/ });
  await page.goto("/library");
  await expect(page.getByText(fluency.title)).toBeVisible();
  await expect(page.getByText(interview.title)).toHaveCount(0);

  // Change the goal in the profile: the library shows different modules by itself.
  await page.goto("/profile");
  await page.locator("summary", { hasText: "What do you want to improve?" }).click();
  await page.getByRole("radio", { name: /Prepare for interviews/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.goto("/library");
  await expect(page.getByText(interview.title)).toBeVisible();
  await expect(page.getByText(fluency.title)).toHaveCount(0);

  // The first question is the easy opening question of that module, and it is labelled as a warm-up.
  await page.goto("/practice/engineering-beginner-interview-18plus");
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: /start conversation/i }).click();
  await expect(page.getByTestId("coach-message")).toContainText(interview.openingQuestion, { timeout: 30_000 });
  await expect(page.getByTestId("question-level")).toContainText("Question 1: Warm-up question");
});

test("not sure yet: a student who does not know gets a helpful mix of modules to try", async ({ page }) => {
  /** Fills the first-time form with "Not sure yet" for the subject and the goal, and the given choice for the difficulty. */
  async function onboard(level: RegExp) {
    await page.goto("/");
    await page.waitForURL(/\/onboarding/);
    await page.getByLabel("First name or nickname").fill("Meena");
    await page.getByRole("radio", { name: /13 to 17/ }).check();
    await page.getByRole("group", { name: /Subject/ }).getByRole("radio", { name: /Not sure yet/ }).check();
    await page.getByRole("group", { name: "Difficulty" }).getByRole("radio", { name: level }).check();
    await page.getByRole("group", { name: /What do you want to improve/ }).getByRole("radio", { name: /Not sure yet/ }).check();
    await page.getByLabel(/I have read how my voice/).check();
    await page.getByRole("button", { name: "Save and start" }).click();
    await expect(page.getByRole("heading", { name: "Hi Meena!" })).toBeVisible();
  }

  // Not sure about the subject, the goal or the difficulty: six easy starter modules, one marked "Start here".
  await onboard(/Not sure yet/);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Modules to try" })).toBeVisible();
  await expect(page.getByText(/You are not sure yet, and that is fine/)).toBeVisible();
  const list = page.getByTestId("library-list").locator("li");
  await expect(list).toHaveCount(6);
  await expect(page.getByText("Start here")).toHaveCount(1);
  const starter = modulesForProfile({ field: "unsure", level: "unsure", goal: "unsure", ageBand: "13to17" }).modules;
  for (const m of starter) await expect(page.getByText(m.title, { exact: true })).toBeVisible();

  // Only the difficulty chosen: one module for every goal, each in a different subject, and the subject is shown.
  await page.goto("/profile");
  await page.locator("summary", { hasText: "Difficulty" }).click();
  await page.getByRole("group", { name: "Difficulty" }).getByRole("radio", { name: /Intermediate/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.goto("/library");
  await expect(page.getByText(/You chose Intermediate but are not sure what to improve and which subject to practise/)).toBeVisible();
  await expect(list).toHaveCount(5);
  const mix = modulesForProfile({ field: "unsure", level: "intermediate", goal: "unsure", ageBand: "13to17" }).modules;
  expect(new Set(mix.map((m) => m.goal)).size).toBe(5);
  expect(new Set(mix.map((m) => m.field)).size).toBe(5);
  for (const m of mix) await expect(page.getByText(m.title, { exact: true })).toBeVisible();
  await expect(page.getByText("Start here")).toHaveCount(1);

  // The dashboard still recommends something.
  await page.goto("/");
  await expect(page.getByText("Recommended for you")).toBeVisible();
  await expect(page.getByRole("link", { name: /Start today.s practice/ })).toBeVisible();
});

test("the check page says which part is not working (no keys and no microphone here)", async ({ page }) => {
  await page.goto("/check");
  await expect(page.getByRole("heading", { name: "Check my microphone and voice" })).toBeVisible();
  await page.getByRole("button", { name: "Run the check" }).click();
  await expect(page.getByTestId("check-summary")).toContainText(/to fix/, { timeout: 60_000 });
  // Without keys the AI and the voice are not set up, and headless Chromium has no microphone: the page says so, row by row.
  await expect(page.getByTestId("check-server")).toHaveAttribute("data-state", "bad");
  await expect(page.getByTestId("check-mic")).toHaveAttribute("data-state", "bad");
  await expect(page.getByTestId("check-storage")).toHaveAttribute("data-state", "ok");
});

test("the goodbye is spoken first, and only then does the progress screen come", async ({ page }) => {
  // The fake voice takes 3 seconds to say the goodbye, so there is time to look at the screen while she speaks.
  await mockSpeech(page, [PASSAGE, VOICE_ANSWERS[0], "I want to end the session."]);
  await page.addInitScript(() => {
    const synth = window.speechSynthesis as unknown as { speak: (u: { text: string; onend?: () => void }) => void };
    const original = synth.speak.bind(synth);
    synth.speak = (u) => {
      if (/generate your report/i.test(u.text)) {
        (window as unknown as { __spoken: string[] }).__spoken.push(u.text);
        setTimeout(() => u.onend?.(), 3000);
      } else original(u);
    };
  });
  await completeOnboarding(page);
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await beginReadingAndConverse(page);
  await expect(page.getByTestId("live-transcript")).toContainText(/A brand is the promise/i, { timeout: 40_000 });
  await page.getByRole("button", { name: "Next question" }).click();
  // The goodbye is on the screen while she speaks, and the progress bar is not there yet.
  await expect(page.getByTestId("coach-prompt")).toContainText(/generate your report/i, { timeout: 40_000 });
  await expect(page.getByRole("progressbar", { name: "Report progress" })).toHaveCount(0);
  // After she has finished, the progress bar comes and then the report.
  await expect(page.getByRole("progressbar", { name: "Report progress" })).toBeVisible({ timeout: 15_000 });
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
});
