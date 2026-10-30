import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSession } from "@/features/practice/finalize";
import { repairSession } from "@/features/session/repair";
import type { Session, VisionMetrics } from "@/features/session/types";

const vision = (over: Partial<VisionMetrics> = {}): VisionMetrics => ({
  framesAnalyzed: 120,
  durationSec: 60,
  facePresentPct: 96,
  cameraFacingPct: 80,
  avgHeadYawDeg: 3,
  avgHeadPitchDeg: -2,
  shoulderTiltDeg: 1,
  uprightPct: 90,
  bodyVisiblePct: 70,
  handsVisiblePct: 20,
  movementIndex: 0.2,
  movementLevel: "moderate",
  facialMovementIndex: 0.3,
  facialMovementLevel: "moderate",
  ...over,
});

const session = (v: VisionMetrics | null): Session =>
  buildSession({
    id: "s1",
    startedAt: new Date(2026, 9, 2, 10, 0).getTime(),
    endedAt: new Date(2026, 9, 2, 10, 12).getTime(),
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
      { id: "c1", role: "coach", text: "What does a leader do first?", at: 0 },
      { id: "a1", role: "student", text: "I think a leader first listens to the team because that shows respect.", at: 1, inputMode: "typed" },
    ],
    vision: v,
    cameraOn: true,
    keepTranscript: true,
    ai: null,
  });

describe("a finished session always fits the saved format", () => {
  it("leaves a good session as it is", () => {
    const s = session(vision());
    expect(repairSession(s)?.vision?.facePresentPct).toBe(96);
  });

  it("puts right camera numbers that are slightly out of range or not numbers", () => {
    const odd = session(vision({ facePresentPct: 100.0000001, uprightPct: -0.0000002, avgHeadYawDeg: Number.NaN, framesAnalyzed: 119.6, durationSec: -0.01 }));
    const fixed = repairSession(odd);
    expect(fixed).not.toBeNull();
    expect(fixed?.vision?.facePresentPct).toBe(100);
    expect(fixed?.vision?.uprightPct).toBe(0);
    expect(fixed?.vision?.avgHeadYawDeg).toBeNull();
    expect(fixed?.vision?.framesAnalyzed).toBe(120);
    expect(fixed?.vision?.durationSec).toBe(0);
  });

  it("cuts text that is too long", () => {
    const s = session(null);
    s.report.speechNotes = ["x".repeat(5000)];
    const fixed = repairSession({ ...s, turns: [{ ...s.turns[0], text: "y".repeat(9000) }] });
    expect(fixed).not.toBeNull();
  });

  it("leaves out the camera data when it cannot be put right", () => {
    const broken = session(vision({ movementLevel: "wild" as never }));
    const fixed = repairSession(broken);
    expect(fixed).not.toBeNull();
    expect(fixed?.vision).toBeNull();
  });

  it("gives up only on something that is not a session at all", () => {
    expect(repairSession({ id: "x" })).toBeNull();
    expect(repairSession(null)).toBeNull();
  });
});

describe("saving never loses a session the browser or the format refuses", () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: () => { throw new DOMException("full", "QuotaExceededError"); }, removeItem: (k: string) => void store.delete(k) },
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves a session with odd camera numbers once the browser has room, and keeps it in memory when it has none", async () => {
    const { trySaveSession, keepInMemory, getSessions, isUnsaved } = await import("@/services/storage");
    const odd = session(vision({ facePresentPct: 100.0000001, avgHeadYawDeg: Number.NaN }));
    expect(trySaveSession(odd)).toBe("full"); // the browser refuses every write
    expect(keepInMemory(odd)).toBe(true);
    expect(getSessions().map((s) => s.id)).toEqual(["s1"]);
    expect(isUnsaved("s1")).toBe(true);
  });

  it("keeps even a session that cannot be put in the saved format at all, so its report can still open", async () => {
    const { keepInMemory, getSessions } = await import("@/services/storage");
    const strange = { ...session(null), mode: "other" } as unknown as Session;
    expect(keepInMemory(strange)).toBe(true);
    expect(getSessions().map((s) => s.id)).toEqual(["s1"]);
  });
});
