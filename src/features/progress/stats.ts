import type { FieldId, Goal, Level } from "../content/types";
import { modulesFor } from "../content/modules";
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

/**
 * What a student who is not sure what to improve should work on, from how their recent sessions went:
 * many fillers means fluency, short answers means clarity, repeated plain words means vocabulary,
 * otherwise confidence. With no sessions yet, clarity (point, reason, example) is the best start.
 */
export function goalFromSessions(recent: Session[]): Goal {
  if (recent.length === 0) return "clarity";
  const filler = avg(recent.map((s) => s.speech.fillerPer100));
  const answerWords = avg(recent.map((s) => s.speech.avgAnswerWords));
  const variety = avg(recent.map((s) => s.speech.lexicalVariety));
  if (filler !== null && filler >= 3) return "fluency";
  if (answerWords !== null && answerWords < 25) return "clarity";
  if (variety !== null && variety < 0.5) return "vocabulary";
  return "confidence";
}

/**
 * Recommend the next module. The subject, difficulty and goal saved in the profile are kept (they are
 * changed only there). A choice the student left as "not sure yet" is worked out from their sessions:
 * the goal from how they spoke, the difficulty from the last session, the subject from the last module.
 * The recent sessions also decide the tip that is shown.
 */
export function recommendNext(profile: Profile, sessions: Session[]): Recommendation {
  const completed = sessions.filter((s) => s.completed); // newest first
  const recent = completed.slice(0, 3);

  const anyUnsure = profile.field === "unsure" || profile.level === "unsure" || profile.goal === "unsure";
  const goal: Goal = profile.goal === "unsure" ? goalFromSessions(recent) : profile.goal;
  const field: FieldId = profile.field === "unsure" ? (sessions[0]?.field ?? "management-leadership") : profile.field;
  let reason = anyUnsure
    ? "A friendly place to start. Try it, and we will suggest better ones as you practise."
    : "A good place to start, based on the subject, level and goal you chose.";
  let level: Level = profile.level === "unsure" ? "beginner" : profile.level;

  if (recent.length > 0) {
    const filler = avg(recent.map((s) => s.speech.fillerPer100));
    const answerWords = avg(recent.map((s) => s.speech.avgAnswerWords));
    const wpm = avg(recent.map((s) => s.speech.wpm));
    const variety = avg(recent.map((s) => s.speech.lexicalVariety));

    if (filler !== null && filler >= 3) {
      reason = `Filler words averaged ${filler.toFixed(1)} per 100 words in your last ${recent.length} session${recent.length > 1 ? "s" : ""}. Pause quietly instead of saying "um".`;
    } else if (answerWords !== null && answerWords < 25) {
      reason = `Your answers averaged ${Math.round(answerWords)} words. Add a reason and an example to each answer.`;
    } else if (wpm !== null && (wpm > 165 || wpm < 95)) {
      reason = `Your pace averaged ${Math.round(wpm)} words per minute. Aim for a steady speed.`;
    } else if (variety !== null && variety < 0.5) {
      reason = "You repeated many of the same words recently. Try new words from the passage.";
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
    } else if (
      // Step down after two weak sessions in a row, so the passage never stays too hard.
      strong.length === 2 &&
      strong.every((s) => (s.speech.avgAnswerWords ?? 99) < 15 && (s.speech.fillerPer100 ?? 0) >= 6) &&
      LEVEL_ORDER.indexOf(strong[0].level) > 0
    ) {
      level = LEVEL_ORDER[LEVEL_ORDER.indexOf(strong[0].level) - 1];
      reason = "Your last two sessions were hard, so here is an easier passage to build up from.";
    } else {
      level = recent[0].level;
    }
  }

  const choices = modulesFor(field, goal, profile.ageBand);
  const recentIds = new Set(recent.map((s) => s.moduleId));
  const target = choices.find((m) => m.level === level) ?? choices[0];
  // Prefer a module not practised recently so the passage is fresh.
  const candidates = [target, ...choices.filter((m) => m !== target)];
  const chosen = candidates.find((m) => !recentIds.has(m.id)) ?? target;
  return { module: chosen, goal, reason };
}
