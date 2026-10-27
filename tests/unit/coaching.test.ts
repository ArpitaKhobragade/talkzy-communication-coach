import { describe, expect, it } from "vitest";
import { buildAnswerCoaching, buildBodyLanguageCoaching, buildReadingCoaching } from "@/features/coach/report-builder";
import { computeSpeechMetrics } from "@/features/speech/metrics";
import type { SpeechMetrics, Turn, VisionMetrics } from "@/features/session/types";

const vision = (over: Partial<VisionMetrics> = {}): VisionMetrics => ({
  framesAnalyzed: 200, durationSec: 100, facePresentPct: 95, cameraFacingPct: 85, avgHeadYawDeg: 8, avgHeadPitchDeg: 6,
  shoulderTiltDeg: 3, uprightPct: 85, bodyVisiblePct: 90, handsVisiblePct: 40, movementIndex: 0.04, movementLevel: "moderate",
  facialMovementIndex: 0.02, facialMovementLevel: "moderate", ...over,
});

const speech = (over: Partial<SpeechMetrics> = {}): SpeechMetrics => ({ ...computeSpeechMetrics([]), ...over });
const kinds = (items: { kind: string }[]) => items.map((i) => i.kind);

describe("buildReadingCoaching", () => {
  const aloud = (over = {}) => ({ accuracyPct: 95, coveragePct: 100, wpm: 140, spokenWordCount: 120, missedWords: [] as string[], ...over });

  it("praises a clear, complete, comfortable read", () => {
    const items = buildReadingCoaching({ mode: "aloud", durationSec: 60, aloud: aloud() }, 120);
    expect(kinds(items)).toEqual(["good", "good"]);
  });

  it("explains what to change when accuracy, coverage and pace are off, without claiming pronunciation scores", () => {
    const items = buildReadingCoaching({ mode: "aloud", durationSec: 60, aloud: aloud({ accuracyPct: 60, coveragePct: 50, wpm: 200, missedWords: ["debugging", "programmer"] }) }, 120);
    expect(items.filter((i) => i.kind === "improve")).toHaveLength(3);
    for (const i of items.filter((x) => x.kind === "improve")) expect(i.howTo).toBeTruthy();
    const missed = items.find((i) => /not clear/.test(i.observation) && /debugging/.test(i.observation))!;
    expect(missed.observation).toContain("debugging");
    expect(missed.why).toMatch(/not a mark for your pronunciation/);
  });

  it("says silent reading cannot be measured and suggests reading aloud", () => {
    const items = buildReadingCoaching({ mode: "silent", durationSec: 40 }, 120);
    expect(items[0].observation).toMatch(/could not be measured/);
    expect(items[0].howTo).toMatch(/out loud/);
  });

  it("flags skimming only when silent reading is implausibly fast", () => {
    expect(buildReadingCoaching({ mode: "silent", durationSec: 10 }, 200).some((i) => i.kind === "improve")).toBe(true);
    expect(buildReadingCoaching({ mode: "silent", durationSec: 60 }, 120).some((i) => i.kind === "improve")).toBe(false);
  });
});

describe("buildAnswerCoaching", () => {
  it("gives actionable advice for short, fast, filler-heavy, pause-heavy answers", () => {
    const items = buildAnswerCoaching(
      speech({ voiceTurns: 3, avgAnswerWords: 12, wpm: 180, fillerPer100: 6, fillerCount: 5, fillers: [{ word: "basically", count: 5 }], pauseCount: 8, longestPauseSec: 5, avgLatencySec: 6, repetitionCount: 4, repetitions: ["the the"] }),
    );
    const improve = items.filter((i) => i.kind === "improve");
    expect(improve.length).toBeGreaterThanOrEqual(6);
    for (const i of improve) {
      expect(i.howTo?.length).toBeGreaterThan(10);
    }
    expect(improve.map((i) => i.observation).join(" ")).toMatch(/short|quickly|Filler|paused|took about|repeated/);
  });

  it("recognises strong performance", () => {
    const items = buildAnswerCoaching(speech({ voiceTurns: 3, avgAnswerWords: 50, wpm: 135, fillerPer100: 0.5, fillerCount: 1, pauseCount: 1, avgLatencySec: 2, lexicalVariety: 0.7 }));
    expect(items.every((i) => i.kind === "good" || i.kind === "info")).toBe(true);
    expect(items.some((i) => i.kind === "good")).toBe(true);
  });

  it("does not invent speaking measures for typed-only answers", () => {
    const turns: Turn[] = [{ id: "1", role: "student", text: "typed answer with enough words to count here really", at: 0, inputMode: "typed" }];
    const items = buildAnswerCoaching(computeSpeechMetrics(turns));
    const text = items.map((i) => i.observation).join(" ");
    expect(text).toMatch(/typed, so we could not check your speed, stops or thinking time/);
    expect(text).not.toMatch(/words a minute/);
  });
});

describe("buildBodyLanguageCoaching", () => {
  it("returns nothing without enough camera data", () => {
    expect(buildBodyLanguageCoaching(null)).toEqual([]);
    expect(buildBodyLanguageCoaching(vision({ framesAnalyzed: 5 }))).toEqual([]);
  });

  it("praises good framing, facing and posture", () => {
    const items = buildBodyLanguageCoaching(vision());
    expect(items.filter((i) => i.kind === "improve")).toEqual([]);
    expect(items.some((i) => /faced the camera/.test(i.observation))).toBe(true);
  });

  it("says what was wrong and how to fix it for each weak area", () => {
    const items = buildBodyLanguageCoaching(
      vision({ facePresentPct: 50, cameraFacingPct: 40, avgHeadPitchDeg: 22, avgHeadYawDeg: 28, uprightPct: 30, shoulderTiltDeg: 12, movementLevel: "high" }),
    );
    const improve = items.filter((i) => i.kind === "improve");
    expect(improve.length).toBeGreaterThanOrEqual(6);
    for (const i of improve) expect(i.howTo).toBeTruthy();
    const all = improve.map((i) => i.howTo).join(" ");
    expect(all).toMatch(/eye level/);
    expect(all).toMatch(/Sit tall/);
  });

  it("never makes claims about emotion, confidence or honesty", () => {
    const items = [
      ...buildBodyLanguageCoaching(vision({ facialMovementLevel: "low", movementLevel: "low", handsVisiblePct: 5 })),
      ...buildBodyLanguageCoaching(vision({ facePresentPct: 40, uprightPct: 20, movementLevel: "high" })),
    ];
    const text = items.map((i) => `${i.observation} ${i.why ?? ""} ${i.howTo ?? ""}`).join(" ");
    expect(text).not.toMatch(/nervous|anxious|confident|confidence|honest|lying|happy|sad|angry|bored|stress|emotion(?!s?\.| on camera)/i);
    expect(text).toMatch(/says nothing about how you feel/);
  });
});
