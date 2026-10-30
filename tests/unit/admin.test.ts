import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSession } from "@/features/practice/finalize";
import { ProfileSchema, type Session } from "@/features/session/types";
import { recommendNext } from "@/features/progress/stats";
import type { ProgressSubmission } from "@/features/admin/types";
import { ProgressSubmissionSchema } from "@/features/admin/types";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const session = (n: number, over: Partial<Session> = {}): Session => ({
  ...buildSession({
    id: `s${n}`,
    startedAt: new Date(2026, 9, 1 + n, 10, 0).getTime(),
    endedAt: new Date(2026, 9, 1 + n, 10, 12).getTime(),
    budgetSec: 720,
    moduleId: "management-leadership-beginner-clarity-18plus",
    field: "management-leadership",
    level: "beginner",
    goal: "clarity",
    liveAi: false,
    readingSec: 60,
    passageWords: 120,
    reading: { mode: "silent", durationSec: 60 },
    turns: [
      { id: `c${n}`, role: "coach", text: "What does a leader do first?", at: 0 },
      { id: `a${n}`, role: "student", text: "I think a leader first listens to the team because that shows respect and gives good ideas.", at: 1, inputMode: "typed" },
    ],
    vision: null,
    keepTranscript: true,
    ai: null,
  }),
  completed: true,
  ...over,
});

describe("the profile has no age and no chosen difficulty", () => {
  const old = { displayName: "Asha", consent: { acceptedAt: 1, guardianConfirmed: true }, goal: "clarity" };

  it("treats a profile saved with an age and a difficulty as an adult who gets an automatic difficulty", () => {
    const p = ProfileSchema.parse({ ...old, ageBand: "under13", field: "management-hr", level: "advanced" });
    expect(p.ageBand).toBe("18plus");
    expect(p.level).toBe("unsure");
    expect(p.field).toBe("management-hr");
  });

  it("accepts a new profile with neither, and turns a subject that is no longer offered into 'not sure yet'", () => {
    const p = ProfileSchema.parse({ ...old, field: "science" });
    expect(p.ageBand).toBe("18plus");
    expect(p.level).toBe("unsure");
    expect(p.field).toBe("unsure");
  });

  it("does not need the guardian answer any more", () => {
    expect(ProfileSchema.safeParse({ displayName: "Asha", field: "unsure", goal: "unsure", consent: { acceptedAt: 1 } }).success).toBe(true);
  });
});

describe("the difficulty follows the student's sessions", () => {
  const profile = ProfileSchema.parse({ displayName: "Asha", field: "management-leadership", goal: "clarity", consent: { acceptedAt: 1 } });
  const speech = (words: number, filler: number) => ({ ...session(1).speech, avgAnswerWords: words, fillerPer100: filler });

  it("starts easy", () => {
    expect(recommendNext(profile, []).module.level).toBe("beginner");
  });

  it("steps up after two strong sessions", () => {
    const strong = [session(2, { speech: speech(55, 1) }), session(1, { speech: speech(50, 1) })];
    expect(recommendNext(profile, strong).module.level).toBe("intermediate");
  });

  it("steps down after two weak sessions at a higher level", () => {
    const weak = [2, 1].map((n) => session(n, { level: "intermediate", moduleId: "management-leadership-intermediate-clarity-18plus", speech: speech(8, 8) }));
    expect(recommendNext(profile, weak).module.level).toBe("beginner");
  });

  it("stays where it is after an ordinary session", () => {
    const ok = [session(1, { level: "intermediate", speech: speech(30, 2) })];
    expect(recommendNext(profile, ok).module.level).toBe("intermediate");
  });
});

describe("the admin's copy of the progress", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as { __talkzyMemory?: unknown }).__talkzyMemory;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.KV_REST_API_URL;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const submission = (id: string, name: string, n: number): ProgressSubmission => ({
    studentId: id,
    name,
    session: {
      id: `s${n}`,
      startedAt: 1_700_000_000_000 + n * 86_400_000,
      durationSec: 600,
      moduleId: "management-hr-beginner-clarity-18plus",
      moduleTitle: "A module",
      level: "beginner",
      goal: "clarity",
      completed: true,
      cameraOn: true,
      wpm: 120,
      fillerPer100: 2,
      avgAnswerWords: 40,
      headline: "Good start.",
    },
    report: [
      { t: "title", text: "My speaking report" },
      { t: "bullet", topic: "To fix", text: "Say more.", how: "Add an example." },
    ],
  });

  it("keeps each student's sessions and report, newest first, and replaces a session that is sent twice", async () => {
    const { getStore, recordProgress, listStudents, getReport } = await import("@/features/admin/store");
    const store = getStore();
    expect(store.kind).toBe("memory");
    await recordProgress(store, submission("student-aaaa-1111", "Asha", 1));
    await recordProgress(store, submission("student-aaaa-1111", "Asha", 2));
    await recordProgress(store, submission("student-aaaa-1111", "Asha", 2));
    await recordProgress(store, submission("student-bbbb-2222", "Ravi", 1));
    const students = await listStudents(store);
    expect(students.map((s) => s.name).sort()).toEqual(["Asha", "Ravi"]);
    const asha = students.find((s) => s.name === "Asha")!;
    expect(asha.sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
    const report = await getReport(store, "student-aaaa-1111", "s2");
    expect(report?.name).toBe("Asha");
    expect(JSON.stringify(report?.blocks)).toContain("Add an example.");
    expect(await getReport(store, "student-bbbb-2222", "s2")).toBeNull();
  });

  it("uses the database when its address and key are set", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.invalid/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const { getStore } = await import("@/features/admin/store");
    expect(getStore().kind).toBe("database");
  });

  it("accepts a good submission and refuses a bad one", () => {
    expect(ProgressSubmissionSchema.safeParse(submission("student-aaaa-1111", "Asha", 1)).success).toBe(true);
    expect(ProgressSubmissionSchema.safeParse({ ...submission("short", "Asha", 1) }).success).toBe(false);
    expect(ProgressSubmissionSchema.safeParse({ ...submission("student-aaaa-1111", "", 1) }).success).toBe(false);
    const withLink = { ...submission("student-aaaa-1111", "Asha", 1), report: [{ t: "link", text: "x", url: "https://example.com" }] };
    expect(ProgressSubmissionSchema.safeParse(withLink).success).toBe(false);
  });
});

describe("who may open the admin panel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays closed without a password of at least 8 characters", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "short");
    const a = await import("@/features/admin/auth");
    expect(a.adminPassword()).toBeUndefined();
    expect(a.passwordMatches("short")).toBe(false);
    expect(a.tokenIsValid(a.makeToken())).toBe(false);
  });

  it("opens only for the right password", async () => {
    const a = await import("@/features/admin/auth");
    expect(a.passwordMatches("correct horse battery")).toBe(true);
    expect(a.passwordMatches("correct horse batter")).toBe(false);
    expect(a.passwordMatches("")).toBe(false);
  });

  it("accepts its own sign-in token until it expires, and nothing else", async () => {
    const a = await import("@/features/admin/auth");
    const now = Date.now();
    const token = a.makeToken(now);
    expect(a.tokenIsValid(token, now + 1000)).toBe(true);
    expect(a.tokenIsValid(token, now + 13 * 60 * 60 * 1000)).toBe(false);
    expect(a.tokenIsValid(`${now + 99_999_999}.forged`, now)).toBe(false);
    expect(a.tokenIsValid(undefined, now)).toBe(false);
    const [exp, sig] = token.split(".");
    expect(a.tokenIsValid(`${Number(exp) + 1000}.${sig}`, now)).toBe(false);
  });

  it("slows down someone who keeps guessing", async () => {
    const a = await import("@/features/admin/auth");
    for (let i = 0; i < 8; i++) a.noteFailedAttempt("1.2.3.4");
    expect(a.tooManyAttempts("1.2.3.4")).toBe(true);
    expect(a.tooManyAttempts("5.6.7.8")).toBe(false);
    a.clearAttempts("1.2.3.4");
    expect(a.tooManyAttempts("1.2.3.4")).toBe(false);
  });
});
