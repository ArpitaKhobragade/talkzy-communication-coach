import { describe, expect, it } from "vitest";
import { fieldChoiceName, goalChoiceName, levelChoiceName, NOT_SURE_NAME } from "@/features/content/fields";
import { modulesForProfile } from "@/features/content/modules";
import type { AgeGroup, FieldId, Goal, Level } from "@/features/content/types";
import { goalFromSessions, recommendNext } from "@/features/progress/stats";
import { ProfileSchema, type Profile, type Session } from "@/features/session/types";
import { computeSpeechMetrics } from "@/features/speech/metrics";

/** Nobody is asked their age any more, so every student gets the adult modules. */
const AGES: AgeGroup[] = ["18plus"];
const FIELD: FieldId = "management-leadership";
const LEVEL: Level = "intermediate";
const GOAL: Goal = "clarity";

/** Every way of knowing or not knowing the subject, the difficulty and the goal. */
const COMBOS = [false, true].flatMap((f) => [false, true].flatMap((l) => [false, true].map((g) => ({ f, l, g }))));

const choices = (c: { f: boolean; l: boolean; g: boolean }, ageBand: AgeGroup) => ({
  field: c.f ? ("unsure" as const) : FIELD,
  level: c.l ? ("unsure" as const) : LEVEL,
  goal: c.g ? ("unsure" as const) : GOAL,
  ageBand,
});

/** How many modules each case should give. */
const EXPECTED_SIZE = (c: { f: boolean; l: boolean; g: boolean }) => {
  if (!c.f && !c.l && !c.g) return 3; // all chosen
  if (!c.f && !c.l && c.g) return 5; // every goal
  if (!c.f && c.l && !c.g) return 3; // every difficulty
  if (c.f && !c.l && !c.g) return 6; // every subject
  if (!c.f && c.l && c.g) return 5; // every goal, easy
  if (c.f && !c.l && c.g) return 5; // every goal, different subjects
  if (c.f && c.l && !c.g) return 6; // every subject, easy
  return 6; // nothing chosen: starter set
};

describe("modulesForProfile: every mix of known and not sure", () => {
  for (const age of AGES)
    for (const c of COMBOS) {
      const name = `${age}: subject ${c.f ? "unsure" : "known"}, level ${c.l ? "unsure" : "known"}, goal ${c.g ? "unsure" : "known"}`;
      it(name, () => {
        const r = modulesForProfile(choices(c, age));
        const ids = r.modules.map((m) => m.id);
        expect(r.modules).toHaveLength(EXPECTED_SIZE(c));
        expect(r.modules.length).toBeGreaterThanOrEqual(1);
        expect(r.modules.length).toBeLessThanOrEqual(8);
        expect(new Set(ids).size, "no duplicates").toBe(ids.length);
        expect(r.unsure).toEqual({ field: c.f, level: c.l, goal: c.g });
        for (const m of r.modules) {
          expect(m.age, "only the student's age group").toBe(age);
          if (!c.f) expect(m.field).toBe(FIELD);
          // With the subject and the goal chosen, the library shows all three difficulties (their own first).
          if (!c.l && (c.f || c.g)) expect(m.level).toBe(LEVEL);
          if (!c.g) expect(m.goal).toBe(GOAL);
        }
      });
    }
});

describe("modulesForProfile: what is shown in each case", () => {
  const run = (c: { f: boolean; l: boolean; g: boolean }, age: AgeGroup = "18plus") => modulesForProfile(choices(c, age)).modules;

  it("all chosen: the student's own level first, then the others from easy to hard", () => {
    expect(run({ f: false, l: false, g: false }).map((m) => m.level)).toEqual(["intermediate", "beginner", "advanced"]);
  });

  it("not sure what to improve: one module for every goal, at the chosen level", () => {
    const list = run({ f: false, l: false, g: true });
    expect(list.map((m) => m.goal).sort()).toEqual(["clarity", "confidence", "fluency", "interview", "vocabulary"]);
    expect(list.every((m) => m.level === LEVEL && m.field === FIELD)).toBe(true);
  });

  it("not sure how hard: all three difficulties, easiest first", () => {
    expect(run({ f: false, l: true, g: false }).map((m) => m.level)).toEqual(["beginner", "intermediate", "advanced"]);
  });

  it("not sure about the subject: one module for every subject", () => {
    const list = run({ f: true, l: false, g: false });
    expect(new Set(list.map((m) => m.field)).size).toBe(6);
    expect(list[0].field).toBe("business-marketing");
  });

  it("not sure about the goal and the difficulty: every goal, easy", () => {
    const list = run({ f: false, l: true, g: true });
    expect(list.every((m) => m.level === "beginner")).toBe(true);
    expect(new Set(list.map((m) => m.goal)).size).toBe(5);
  });

  it("not sure about the subject and the goal: every goal, in different subjects, marketing first", () => {
    const list = run({ f: true, l: false, g: true });
    expect(new Set(list.map((m) => m.goal)).size).toBe(5);
    expect(new Set(list.map((m) => m.field)).size).toBe(5);
    expect(list.every((m) => m.level === LEVEL)).toBe(true);
    expect(list[0].field).toBe("business-marketing");
  });

  it("not sure about the subject and the difficulty: one easy module for every subject", () => {
    const list = run({ f: true, l: true, g: false });
    expect(new Set(list.map((m) => m.field)).size).toBe(6);
    expect(list.every((m) => m.level === "beginner" && m.goal === GOAL)).toBe(true);
  });

  it("nothing chosen: six easy modules covering all five goals, marketing first", () => {
    const list = run({ f: true, l: true, g: true });
    expect(list).toHaveLength(6);
    expect(list.every((m) => m.level === "beginner")).toBe(true);
    expect(new Set(list.map((m) => m.goal)).size).toBe(5);
    expect(list[0].field).toBe("business-marketing");
  });
});

describe("profiles with 'unsure'", () => {
  const base = { displayName: "Asha", ageBand: "13to17", consent: { acceptedAt: 1, guardianConfirmed: false } };

  it("accepts 'unsure' for the subject, the difficulty and the goal", () => {
    const r = ProfileSchema.safeParse({ ...base, field: "unsure", level: "unsure", goal: "unsure" });
    expect(r.success).toBe(true);
  });

  it("still accepts a profile saved before 'unsure' existed, and rejects other values", () => {
    expect(ProfileSchema.safeParse({ ...base, field: "science", level: "advanced", goal: "interview" }).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...base, field: "maybe", level: "advanced", goal: "interview" }).success).toBe(false);
  });

  it("names a choice that is not made 'Not sure yet'", () => {
    expect(fieldChoiceName("unsure")).toBe(NOT_SURE_NAME);
    expect(levelChoiceName("unsure")).toBe("Not sure yet");
    expect(goalChoiceName("unsure")).toBe("Not sure yet");
    expect(fieldChoiceName("science")).toBe("Science");
    expect(levelChoiceName("advanced")).toBe("Advanced");
    expect(goalChoiceName("fluency")).toBe("Speak more fluently");
  });
});

describe("recommendNext with 'not sure yet' choices", () => {
  const unsureProfile = (over: Partial<Profile> = {}): Profile => ({
    displayName: "Asha",
    ageBand: "18plus",
    field: "unsure",
    level: "unsure",
    goal: "unsure",
    consent: { acceptedAt: 0, guardianConfirmed: false },
    ...over,
  });

  const session = (i: number, speech: Partial<ReturnType<typeof computeSpeechMetrics>>, over: Partial<Session> = {}): Session => ({
    id: `s${i}`,
    startedAt: 1_700_000_000_000 + i * 86_400_000,
    endedAt: 1_700_000_000_000 + i * 86_400_000 + 600_000,
    moduleId: "science-intermediate-clarity-13to17",
    field: "science",
    level: "intermediate",
    goal: "clarity",
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
  });

  it("with no history: clarity, beginner, school topics, and a plain true reason", () => {
    const r = recommendNext(unsureProfile(), []);
    expect(r.goal).toBe("clarity");
    expect(r.module.level).toBe("beginner");
    expect(r.module.field).toBe("management-leadership");
    expect(r.module.age).toBe("18plus");
    expect(r.reason).toMatch(/friendly place to start/i);
    expect(r.reason).not.toMatch(/you chose/i);
  });

  it("picks the goal from how the student spoke", () => {
    expect(goalFromSessions([])).toBe("clarity");
    expect(goalFromSessions([session(1, { fillerPer100: 6, avgAnswerWords: 50 })])).toBe("fluency");
    expect(goalFromSessions([session(1, { fillerPer100: 1, avgAnswerWords: 10 })])).toBe("clarity");
    expect(goalFromSessions([session(1, { fillerPer100: 1, avgAnswerWords: 50, lexicalVariety: 0.3 })])).toBe("vocabulary");
    expect(goalFromSessions([session(1, { fillerPer100: 1, avgAnswerWords: 50, lexicalVariety: 0.8 })])).toBe("confidence");
  });

  it("uses the last module's subject and difficulty, and the goal the sessions point to", () => {
    const r = recommendNext(unsureProfile(), [session(2, { fillerPer100: 6, avgAnswerWords: 50 })]);
    expect(r.goal).toBe("fluency");
    expect(r.module.field).toBe("science");
    expect(r.module.goal).toBe("fluency");
    expect(r.module.level).toBe("intermediate");
    expect(r.reason).toMatch(/Filler words averaged 6\.0/);
  });

  it("keeps the choices the student did make", () => {
    const r = recommendNext(unsureProfile({ field: "management-finance", level: "advanced" }), []);
    expect(r.module.field).toBe("management-finance");
    expect(r.module.level).toBe("advanced");
    expect(r.goal).toBe("clarity");
    const g = recommendNext(unsureProfile({ goal: "interview" }), []);
    expect(g.goal).toBe("interview");
    expect(g.module.level).toBe("beginner");
  });

  it("works for every age group", () => {
    for (const a of AGES) expect(recommendNext(unsureProfile({ ageBand: a }), []).module.age).toBe(a);
  });
});
