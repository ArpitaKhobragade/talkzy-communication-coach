import type { Goal, Level } from "../content/types";
import { MODULES } from "../content/modules";
import type { LearningModule } from "../content/types";
import type { Profile, Session } from "../session/types";

export interface TrendPoint {
  sessionId: string;
  startedAt: number;
  wpm: number | null;
  fillerPer100: number | null;
  avgAnswerWords: number | null;
  readingAccuracy: number | null;
  minutes: number;
}

/** Oldest first, completed sessions only. */
export function trendSeries(sessions: Session[]): TrendPoint[] {
  return sessions
    .filter((s) => s.completed)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({
      sessionId: s.id,
      startedAt: s.startedAt,
      wpm: s.speech.wpm,
      fillerPer100: s.speech.fillerPer100,
      avgAnswerWords: s.speech.avgAnswerWords,
      readingAccuracy: s.reading.aloud ? s.reading.aloud.accuracyPct : null,
      minutes: Math.round((s.durationSec / 60) * 10) / 10,
    }));
}

/** A trend needs at least two sessions to compare; with one there is nothing to compare. */
const MIN_POINTS_FOR_TREND = 2;

type Direction = "better" | "worse" | "steady";

/**
 * Compare the earlier half to the later half of a series. Returns null unless there are
 * enough data points, so we never claim a trend from one or two sessions.
 */
export function compareHalves(values: (number | null)[], lowerIsBetter: boolean, tolerance: number) {
  const xs = values.filter((v): v is number => v !== null);
  if (xs.length < MIN_POINTS_FOR_TREND) return null;
  const mid = Math.floor(xs.length / 2);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const before = avg(xs.slice(0, mid));
  const after = avg(xs.slice(xs.length - mid));
  const diff = after - before;
  const direction: Direction = Math.abs(diff) <= tolerance ? "steady" : (diff < 0) === lowerIsBetter ? "better" : "worse";
  return { before: Math.round(before * 10) / 10, after: Math.round(after * 10) / 10, direction };
}

export interface Insight {
  label: string;
  text: string;
  direction: Direction;
}

export function progressInsights(sessions: Session[]): Insight[] {
  const pts = trendSeries(sessions);
  const out: Insight[] = [];

  const filler = compareHalves(pts.map((p) => p.fillerPer100), true, 0.5);
  if (filler) {
    out.push({
      label: "Filler words",
      direction: filler.direction,
      text: `${filler.before} to ${filler.after} per 100 words (earlier vs recent sessions).`,
    });
  }
  const answers = compareHalves(pts.map((p) => p.avgAnswerWords), false, 3);
  if (answers) {
    out.push({
      label: "Answer length",
      direction: answers.direction,
      text: `${answers.before} to ${answers.after} words per answer on average.`,
    });
  }
  const reading = compareHalves(pts.map((p) => p.readingAccuracy), false, 2);
  if (reading) {
    out.push({
      label: "Reading accuracy",
      direction: reading.direction,
      text: `${reading.before}% to ${reading.after}% of words matched when reading aloud.`,
    });
  }
  return out;
}

const LEVEL_ORDER: Level[] = ["beginner", "intermediate", "advanced"];

export interface Recommendation {
  module: LearningModule;
  goal: Goal;
  reason: string;
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Recommend the next module and focus from what the student's recent sessions actually showed. */
export function recommendNext(profile: Profile, sessions: Session[]): Recommendation {
  const completed = sessions.filter((s) => s.completed); // newest first
  const recent = completed.slice(0, 3);

  let goal: Goal = profile.goal;
  let reason = "A good place to start, based on the field, level and goal you chose.";
  let level: Level = profile.level;

  if (recent.length > 0) {
    const filler = avg(recent.map((s) => s.speech.fillerPer100));
    const answerWords = avg(recent.map((s) => s.speech.avgAnswerWords));
    const wpm = avg(recent.map((s) => s.speech.wpm));
    const variety = avg(recent.map((s) => s.speech.lexicalVariety));

    if (filler !== null && filler >= 3) {
      goal = "fluency";
      reason = `Filler words averaged ${filler.toFixed(1)} per 100 words in your last ${recent.length} session${recent.length > 1 ? "s" : ""}. Let's practise smoother delivery.`;
    } else if (answerWords !== null && answerWords < 25) {
      goal = "clarity";
      reason = `Your answers averaged ${Math.round(answerWords)} words. Let's practise explaining with a reason and an example.`;
    } else if (wpm !== null && (wpm > 165 || wpm < 95)) {
      goal = "fluency";
      reason = `Your pace averaged ${Math.round(wpm)} words per minute. Let's practise a steadier speed.`;
    } else if (variety !== null && variety < 0.5) {
      goal = "vocabulary";
      reason = "You repeated many of the same words recently. Let's practise using richer vocabulary.";
    } else {
      reason = "Your recent sessions look steady. Keep the habit going.";
    }

    // Step up a level after two strong sessions in a row at the current level.
    const strong = recent.slice(0, 2);
    if (
      strong.length === 2 &&
      strong.every((s) => (s.speech.avgAnswerWords ?? 0) >= 40 && (s.speech.fillerPer100 ?? 0) < 2.5) &&
      LEVEL_ORDER.indexOf(strong[0].level) < LEVEL_ORDER.length - 1
    ) {
      level = LEVEL_ORDER[LEVEL_ORDER.indexOf(strong[0].level) + 1];
      reason = "Your last two sessions went very well, so here is a step up in difficulty.";
    } else {
      level = recent[0].level;
    }
  }

  const fieldModules = MODULES.filter((m) => m.field === profile.field);
  const recentIds = new Set(recent.map((s) => s.moduleId));
  const target = fieldModules.find((m) => m.level === level) ?? fieldModules[0];
  // Prefer a module not practised recently so the passage is fresh.
  const candidates = [target, ...fieldModules.filter((m) => m !== target)];
  const chosen = candidates.find((m) => !recentIds.has(m.id)) ?? target;
  return { module: chosen, goal, reason };
}
