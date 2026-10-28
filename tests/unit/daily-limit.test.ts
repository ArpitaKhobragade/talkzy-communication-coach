import { describe, expect, it } from "vitest";
import { currentStreak, DAILY_LIMIT_SEC, dayKey, minutesPerDay, planSession, SESSION_TARGET_SEC } from "@/features/progress/daily-limit";

const at = (y: number, mo: number, d: number, h = 10) => new Date(y, mo - 1, d, h).getTime();
const s = (startedAt: number, durationSec: number, completed = true) => ({ startedAt, durationSec, completed });

describe("planSession", () => {
  const now = at(2026, 10, 26, 15);

  it("allows a full-length session on a fresh day", () => {
    const p = planSession([], now);
    expect(p.canStart).toBe(true);
    expect(p.budgetSec).toBe(SESSION_TARGET_SEC);
    expect(p.remainingSec).toBe(DAILY_LIMIT_SEC);
  });

  it("shrinks the budget to what is left today", () => {
    const p = planSession([s(at(2026, 10, 26, 8), 11 * 60)], now);
    expect(p.remainingSec).toBe(9 * 60);
    expect(p.budgetSec).toBe(9 * 60);
  });

  it("blocks starting when under 5 minutes remain", () => {
    const p = planSession([s(at(2026, 10, 26, 8), 17 * 60)], now);
    expect(p.canStart).toBe(false);
    expect(p.reason).toBeTruthy();
  });

  it("does not count yesterday's practice", () => {
    const p = planSession([s(at(2026, 10, 25, 20), 20 * 60)], now);
    expect(p.canStart).toBe(true);
    expect(p.usedSec).toBe(0);
  });

  it("never reports more than the limit even with overshoot", () => {
    const p = planSession([s(at(2026, 10, 26, 8), 25 * 60)], now);
    expect(p.remainingSec).toBe(0);
    expect(p.canStart).toBe(false);
  });
});

describe("currentStreak", () => {
  const now = at(2026, 10, 26, 15);
  it("counts consecutive days ending today", () => {
    const sessions = [s(at(2026, 10, 26), 60), s(at(2026, 10, 25), 60), s(at(2026, 10, 24), 60)];
    expect(currentStreak(sessions, now)).toBe(3);
  });
  it("keeps the streak alive if today is not practised yet", () => {
    expect(currentStreak([s(at(2026, 10, 25), 60), s(at(2026, 10, 24), 60)], now)).toBe(2);
  });
  it("resets after a missed day and ignores incomplete sessions", () => {
    expect(currentStreak([s(at(2026, 10, 24), 60)], now)).toBe(0);
    expect(currentStreak([s(at(2026, 10, 26), 60, false)], now)).toBe(0);
  });
});

describe("minutesPerDay", () => {
  it("returns n days, oldest first, with rounded minutes", () => {
    const now = at(2026, 10, 26, 15);
    const out = minutesPerDay([s(at(2026, 10, 26), 90)], now, 3);
    expect(out).toHaveLength(3);
    expect(out[2].key).toBe(dayKey(now));
    expect(out[2].minutes).toBe(1.5);
    expect(out[0].minutes).toBe(0);
  });
});
