import { describe, expect, it } from "vitest";
import { compareHalves, progressInsights, recommendNext, trendSeries } from "@/features/progress/stats";
import { computeSpeechMetrics } from "@/features/speech/metrics";
import type { Profile, Session } from "@/features/session/types";

const profile: Profile = {
  displayName: "Asha",
  ageBand: "13to17",
  field: "computer-science",
  level: "beginner",
  goal: "confidence",
  consent: { acceptedAt: 0, guardianConfirmed: false },
};

function session(i: number, speech: Partial<ReturnType<typeof computeSpeechMetrics>>, over: Partial<Session> = {}): Session {
  return {
    id: `s${i}`,
    startedAt: 1_700_000_000_000 + i * 86_400_000,
    endedAt: 1_700_000_000_000 + i * 86_400_000 + 600_000,
    moduleId: "computer-science-beginner",
    field: "computer-science",
    level: "beginner",
    goal: "confidence",
    mode: "dev",
    durationSec: 600,
    readingSec: 120,
    conversationSec: 480,
    completed: true,
    reading: { mode: "silent", durationSec: 120 },
    turns: [],
    transcriptKept: true,
    speech: { ...computeSpeechMetrics([]), ...speech },
    vision: null,
    report: { generatedBy: "dev", createdAt: 0, ai: null, speechNotes: [], bodyLanguageNotes: [], fallbackExercises: [] },
    ...over,
  };
}

describe("compareHalves", () => {
  it("returns null with fewer than 2 data points", () => {
    expect(compareHalves([5], true, 0.5)).toBeNull();
    expect(compareHalves([null, 4, null], true, 0.5)).toBeNull();
  });
  it("compares the two sessions when there are exactly two", () => {
    expect(compareHalves([5, 3], true, 0.5)).toEqual({ before: 5, after: 3, direction: "better" });
    expect(compareHalves([2, 6], true, 0.5)?.direction).toBe("worse");
  });
  it("detects improvement when lower is better", () => {
    expect(compareHalves([6, 5, 3, 2], true, 0.5)?.direction).toBe("better");
  });
  it("detects decline and steadiness", () => {
    expect(compareHalves([2, 2, 6, 7], true, 0.5)?.direction).toBe("worse");
    expect(compareHalves([4, 4.1, 4, 4.2], true, 0.5)?.direction).toBe("steady");
  });
});

describe("progressInsights", () => {
  it("makes no trend claims for a single session, and shows one after two", () => {
    expect(progressInsights([session(1, { fillerPer100: 5 })])).toEqual([]);
    const two = progressInsights([session(1, { fillerPer100: 5 }), session(2, { fillerPer100: 2 })]);
    expect(two.find((i) => i.label === "Filler words")?.direction).toBe("better");
  });
  it("reports real before/after numbers", () => {
    const sessions = [8, 6, 3, 2].map((f, i) => session(i, { fillerPer100: f, avgAnswerWords: 30 }));
    const insights = progressInsights(sessions);
    const filler = insights.find((i) => i.label === "Filler words");
    expect(filler?.direction).toBe("better");
    expect(filler?.text).toContain("7 to 2.5");
  });
});

describe("trendSeries", () => {
  it("is oldest first and skips incomplete sessions", () => {
    const pts = trendSeries([session(3, {}), session(1, {}), session(2, {}, { completed: false })]);
    expect(pts.map((p) => p.sessionId)).toEqual(["s1", "s3"]);
  });
});

describe("recommendNext", () => {
  it("starts from the profile with no history", () => {
    const r = recommendNext(profile, []);
    expect(r.module.id).toBe("computer-science-beginner-confidence");
    expect(r.goal).toBe("confidence");
  });

  it("keeps the goal from the profile and cites the real filler number", () => {
    const r = recommendNext(profile, [session(2, { fillerPer100: 6, avgAnswerWords: 50 }), session(1, { fillerPer100: 4, avgAnswerWords: 50 })]);
    expect(r.goal).toBe("confidence");
    expect(r.module.goal).toBe("confidence");
    expect(r.reason).toContain("5.0");
  });

  it("gives a tip for short answers without changing the goal", () => {
    const r = recommendNext(profile, [session(1, { fillerPer100: 0.5, avgAnswerWords: 12 })]);
    expect(r.goal).toBe("confidence");
    expect(r.reason).toContain("12 words");
  });

  it("always recommends a module for the profile's subject and goal", () => {
    for (const g of ["fluency", "clarity", "vocabulary", "confidence", "interview"] as const) {
      const r = recommendNext({ ...profile, goal: g }, []);
      expect(r.module.field).toBe(profile.field);
      expect(r.module.goal).toBe(g);
    }
  });

  it("steps up a level after two strong sessions and prefers a fresh module", () => {
    const strong = { fillerPer100: 1, avgAnswerWords: 60, wpm: 130, lexicalVariety: 0.7 };
    const r = recommendNext(profile, [session(2, strong), session(1, strong)]);
    expect(r.module.level).toBe("intermediate");
  });
});
