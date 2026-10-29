import type { Session } from "../session/types";

export const DAILY_LIMIT_SEC = 20 * 60;
/** Target length of one session (reading + conversation). */
export const SESSION_TARGET_SEC = 12 * 60;
/** Below this much remaining time we do not start a new session. */
export const MIN_SESSION_SEC = 5 * 60;

/** Local calendar day key, e.g. "2026-10-26". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function secondsPracticedOn(sessions: Pick<Session, "startedAt" | "durationSec">[], key: string): number {
  return sessions.filter((s) => dayKey(s.startedAt) === key).reduce((sum, s) => sum + s.durationSec, 0);
}

export interface SessionPlan {
  usedSec: number;
  remainingSec: number;
  /** Time budget for the session about to start. */
  budgetSec: number;
  canStart: boolean;
  reason?: string;
}

export function planSession(sessions: Pick<Session, "startedAt" | "durationSec">[], now: number): SessionPlan {
  const usedSec = Math.min(DAILY_LIMIT_SEC, Math.round(secondsPracticedOn(sessions, dayKey(now))));
  const remainingSec = DAILY_LIMIT_SEC - usedSec;
  const budgetSec = Math.min(SESSION_TARGET_SEC, remainingSec);
  if (remainingSec < MIN_SESSION_SEC) {
    return {
      usedSec,
      remainingSec,
      budgetSec: 0,
      canStart: false,
      reason:
        remainingSec <= 0
          ? "You have reached today's 20-minute practice limit. Great work. Come back tomorrow!"
          : "Less than 5 minutes are left in today's 20-minute limit, which is too short for a full session. See you tomorrow!",
    };
  }
  return { usedSec, remainingSec, budgetSec, canStart: true };
}

/** Consecutive days (ending today or yesterday) with at least one completed session. */
export function currentStreak(sessions: Pick<Session, "startedAt" | "completed">[], now: number): number {
  const days = new Set(sessions.filter((s) => s.completed).map((s) => dayKey(s.startedAt)));
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Minutes practised on each of the last `n` local days, oldest first. */
export function minutesPerDay(sessions: Pick<Session, "startedAt" | "durationSec">[], now: number, n = 7) {
  const out: { key: string; label: string; minutes: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d.getTime());
    out.push({
      key,
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      minutes: Math.round((secondsPracticedOn(sessions, key) / 60) * 10) / 10,
    });
  }
  return out;
}
