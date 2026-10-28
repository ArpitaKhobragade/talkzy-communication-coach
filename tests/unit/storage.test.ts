import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSession } from "@/features/practice/finalize";
import type { Session } from "@/features/session/types";

/** A fake browser storage that refuses to hold more than `limit` characters, like a full browser. */
function fakeWindow(limit: number) {
  const data = new Map<string, string>();
  const size = () => [...data.values()].reduce((n, v) => n + v.length, 0);
  const localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const others = size() - (data.get(k)?.length ?? 0);
      if (others + v.length > limit) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  return { localStorage, dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };
}

const session = (n: number, text = "I think a bug report helps the team find the problem quickly because it says what happened."): Session =>
  buildSession({
    id: `s${n}`,
    startedAt: new Date(2026, 9, 1 + n, 10, 0).getTime(),
    endedAt: new Date(2026, 9, 1 + n, 10, 12).getTime(),
    budgetSec: 720,
    moduleId: "computer-science-intermediate",
    field: "computer-science",
    level: "intermediate",
    goal: "clarity",
    liveAi: false,
    readingSec: 60,
    passageWords: 120,
    reading: { mode: "silent", durationSec: 60 },
    turns: [
      { id: `c${n}`, role: "coach", text: "What does the engineer try to do first?", at: 0 },
      { id: `a${n}`, role: "student", text, at: 1, inputMode: "typed" },
    ],
    vision: null,
    keepTranscript: true,
    ai: null,
  });

describe("saving sessions when the browser's storage is full or blocked", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves normally when there is room", async () => {
    vi.stubGlobal("window", fakeWindow(1_000_000));
    const { saveSession, getSessions, isUnsaved } = await import("@/services/storage");
    expect(saveSession(session(1))).toBe(true);
    expect(getSessions().map((s) => s.id)).toEqual(["s1"]);
    expect(isUnsaved("s1")).toBe(false);
  });

  it("drops the oldest sessions to make room for the new one when storage is full", async () => {
    const one = JSON.stringify(session(1)).length;
    vi.stubGlobal("window", fakeWindow(one * 4)); // room for about four sessions
    const { saveSession, getSessions, isUnsaved } = await import("@/services/storage");
    for (let i = 1; i <= 12; i++) expect(saveSession(session(i))).toBe(true);
    const ids = getSessions().map((s) => s.id);
    expect(ids[0]).toBe("s12"); // the newest is always kept
    expect(ids.length).toBeLessThanOrEqual(4);
    expect(isUnsaved("s12")).toBe(false);
  });

  it("keeps the new session in memory for this tab when storage will not take anything", async () => {
    vi.stubGlobal("window", fakeWindow(10)); // nothing fits
    const { saveSession, getSessions, isUnsaved } = await import("@/services/storage");
    expect(saveSession(session(1))).toBe(true);
    expect(getSessions().map((s) => s.id)).toEqual(["s1"]);
    expect(isUnsaved("s1")).toBe(true);
  });
});
