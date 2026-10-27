import { describe, expect, it } from "vitest";
import { buildSession } from "@/features/practice/finalize";
import { buildQuickReport, MAX_FIX, MAX_GOOD } from "@/features/report/quick";
import type { AiFeedback, CoachingItem, Session, Turn } from "@/features/session/types";

const turn = (role: Turn["role"], text: string): Turn => ({ id: Math.random().toString(), role, text, at: 0, inputMode: role === "student" ? "typed" : undefined });

function base(): Session {
  return buildSession({
    id: "q1",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    budgetSec: 720,
    moduleId: "engineering-intermediate-clarity",
    field: "engineering",
    level: "intermediate",
    goal: "clarity",
    liveAi: false,
    readingSec: 90,
    passageWords: 150,
    reading: { mode: "silent", durationSec: 90 },
    turns: [turn("coach", "Why do engineers build prototypes?"), turn("student", "Because it is cheaper to find a mistake early and fix it before the real thing."), turn("coach", "Can you give an example?"), turn("student", "A bridge model can be tested in water.")],
    vision: null,
    keepTranscript: true,
    ai: null,
    aiReason: "Development mode",
  });
}

const good = (observation: string): CoachingItem => ({ kind: "good", topic: "t", observation });
const improve = (observation: string, howTo?: string): CoachingItem => ({ kind: "improve", topic: "t", observation, howTo });

const ai = (over: Partial<AiFeedback> = {}): AiFeedback => ({
  headline: "You explained your ideas clearly today.",
  strengths: [
    { title: "Clear reasons", detail: "You gave a reason for your main point." },
    { title: "Good example", detail: "Your bridge example was easy to picture." },
  ],
  improvements: [
    { title: "Answers are short", detail: "Your second answer had only seven words.", tip: "Add one more sentence with an example." },
    { title: "Missing detail", detail: "You did not say why.", tip: "Say because, then give the reason." },
  ],
  grammar: [],
  vocabulary: { summary: "Fine.", upgrades: [] },
  structure: { summary: "Clear.", perAnswer: [] },
  reading: { summary: "You read well.", wentWell: ["You read to the end."], improve: [{ issue: "You read a little fast.", howTo: "Pause at each full stop." }] },
  exercises: [
    { title: "Say it in 3 parts", instructions: "Point, reason, example.", minutes: 5 },
    { title: "Second task", instructions: "Do it again.", minutes: 5 },
  ],
  nextSessionFocus: "Longer answers.",
  ...over,
});

describe("buildQuickReport", () => {
  it("keeps only a couple of points, one from each area first", () => {
    const s = base();
    s.report.ai = ai();
    s.report.bodyLanguageCoaching = [good("You looked at the camera."), improve("Your hands were hidden.", "Keep them in view.")];
    // Reading points come from the measurements, not from the AI text.
    s.report.readingCoaching = [good("You read to the end."), improve("Some words were missed.", "Say them slowly.")];
    const q = buildQuickReport(s);
    expect(q.good.length).toBeLessThanOrEqual(MAX_GOOD);
    expect(q.fix.length).toBeLessThanOrEqual(MAX_FIX);
    expect(q.good.map((g) => g.area)).toEqual(["Answering", "Reading"]);
    expect(q.fix.map((x) => x.area)).toEqual(["Answering", "Reading"]);
  });

  it("uses the AI's headline, a fix with its how-to, and the first exercise", () => {
    const s = base();
    s.report.ai = ai();
    const q = buildQuickReport(s);
    expect(q.headline).toBe("You explained your ideas clearly today.");
    expect(q.fix[0]).toMatchObject({ problem: "Answers are short", how: "Add one more sentence with an example." });
    expect(q.practice).toEqual({ title: "Say it in 3 parts", minutes: 5, instructions: "Point, reason, example." });
  });

  it("shows camera tips when there is no reading or answer tip to show", () => {
    const s = base();
    s.report.ai = null;
    s.report.answerCoaching = [];
    s.report.readingCoaching = [];
    s.report.bodyLanguageCoaching = [good("Your face stayed in view."), improve("You looked away a lot.", "Look at the lens.")];
    const q = buildQuickReport(s);
    expect(q.good).toEqual([{ area: "Camera", text: "Your face stayed in view." }]);
    expect(q.fix).toEqual([{ area: "Camera", problem: "You looked away a lot.", how: "Look at the lens." }]);
  });

  it("works from the rule-based coaching when there is no AI feedback", () => {
    const s = base();
    s.report.ai = null;
    s.report.answerCoaching = [good("You used many different words."), improve("Answers were short.", "Add a reason."), improve("Many fillers.", "Pause instead.")];
    s.report.readingCoaching = [improve("You read very fast.", "Slow down.")];
    const q = buildQuickReport(s);
    expect(q.fix.map((x) => x.problem)).toEqual(["Answers were short.", "You read very fast."]);
    expect(q.headline.length).toBeGreaterThan(10);
  });

  it("returns the first say-it-like-this example, or none", () => {
    const s = base();
    s.report.sayItBetter = [
      { said: "um I think it is good", better: "I think it is good.", why: "No filler.", source: "rule" },
      { said: "second", better: "second better", why: "x", source: "rule" },
    ];
    expect(buildQuickReport(s).sayItBetter).toEqual({ said: "um I think it is good", better: "I think it is good." });
    s.report.sayItBetter = [];
    expect(buildQuickReport(s).sayItBetter).toBeNull();
  });

  it("never returns empty points", () => {
    const s = base();
    s.report.ai = ai({ strengths: [{ title: "", detail: "" }], improvements: [{ title: "", detail: "", tip: "" }] });
    const q = buildQuickReport(s);
    expect(q.good.every((g) => g.text.length > 0)).toBe(true);
    expect(q.fix.every((x) => x.problem.length > 0)).toBe(true);
  });
});

describe("buildQuickReport: only true, useful points", () => {
  it("never shows praise that fits every student", () => {
    const s = base();
    s.report.ai = ai({ strengths: [{ title: "Effort", detail: "You answered every question the coach asked." }, { title: "Reason", detail: "Answer 3 gave a reason: because it is cheaper." }] });
    const q = buildQuickReport(s);
    expect(q.good.map((g) => g.text).join(" ")).not.toMatch(/every question/);
    expect(q.good.map((g) => g.text).join(" ")).toMatch(/because it is cheaper/);
  });

  it("takes reading points from the measurements, not from the AI's words", () => {
    const s = base();
    s.report.ai = ai({ reading: { summary: "x", wentWell: ["You read the whole passage correctly."], improve: [] } });
    s.report.readingCoaching = [improve("The app understood 60% of the words you read.", "Read more slowly.")];
    const q = buildQuickReport(s);
    expect(q.good.map((g) => g.text).join(" ")).not.toMatch(/whole passage correctly/);
    expect(q.fix.some((f) => f.area === "Reading" && /60%/.test(f.problem))).toBe(true);
  });

  it("skips a 'say it like this' that still has a blank to fill in", () => {
    const s = base();
    s.report.sayItBetter = [
      { said: "It is good.", better: "It is good because [give one reason].", why: "w", source: "rule" },
      { said: "Um it is cheap.", better: "It is cheap.", why: "w", source: "rule" },
    ];
    expect(buildQuickReport(s).sayItBetter).toEqual({ said: "Um it is cheap.", better: "It is cheap." });
  });

  it("shows the student's own words with a fix when the AI quoted them", () => {
    const s = base();
    s.report.ai = ai({ improvements: [{ title: "Verb form", detail: "x", quote: "It have only the main parts", tip: "Say: it has." }, { title: "b", detail: "d", tip: "t" }] });
    expect(buildQuickReport(s).fix[0]).toMatchObject({ problem: "Verb form", quote: "It have only the main parts" });
  });
});
