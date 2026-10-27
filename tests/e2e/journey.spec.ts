import { expect, test } from "@playwright/test";
import { completeOnboarding, completeTypedSession, openFullReport, mockSpeech, profileJson, seedSession } from "./helpers";

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

test("full voice journey with mocked speech APIs: read, converse, report, history", async ({ page }) => {
  await mockSpeech(page, VOICE_ANSWERS);
  await completeOnboarding(page);

  // Dashboard recommends a marketing module (personalised to the chosen field).
  await expect(page.getByText("Recommended for you")).toBeVisible();
  await expect(page.getByText(/Development mode: no AI key configured/)).toBeVisible();
  await page.getByRole("link", { name: /Start today.s practice/ }).click();

  // Setup -> permissions -> reading.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByLabel("Reading passage")).toBeVisible();
  await expect(page.getByLabel("Reading passage")).toContainText(/brand|customer|market/i);
  // Phase 1: read the passage out loud (voice available, so "Start reading" is the main action).
  await expect(page.getByText("Phase 1 of 2: Reading")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start reading" })).toBeVisible();
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /finished reading/ }).click();

  // The coach speaks (TTS called) and the student answers by "voice".
  await expect(page.getByTestId("coach-message")).toContainText("Hi Riya");
  await expect(page.getByText("Phase 2 of 2: Conversation")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBeGreaterThan(0);
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("live-transcript")).toContainText(/A brand is the promise/i, { timeout: 15_000 });

  // The conversation continues with follow-up questions until the coach wraps up.
  await expect(page.getByTestId("coach-message")).not.toContainText("Hi Riya", { timeout: 30_000 });
  await page.waitForURL(/\/report\//, { timeout: 170_000 });

  // Report.
  await expect(page.getByRole("heading", { name: "Your feedback report" })).toBeVisible();
  await expect(page.getByText("Development mode").first()).toBeVisible();
  await expect(page.getByText("AI-written feedback is not available for this session")).toBeVisible();
  await openFullReport(page);
  await expect(page.getByText(/words per minute/).first()).toBeVisible(); // pace measured from voice turns
  await expect(page.getByRole("heading", { name: /3\. Camera/ })).toBeVisible();
  await expect(page.getByText(/camera was off/i)).toBeVisible();
  await page.getByText("Show what was said").click();
  await expect(page.getByText(/A brand is the promise a company makes/).first()).toBeVisible();

  // History and progress.
  await page.getByRole("link", { name: "See your progress" }).click();
  await expect(page.getByRole("heading", { name: "Session history" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open report" })).toHaveCount(1);
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
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /finished reading/ }).click();
  await expect(page.getByText(/type your answers/i).first()).toBeVisible();
  await expect(page.getByLabel("Type your answer")).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
  await expect(page.getByText("This was a short session")).toBeVisible();
});

test("daily 20-minute limit blocks a new session", async ({ page }) => {
  const now = Date.now();
  const session = seedSession({ startedAt: now - 3_600_000, durationSec: 18 * 60 });
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

test("typed session saves, then privacy controls delete it", async ({ page }) => {
  await completeOnboarding(page);
  await completeTypedSession(page);
  await expect(page.getByRole("heading", { name: "Your feedback report" })).toBeVisible();

  // The short report comes first: what went well, what to fix, one example and one task to practise.
  const quick = page.getByTestId("quick-report");
  await expect(quick.getByRole("heading", { name: "What went well" })).toBeVisible();
  await expect(quick.getByRole("heading", { name: "What to fix" })).toBeVisible();
  await expect(quick.getByRole("heading", { name: "Practise today" })).toBeVisible();
  expect((await quick.innerText()).split(/s+/).length).toBeLessThan(220); // short: well under a page

  // The long sections are still there, folded under "See the full report".
  await openFullReport(page);
  await expect(page.getByRole("heading", { name: /1\. How you did while reading/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Good to know" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instead of this, say it like this" })).toBeVisible();
  await expect(page.getByText("Instead of saying:").first()).toBeVisible();
  await expect(page.getByText("Say it like this:").first()).toBeVisible();

  // Download the report as a real PDF and as a text file (both are made on the device).
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^talkzy-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdfStream = await pdf.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of pdfStream) chunks.push(c as Buffer);
  const pdfBytes = Buffer.concat(chunks);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfBytes.length).toBeGreaterThan(2000);

  const [txt] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download as text" }).click()]);
  expect(txt.suggestedFilename()).toMatch(/\.txt$/);
  const txtStream = await txt.createReadStream();
  const txtChunks: Buffer[] = [];
  for await (const c of txtStream) txtChunks.push(c as Buffer);
  const body = Buffer.concat(txtChunks).toString("utf8");
  expect(body).toMatch(/MY SPEAKING REPORT/);
  expect(body).toMatch(/WHAT WENT WELL/);
  expect(body).toMatch(/PRACTISE TODAY/);
  expect(body.split("\n").length).toBeLessThan(40); // short enough for one page
  expect(body).toMatch(/Riya/); // the student's name from onboarding

  // Delete this single session.
  await page.getByRole("button", { name: "Delete this session" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await page.waitForURL(/\/progress/);
  await expect(page.getByText("Nothing here yet")).toBeVisible();

  // Delete everything returns to onboarding with storage cleared.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await page.waitForURL(/\/onboarding/);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("acc.v1.")));
  expect(keys).toEqual([]);
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
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /finished reading/ }).click();
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

test("each goal has its own modules, and the practice starts with an easy question", async ({ page }) => {
  await completeOnboarding(page, { field: /Engineering/, level: /Beginner/, goal: /Speak more fluently/ });
  await page.goto("/library");
  await expect(page.getByText("A Bicycle Ride, Step by Step")).toBeVisible();
  await expect(page.getByText("Ravi and the Robot Arm")).toHaveCount(0);

  // Change the goal in the profile: the library shows different modules by itself.
  await page.goto("/profile");
  await page.locator("summary", { hasText: "What do you want to improve?" }).click();
  await page.getByRole("radio", { name: /Prepare for interviews/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
  await page.goto("/library");
  await expect(page.getByText("Ravi and the Robot Arm")).toBeVisible();
  await expect(page.getByText("A Bicycle Ride, Step by Step")).toHaveCount(0);

  // The first question is the easy opening question of that module, and it is labelled as a warm-up.
  await page.goto("/practice/engineering-beginner-interview");
  await page.getByRole("button", { name: "Begin" }).click();
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /finished reading/ }).click();
  await expect(page.getByTestId("coach-message")).toContainText("Can you tell me your name and one thing you like to build or fix?", { timeout: 30_000 });
  await expect(page.getByTestId("question-level")).toContainText("Question 1: Warm-up question");
});
