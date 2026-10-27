import type { CoachingItem, Session } from "../session/types";

/*
 * The short version of a report: a headline, what went well, what to fix and how, one "say it like
 * this" example and one thing to practise. It is the first thing the student sees, and it is also
 * what the PDF and text files contain. The longer detail stays on the report page, folded away.
 */

export type Area = "Reading" | "Answering" | "Camera";

export interface QuickGood {
  area: Area;
  text: string;
}

export interface QuickFix {
  area: Area;
  problem: string;
  /** The student's own words that show the problem, when there is a real quote. */
  quote?: string;
  /** What to do about it, in one sentence. */
  how?: string;
}

export interface QuickReport {
  headline: string;
  good: QuickGood[];
  fix: QuickFix[];
  sayItBetter: { said: string; better: string } | null;
  practice: { title: string; minutes: number; instructions: string } | null;
}

export const MAX_GOOD = 2;
export const MAX_FIX = 2;

const AREAS: Area[] = ["Answering", "Reading", "Camera"];

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * Praise that would be true of any student ("you answered every question"). It teaches nothing, and
 * the AI sometimes writes it even when the answers were off the topic, so it is never shown.
 */
const GENERIC_PRAISE = /(answer(ed)? (every|each|all)|every question|each (question|coach)|gave (a|an) (reply|response)|tried (hard|your best)|good effort|great effort|well done for trying|keep it up)/i;

/** A "say it like this" sentence that still has a blank to fill in is a template, not an example. */
const hasPlaceholder = (s: string) => /\[[^\]]*\]/.test(s);

/** Takes one item from each area in turn, so the short report is not all about one thing. */
function spread<T extends { area: Area }>(byArea: Record<Area, T[]>, max: number): T[] {
  const out: T[] = [];
  for (let round = 0; out.length < max && round < 3; round++) {
    for (const area of AREAS) {
      const item = byArea[area][round];
      if (item && out.length < max) out.push(item);
    }
  }
  return out;
}

function goodFrom(items: CoachingItem[] | undefined, area: Area): QuickGood[] {
  return (items ?? []).filter((i) => i.kind === "good" && clean(i.observation)).map((i) => ({ area, text: clean(i.observation) }));
}

function fixFrom(items: CoachingItem[] | undefined, area: Area): QuickFix[] {
  return (items ?? [])
    .filter((i) => i.kind === "improve" && clean(i.observation))
    .map((i) => ({ area, problem: clean(i.observation), how: clean(i.howTo) || undefined }));
}

export function buildQuickReport(s: Session): QuickReport {
  const r = s.report;
  const ai = r.ai;

  // Points about the reading and the answers' numbers come from the measurements, not from the AI's wording,
  // so they are always true. The AI's own points follow, without empty praise.
  const good: Record<Area, QuickGood[]> = {
    Answering: [
      ...goodFrom(r.answerCoaching, "Answering"),
      ...(ai ? ai.strengths.map((x) => ({ area: "Answering" as const, text: clean(x.detail) || clean(x.title) })).filter((x) => !GENERIC_PRAISE.test(x.text)) : []),
    ],
    Reading: goodFrom(r.readingCoaching, "Reading"),
    Camera: goodFrom(r.bodyLanguageCoaching, "Camera"),
  };
  const fix: Record<Area, QuickFix[]> = {
    Answering: ai
      ? ai.improvements.map((x) => ({ area: "Answering" as const, problem: clean(x.title) || clean(x.detail), quote: clean(x.quote) || undefined, how: clean(x.tip) || undefined }))
      : fixFrom(r.answerCoaching, "Answering"),
    Reading: fixFrom(r.readingCoaching, "Reading"),
    Camera: fixFrom(r.bodyLanguageCoaching, "Camera"),
  };
  for (const area of AREAS) {
    good[area] = good[area].filter((x) => x.text);
    fix[area] = fix[area].filter((x) => x.problem);
  }

  const shownGood = spread(good, MAX_GOOD);
  const shownFix = spread(fix, MAX_FIX);

  const say = r.sayItBetter?.find((x) => !hasPlaceholder(x.better) && clean(x.better) !== clean(x.said));
  const exercise = (ai ? ai.exercises : r.fallbackExercises)[0];

  return {
    headline: clean(ai?.headline) || (shownGood.length ? "Good effort today. Here is what to keep and what to fix." : "Here is what to work on next."),
    good: shownGood,
    fix: shownFix,
    sayItBetter: say ? { said: say.said, better: say.better } : null,
    practice: exercise ? { title: clean(exercise.title), minutes: exercise.minutes, instructions: clean(exercise.instructions) } : null,
  };
}
