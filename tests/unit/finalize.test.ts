import { describe, expect, it } from "vitest";
import { buildSession, type FinalizeInput } from "@/features/practice/finalize";
import { SessionSchema, type Turn } from "@/features/session/types";

const turn = (role: Turn["role"], text: string, extra: Partial<Turn> = {}): Turn => ({ id: Math.random().toString(), role, text, at: 0, ...extra });

const input = (over: Partial<FinalizeInput> = {}): FinalizeInput => ({
  id: "abc",
  startedAt: 1_000_000,
  endedAt: 1_000_000 + 600_000,
  budgetSec: 720,
  moduleId: "computer-science-beginner",
  field: "computer-science",
  level: "beginner",
  goal: "clarity",
  liveAi: false,
  readingSec: 100,
  passageWords: 120,
  reading: { mode: "silent", durationSec: 100 },
  turns: [
    turn("coach", "What did you learn?"),
    turn("student", "I learned that programs are instructions written by people", { inputMode: "typed" }),
    turn("coach", "Why does that matter?"),
    turn("student", "Because computers need clear steps to work correctly every time", { inputMode: "typed" }),
  ],
  vision: null,
  keepTranscript: true,
  ai: null,
  aiReason: "Development mode",
  ...over,
});

describe("buildSession", () => {
  it("produces a schema-valid session", () => {
    expect(SessionSchema.safeParse(buildSession(input())).success).toBe(true);
  });

  it("caps counted time at the session budget", () => {
    const s = buildSession(input({ endedAt: 1_000_000 + 2_000_000, budgetSec: 720 }));
    expect(s.durationSec).toBe(720);
    expect(s.readingSec + s.conversationSec).toBe(720);
  });

  it("marks sessions with fewer than two answers as not completed", () => {
    expect(buildSession(input({ turns: [turn("coach", "hi"), turn("student", "hello", { inputMode: "typed" })] })).completed).toBe(false);
    expect(buildSession(input()).completed).toBe(true);
  });

  it("drops the transcript when the student does not want it kept", () => {
    const s = buildSession(input({ keepTranscript: false }));
    expect(s.turns).toEqual([]);
    expect(s.transcriptKept).toBe(false);
    expect(s.speech.totalWords).toBeGreaterThan(0);
  });

  it("labels the mode and records why AI feedback is missing", () => {
    const dev = buildSession(input());
    expect(dev.mode).toBe("dev");
    expect(dev.report.generatedBy).toBe("dev");
    expect(dev.report.aiUnavailableReason).toBe("Development mode");
    expect(buildSession(input({ liveAi: true })).mode).toBe("live");
  });
});
