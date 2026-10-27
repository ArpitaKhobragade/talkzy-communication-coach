import type { CoachingItem, Session } from "../session/types";

/*
 * The report in a few lines: a headline, what went well, what to fix and how, one "say it like this"
 * example, and what the camera saw. It is what the PDF contains.
 */

export type Area = "Reading" | "Answering";

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

export interface QuickCamera {
  /** "ok": the camera was analysed. "unavailable": it was on but could not be used. "off": it was not used. */
  status: "ok" | "unavailable" | "off";
  /** How the student came across, in one sentence (nervous, tense, relaxed...). */
  looked: string | null;
  good: string[];
  fix: { problem: string; how?: string }[];
}

export interface QuickReport {
  headline: string;
  /** Nothing the student said was captured, so there is nothing to review. */
  noAnswers: boolean;
  good: QuickGood[];
  fix: QuickFix[];
  sayItBetter: { said: string; better: string } | null;
  camera: QuickCamera;
}

export const MAX_GOOD = 2;
export const MAX_FIX = 2;
export const MAX_CAMERA_GOOD = 1;
export const MAX_CAMERA_FIX = 3;

const AREAS: Area[] = ["Answering", "Reading"];

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

/** What the camera saw. The first point is how the student came across. */
function cameraFrom(s: Session): QuickCamera {
  if (!s.vision) return { status: s.cameraOn ? "unavailable" : "off", looked: null, good: [], fix: [] };
  const items = (s.report.bodyLanguageCoaching ?? []).filter((i) => clean(i.observation));
  const lookedItem = items.find((i) => i.topic === "You looked nervous" || i.topic === "Your face looked tense" || i.topic === "How you looked");
  const rest = items.filter((i) => i !== lookedItem);
  return {
    status: "ok",
    // A good first point is a sentence of its own. A problem (nervous, tense) is shown first in the fix list, with its tip.
    looked: lookedItem?.kind === "good" ? clean(lookedItem.observation) : null,
    good: rest.filter((i) => i.kind === "good").map((i) => clean(i.observation)).slice(0, MAX_CAMERA_GOOD),    fix: [...(lookedItem?.kind === "improve" ? [lookedItem] : []), ...rest.filter((i) => i.kind === "improve")]
      .map((i) => ({ problem: clean(i.observation), how: clean(i.howTo) || undefined }))
      .slice(0, MAX_CAMERA_FIX),
  };
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
  };
  const fix: Record<Area, QuickFix[]> = {
    Answering: ai
      ? ai.improvements.map((x) => ({ area: "Answering" as const, problem: clean(x.title) || clean(x.detail), quote: clean(x.quote) || undefined, how: clean(x.tip) || undefined }))
      : fixFrom(r.answerCoaching, "Answering"),
    Reading: fixFrom(r.readingCoaching, "Reading"),
  };
  for (const area of AREAS) {
    good[area] = good[area].filter((x) => x.text);
    fix[area] = fix[area].filter((x) => x.problem);
  }

  const shownGood = spread(good, MAX_GOOD);
  const shownFix = spread(fix, MAX_FIX);
  const noAnswers = s.speech.totalWords === 0;

  const say = r.sayItBetter?.find((x) => !hasPlaceholder(x.better) && clean(x.better) !== clean(x.said));

  return {
    headline: noAnswers
      ? "We did not hear any answers this time, so there is nothing to review yet. After the coach asks a question, wait for it to finish, then speak clearly or type your answer."
      : clean(ai?.headline) || (shownGood.length ? "Good effort today. Here is what to keep and what to fix." : "Here is what to work on next."),
    noAnswers,
    good: shownGood,
    fix: shownFix,
    sayItBetter: say ? { said: say.said, better: say.better } : null,
    camera: cameraFrom(s),
  };
}
