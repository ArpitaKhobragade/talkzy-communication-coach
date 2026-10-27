import { expect, type Page } from "@playwright/test";
import { buildSession } from "../../src/features/practice/finalize";

/**
 * TEST DOUBLE for the browser's speech APIs. Headless Chromium has no speech recogniser, so we
 * replace getUserMedia(audio), SpeechRecognition and speechSynthesis with scripted fakes.
 * This exercises OUR turn-taking, timing and metrics code. It does NOT prove that real speech
 * recognition works; that needs a manual check in Chrome with a real microphone (see TEST_PLAN.md).
 */
export async function mockSpeech(page: Page, answers: string[]) {
  await page.addInitScript((scripted: string[]) => {
    const w = window as unknown as Record<string, unknown>;
    w.__spoken = [] as string[];
    w.__turn = 0;

    // Fake microphone: an oscillator whose loudness the fake recogniser switches on and off.
    let gainNode: GainNode | null = null;
    const setSpeaking = (on: boolean) => {
      if (gainNode) gainNode.gain.value = on ? 0.4 : 0;
    };
    navigator.mediaDevices.getUserMedia = async (c: MediaStreamConstraints) => {
      if (!c.audio) throw new DOMException("no camera in test", "NotFoundError");
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      const dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 220;
      osc.connect(gainNode).connect(dest);
      osc.start();
      return dest.stream;
    };

    class FakeRecognition {
      lang = "en-US";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private timers: ReturnType<typeof setTimeout>[] = [];
      start() {
        const text = scripted[Math.min(Number(w.__turn), scripted.length - 1)];
        w.__turn = Number(w.__turn) + 1;
        const words = text.split(" ");
        this.timers.push(setTimeout(() => setSpeaking(true), 300));
        this.timers.push(
          setTimeout(() => {
            const r = Object.assign([{ transcript: words.slice(0, 6).join(" "), confidence: 0 }], { isFinal: false });
            this.onresult?.({ resultIndex: 0, results: { length: 1, 0: r } });
          }, 900),
        );
        this.timers.push(
          setTimeout(() => {
            const r = Object.assign([{ transcript: text, confidence: 0.92 }], { isFinal: true });
            this.onresult?.({ resultIndex: 0, results: { length: 1, 0: r } });
          }, 4300),
        );
        this.timers.push(setTimeout(() => setSpeaking(false), 4400));
      }
      stop() {
        this.timers.forEach(clearTimeout);
        setSpeaking(false);
        setTimeout(() => this.onend?.(), 10);
      }
      abort() {
        this.stop();
      }
    }
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;

    // Fake text-to-speech that records what the coach "said" and finishes quickly.
    const fakeSynth = {
      speaking: false,
      speak(u: { text: string; onend?: () => void }) {
        (w.__spoken as string[]).push(u.text);
        setTimeout(() => u.onend?.(), 60);
      },
      cancel() {},
      getVoices: () => [],
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: fakeSynth, configurable: true });
  }, answers);
}

/** The short report is shown first; the long sections are folded under "See the full report". */
export async function openFullReport(page: Page) {
  await expect(page.getByTestId("quick-report")).toBeVisible();
  await page.getByTestId("full-report").evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
}

export async function completeOnboarding(
  page: Page,
  opts: { name?: string; age?: RegExp; field?: RegExp; level?: RegExp; goal?: RegExp } = {},
) {
  await page.goto("/");
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel("First name or nickname").fill(opts.name ?? "Riya");
  await page.getByRole("radio", { name: opts.age ?? /18 or older/ }).check();
  await page.getByRole("radio", { name: opts.field ?? /Business & Marketing/ }).check();
  await page.getByRole("radio", { name: opts.level ?? /Intermediate/ }).check();
  await page.getByRole("radio", { name: opts.goal ?? /Explain ideas clearly/ }).check();
  await page.getByLabel(/I have read how my voice/).check();
  await page.getByRole("button", { name: "Save and start" }).click();
  await expect(page.getByRole("heading", { name: `Hi ${opts.name ?? "Riya"}!` })).toBeVisible();
}

/** Typed-only quick session: mic denied, two typed answers, then End session. */
export async function completeTypedSession(page: Page) {
  await page.getByRole("link", { name: /Start today.s practice/ }).click();
  await page.getByRole("button", { name: "Begin" }).click();
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /finished reading/ }).click();
  const answers = [
    "I think the main idea is that customers choose brands they trust, and I can give an example from a shop near my home.",
    "A good example is a local bakery that remembers regular customers, which makes people come back every week.",
  ];
  for (const a of answers) {
    await expect(page.getByText(/Your turn/)).toBeVisible({ timeout: 30_000 });
    const typing = page.getByLabel("Type your answer");
    if (!(await typing.isVisible())) await page.getByRole("button", { name: "Type instead" }).click();
    await typing.fill(a);
    await page.getByRole("button", { name: "Send answer" }).click();
  }
  await expect(page.getByText(/Your turn/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Yes, end" }).click();
  await page.waitForURL(/\/report\//, { timeout: 60_000 });
}

/** Build a schema-valid saved session for seeding localStorage. */
export function seedSession(over: { startedAt: number; durationSec: number; id?: string }) {
  return buildSession({
    id: over.id ?? `seed-${over.startedAt}`,
    startedAt: over.startedAt,
    endedAt: over.startedAt + over.durationSec * 1000,
    budgetSec: Math.max(720, over.durationSec), // counted time is capped at the budget, so raise it for long seeds
    moduleId: "business-marketing-intermediate",
    field: "business-marketing",
    level: "intermediate",
    goal: "clarity",
    liveAi: false,
    readingSec: 60,
    passageWords: 120,
    reading: { mode: "silent", durationSec: 60 },
    turns: [
      { id: "1", role: "coach", text: "What is a brand?", at: over.startedAt },
      { id: "2", role: "student", text: "A brand is the promise a company makes to its customers every day", at: over.startedAt, inputMode: "typed" },
      { id: "3", role: "coach", text: "Why does it matter?", at: over.startedAt },
      { id: "4", role: "student", text: "It matters because people buy from names they trust and remember", at: over.startedAt, inputMode: "typed" },
    ],
    vision: null,
    keepTranscript: true,
    ai: null,
    aiReason: "Development mode",
  });
}

export const profileJson = {
  displayName: "Riya",
  ageBand: "18plus",
  field: "business-marketing",
  level: "intermediate",
  goal: "clarity",
  consent: { acceptedAt: 1, guardianConfirmed: false },
};
