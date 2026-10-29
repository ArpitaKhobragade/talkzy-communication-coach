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
    const { trySaveSession, getSessions, isUnsaved } = await import("@/services/storage");
    expect(trySaveSession(session(1))).toBe("saved");
    expect(getSessions().map((s) => s.id)).toEqual(["s1"]);
    expect(isUnsaved("s1")).toBe(false);
  });

  it("never deletes old sessions by itself: when storage is full it says so and keeps every old session", async () => {
    const one = JSON.stringify(session(1)).length;
    vi.stubGlobal("window", fakeWindow(one * 4)); // room for about four sessions
    const { trySaveSession, getSessions } = await import("@/services/storage");
    const results: string[] = [];
    for (let i = 1; i <= 8; i++) results.push(trySaveSession(session(i)));
    expect(results.slice(0, 3)).toEqual(["saved", "saved", "saved"]);
    expect(results).toContain("full");
    // Everything that was saved is still there.
    const ids = getSessions().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["s1", "s2", "s3"]));
  });

  it("saves the new session once the student has deleted enough old ones", async () => {
    const one = JSON.stringify(session(1)).length;
    vi.stubGlobal("window", fakeWindow(Math.round(one * 3.4)));
    const { trySaveSession, deleteSession, getSessions } = await import("@/services/storage");
    for (let i = 1; i <= 3; i++) expect(trySaveSession(session(i))).toBe("saved");
    expect(trySaveSession(session(4))).toBe("full");
    expect(deleteSession("s1")).toBe(true);
    expect(trySaveSession(session(4))).toBe("saved");
    expect(getSessions().map((s) => s.id)).toEqual(["s4", "s3", "s2"]);
  });

  it("keeps the new session in memory for this tab only when the student opens the report without saving", async () => {
    vi.stubGlobal("window", fakeWindow(10)); // nothing fits
    const { trySaveSession, keepInMemory, getSessions, isUnsaved } = await import("@/services/storage");
    expect(trySaveSession(session(1))).toBe("full");
    expect(getSessions()).toEqual([]);
    expect(keepInMemory(session(1))).toBe(true);
    expect(getSessions().map((s) => s.id)).toEqual(["s1"]);
    expect(isUnsaved("s1")).toBe(true);
  });
});
