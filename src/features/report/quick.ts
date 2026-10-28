import { countWords, findFillers } from "../speech/metrics";
import { findWordMistakes } from "../speech/word-mistakes";
import { pronunciationHelp } from "../speech/pronounce";
import type { CoachingItem, Session, Turn } from "../session/types";

/*
 * The whole report, short enough for one page: how the reading went (how much was read, what was skipped,
 * which words were not clear and how to say them, and the speed), how the conversation went (what was
 * wrong, in which question, and how to fix it), one "say it like this" example, and what the camera saw.
 * The page shows it in boxes and the PDF has the same content in black and white.
 */

export interface PronunciationItem {
  word: string;
  /** What the app heard instead, when it knows. */
  heard?: string;
  /** The word in parts to say one at a time, such as "pass-word". */
  parts: string;
  /** One sentence on what to change. */
  tip: string;
}

/** One point in the report: good, or something to fix and how. */
export interface QuickLine {
  kind: "good" | "fix";
  text: string;
  how?: string;
}

export interface QuickReading {
  /** "aloud": the student read out loud and it was heard. "silent": there is nothing to say about the reading. */
  mode: "aloud" | "silent";
  /** How much of the passage was reached, 0 to 100. */
  coveragePct: number | null;
  /** The points in order: how much was read, what was skipped, how clear the words were, and the speed. */
  lines: QuickLine[];
  /** Parts of the passage that were skipped, as the words. */
  skipped: string[];
  /** Where the student stopped, when the end of the passage was never read. */
  unreadTail?: string;
  pronunciation: PronunciationItem[];
  /** Reading speed. */
  pace: { level: "good" | "fast" | "slow"; wpm: number } | null;
  /** One letter for each word of the passage: r read, s skipped, m not clear, u not reached. */
  marks?: string;
}

export interface QuickGood {
  text: string;
}

/** Which answer a point is about. */
export interface Where {
  /** The number of the question, starting at 1. */
  n: number;
  question: string;
}

export interface QuickFix {
  problem: string;
  /** The student's own words that show the problem, when there is a real quote. */
  quote?: string;
  /** What to do about it, in one sentence. */
  how?: string;
  /** The question the point is about, when it can be told. */
  where?: Where;
}

/** A wrong word or wrong form the student said, with the right way to say it. */
export interface WordFix {
  said: string;
  better: string;
  why: string;
  /** The question the words were said in, when it can be told. */
  where?: Where;
}

/** Filler words ("umm", "haa", "you know") and wrong words, from everything the student said. */
export interface QuickWords {
  /** Every filler found, most often first. */
  fillers: { word: string; count: number }[];
  fillerTotal: number;
  /** About how many fillers in every 100 words, or null when too little was said to tell. */
  fillersPer100: number | null;
  /** The question with the most fillers, when it can be told. */
  worstQuestion?: { where: Where; count: number };
  mistakes: WordFix[];
  status: "good" | "fix" | "off";
}

export interface QuickCamera {
  /** "ok": the camera was analysed. "unavailable": it was on but could not be used. "off": it was not used. */
  status: "ok" | "unavailable" | "off";
  /** How the student came across, in one sentence (nervous, tense, relaxed...). */
  looked: string | null;
  good: string[];
  fix: { problem: string; how?: string }[];
}

/** A quick look at one part of the session for the top of the report. */
export interface Tile {
  area: "Reading" | "Conversation" | "Your words" | "Face and body";
  status: "good" | "fix" | "off";
  /** A few words, such as "2 things to fix". */
  text: string;
}

export interface QuickReport {
  headline: string;
  /** Nothing the student said was captured, so there is nothing to review. */
  noAnswers: boolean;
  tiles: Tile[];
  reading: QuickReading;
  /** The conversation: what went well and what to fix. */
  good: QuickGood[];
  fix: QuickFix[];
  sayItBetter: { said: string; better: string } | null;
  words: QuickWords;
  camera: QuickCamera;
  /** Up to three things to do next time, the most useful first. */
  plan: string[];
}

export const MAX_GOOD = 3;
export const MAX_FIX = 4;
export const MAX_CAMERA_GOOD = 1;
export const MAX_CAMERA_FIX = 3;
export const MAX_SKIPPED = 2;
export const MAX_WORD_FIXES = 6;
/** More than this many fillers in every 100 words is a lot. */
export const FILLER_LIMIT_PER_100 = 4;
export const MAX_PRONUNCIATION = 4;

/** A reading speed (words a minute) between these is a good speed for reading out loud. */
export const GOOD_READING_WPM: [number, number] = [90, 170];
/** A spoken answer shorter than this many words is called short. */
const SHORT_ANSWER = 12;

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

/**
 * Praise that would be true of any student ("you answered every question"). It teaches nothing, and
 * the AI sometimes writes it even when the answers were off the topic, so it is never shown.
 */
const GENERIC_PRAISE = /(answer(ed)? (every|each|all)|every question|each (question|coach)|gave (a|an) (reply|response)|tried (hard|your best)|good effort|great effort|well done for trying|keep it up)/i;

/** A "say it like this" sentence that still has a blank to fill in is a template, not an example. */
const hasPlaceholder = (s: string) => /\[[^\]]*\]/.test(s);

// ---- Reading ----------------------------------------------------------------------------------

function readingFrom(s: Session): QuickReading {
  const a = s.reading.aloud;
  if (!a) {
    return {
      mode: "silent",
      coveragePct: null,
      lines: [{ kind: "fix", text: "You read silently, so your reading could not be checked.", how: "Next time, read the passage out loud. Then the report shows what you skipped, which words were not clear, and your speed." }],
      skipped: [],
      pronunciation: [],
      pace: null,
    };
  }
  const lines: QuickLine[] = [];
  const skipped = (a.skipped ?? []).map(clean).filter(Boolean).slice(0, MAX_SKIPPED);
  const unreadTail = clean(a.unreadTail) || undefined;
  const pronunciation = (a.misheard ?? []).slice(0, MAX_PRONUNCIATION).map((m) => ({ word: m.word, heard: m.heard || undefined, ...pronunciationHelp(m.word, m.heard) }));

  // 1. How much of the passage was read.
  if (a.coveragePct >= 95) lines.push({ kind: "good", text: "You read the whole passage." });
  else if (a.coveragePct >= 80) lines.push({ kind: "fix", text: "You read most of the passage, but you did not reach the very end.", how: "Read all the way to the end before the talk, even if you read slowly." });
  else lines.push({ kind: "fix", text: "You read only part of the passage.", how: "Read all the way to the end before the talk. The coach's questions use ideas from the whole passage." });

  // 2. What was skipped.
  if (skipped.length) lines.push({ kind: "fix", text: "You skipped some parts of the passage.", how: "Follow the words with your eyes, and read every line to the end." });

  // 3. How clear the words were. This is what the app could understand, not a pronunciation mark.
  if (a.accuracyPct >= 92 && pronunciation.length === 0) lines.push({ kind: "good", text: "Your words were clear: the app understood them well." });
  else {
    lines.push({
      kind: "fix",
      text: pronunciation.length ? "Your pronunciation can be clearer. Some words were heard as other words." : "Your pronunciation can be clearer. Some of your words were not understood.",
      how: "Speak a little slower, open your mouth, and say the end of every word. Say each word below slowly in parts, then in a sentence.",
    });
  }

  // 4. Speed.
  let pace: QuickReading["pace"] = null;
  if (a.wpm !== null) {
    const [lo, hi] = GOOD_READING_WPM;
    if (a.wpm > hi) {
      pace = { level: "fast", wpm: a.wpm };
      lines.push({ kind: "fix", text: `You read too fast (about ${a.wpm} words a minute).`, how: "Take a breath at every full stop, and aim for about 130 to 150 words a minute." });
    } else if (a.wpm < lo) {
      pace = { level: "slow", wpm: a.wpm };
      lines.push({ kind: "fix", text: `You read too slowly (about ${a.wpm} words a minute).`, how: "Look ahead to the end of the sentence, then read the whole sentence in one breath." });
    } else {
      pace = { level: "good", wpm: a.wpm };
      lines.push({ kind: "good", text: `Your reading speed was good (about ${a.wpm} words a minute).` });
    }
  }
  return { mode: "aloud", coveragePct: a.coveragePct, lines, skipped, unreadTail, pronunciation, pace, marks: a.marks };
}

// ---- The conversation ---------------------------------------------------------------------------

interface AnswerRef {
  n: number;
  question: string;
  text: string;
}

/** The last question in a coach message ("Hi Riya! Thanks for reading. What is a brand?" gives "What is a brand?"). */
function questionIn(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const asked = [...sentences].reverse().find((x) => x.includes("?"));
  return clean(asked ?? text);
}

/** Each answer the student gave, with its number and the question it answered. */
function answersOf(turns: Turn[]): AnswerRef[] {
  const out: AnswerRef[] = [];
  let question = "";
  for (const t of turns) {
    if (t.role === "coach") question = questionIn(t.text);
    else if (t.text.trim()) out.push({ n: out.length + 1, question, text: t.text });
  }
  return out;
}

const whereOf = (a: AnswerRef | undefined): Where | undefined => (a ? { n: a.n, question: a.question } : undefined);

function goodFrom(items: CoachingItem[] | undefined): QuickGood[] {
  return (items ?? []).filter((i) => i.kind === "good" && clean(i.observation)).map((i) => ({ text: clean(i.observation) }));
}

/** Measured points that are about all the answers together. Filler words have their own box ("Your words"). */
const ABOUT_LENGTH = new Set(["Answer length"]);
const ABOUT_FILLERS = /filler/i;

function conversationFrom(s: Session): { good: QuickGood[]; fix: QuickFix[] } {
  const r = s.report;
  const ai = r.ai;
  const answers = s.transcriptKept ? answersOf(s.turns) : [];

  // Good points: one from the AI and one measured in turn, so neither pushes out the other.
  const measured = goodFrom(r.answerCoaching);
  const saysFillers = measured.some((m) => /filler/i.test(m.text));
  const written = ai
    ? ai.strengths.map((x) => ({ text: clean(x.detail) || clean(x.title) })).filter((x) => !GENERIC_PRAISE.test(x.text) && !(saysFillers && /filler/i.test(x.text)))
    : [];
  const good: QuickGood[] = Array.from({ length: Math.max(measured.length, written.length) }, (_, i) => [written[i], measured[i]])
    .flat()
    .filter((x): x is QuickGood => !!x && !!x.text);

  // Things to fix, each tied to the question it is about when that can be told.
  const fromAi: QuickFix[] = ai
    ? ai.improvements.map((x) => {
        const quote = clean(x.quote) || undefined;
        const answer = quote ? answers.find((a) => norm(a.text).includes(norm(quote))) : undefined;
        return { problem: clean(x.title) || clean(x.detail), quote, how: clean(x.tip) || undefined, where: whereOf(answer) };
      })
    : [];

  // The answer that was shortest, and the answer with the most fillers.
  const perAnswer: QuickFix[] = [];
  const shortest = [...answers].sort((a, b) => countWords(a.text) - countWords(b.text))[0];
  if (shortest && countWords(shortest.text) < SHORT_ANSWER) {
    perAnswer.push({
      problem: `This answer was short (${countWords(shortest.text)} words).`,
      quote: cut(shortest.text, 140),
      how: "Say your main idea, give one reason, then give one real example. Try for three or four sentences.",
      where: whereOf(shortest),
    });
  }

  // Points about all the answers together (speed, stopping, starting). Length and fillers are already shown for one answer.
  const aboutAll: QuickFix[] = (r.answerCoaching ?? [])
    .filter((i) => i.kind === "improve" && clean(i.observation) && !(perAnswer.length && ABOUT_LENGTH.has(i.topic ?? "")) && i.topic !== "Filler words" && !ABOUT_FILLERS.test(i.observation))
    .map((i) => ({ problem: clean(i.observation), how: clean(i.howTo) || undefined }));

  const fix = [...fromAi.slice(0, 2), ...perAnswer, ...aboutAll, ...fromAi.slice(2)].filter((x) => x.problem);
  return { good: good.slice(0, MAX_GOOD), fix: fix.slice(0, MAX_FIX) };
}

// ---- Fillers and wrong words ------------------------------------------------------------------------

function wordsFrom(s: Session): QuickWords {
  const answers = s.transcriptKept ? answersOf(s.turns) : [];
  const total = s.speech.totalWords;
  if (total === 0) return { fillers: [], fillerTotal: 0, fillersPer100: null, mistakes: [], status: "off" };

  // Fillers: from the answers when they were kept, otherwise from the numbers measured during the session.
  const counts = new Map<string, number>();
  if (answers.length) for (const a of answers) for (const f of findFillers(a.text)) counts.set(f.word, (counts.get(f.word) ?? 0) + f.count);
  else for (const f of s.speech.fillers) counts.set(f.word, f.count);
  const fillers = [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
  const fillerTotal = fillers.reduce((n, f) => n + f.count, 0);
  const fillersPer100 = total >= 30 ? Math.round((fillerTotal / total) * 100 * 10) / 10 : null;

  const perAnswer = answers.map((a) => ({ a, count: findFillers(a.text).reduce((n, f) => n + f.count, 0) })).sort((x, y) => y.count - x.count)[0];
  const worstQuestion = perAnswer && perAnswer.count >= 2 ? { where: { n: perAnswer.a.n, question: perAnswer.a.question }, count: perAnswer.count } : undefined;

  // Wrong words: the ones the AI found in the student's own words first, then the ones the rules find.
  const mistakes: WordFix[] = [];
  const known = new Set<string>();
  const add = (said: string, better: string, why: string) => {
    const key = norm(said);
    if (!key || key === norm(better) || known.has(key) || [...known].some((k) => k.includes(key) || key.includes(k))) return;
    known.add(key);
    const answer = answers.find((a) => norm(a.text).includes(key));
    mistakes.push({ said: cut(clean(said), 90), better: cut(clean(better), 90), why: clean(why), where: whereOf(answer) });
  };
  for (const g of s.report.ai?.grammar ?? []) add(g.quote, g.suggestion, g.issue);
  for (const a of answers) for (const m of findWordMistakes(a.text)) add(m.said, m.better, m.why);

  const status = fillersPer100 !== null && fillersPer100 > FILLER_LIMIT_PER_100 ? "fix" : mistakes.length ? "fix" : fillerTotal >= 5 && fillersPer100 === null ? "fix" : "good";
  return { fillers: fillers.slice(0, 5), fillerTotal, fillersPer100, worstQuestion, mistakes: mistakes.slice(0, MAX_WORD_FIXES), status };
}

// ---- The camera ---------------------------------------------------------------------------------

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
    good: rest.filter((i) => i.kind === "good").map((i) => clean(i.observation)).slice(0, MAX_CAMERA_GOOD),
    fix: [...(lookedItem?.kind === "improve" ? [lookedItem] : []), ...rest.filter((i) => i.kind === "improve")]
      .map((i) => ({ problem: clean(i.observation), how: clean(i.howTo) || undefined }))
      .slice(0, MAX_CAMERA_FIX),
  };
}

// ---- Everything -----------------------------------------------------------------------------------

/** The three most useful things to do next time, one from each part where it can be done. */
function planFrom(reading: QuickReading, talk: { fix: QuickFix[] }, words: QuickWords, camera: QuickCamera): string[] {
  const steps: string[] = [];
  const rd = reading.mode === "aloud" ? reading : null;
  if (rd && rd.coveragePct !== null && rd.coveragePct < 95) steps.push("Read the whole passage, right to the last word.");
  if (rd?.pace?.level === "fast") steps.push("Read slower: take a breath at every full stop.");
  else if (rd?.pace?.level === "slow") steps.push("Read in longer pieces: look ahead and say the whole sentence in one breath.");
  if (rd && rd.pronunciation.length) steps.push(`Say these words slowly, in parts: ${rd.pronunciation.slice(0, 3).map((w) => w.word).join(", ")}.`);
  if (words.fillersPer100 !== null && words.fillersPer100 > FILLER_LIMIT_PER_100 && words.fillers[0]) steps.push(`Stay quiet for a second instead of saying "${words.fillers[0].word}".`);
  if (words.mistakes[0]) steps.push(`Say "${words.mistakes[0].better}" instead of "${words.mistakes[0].said}".`);
  const short = talk.fix.find((f) => /short|longer/i.test(f.problem));
  const other = talk.fix.find((f) => f.how && !/filler|quiet/i.test(`${f.problem} ${f.how}`));
  if (short) steps.push("Give longer answers: your main idea, a reason, then a real example.");
  else if (other?.how) steps.push(other.how);
  if (camera.fix[0]?.how) steps.push(camera.fix[0].how);
  const seen = new Set<string>();
  return steps.filter((x) => (seen.has(x) ? false : (seen.add(x), true))).slice(0, 3);
}

function wordsTile(w: QuickWords): string {
  const parts: string[] = [];
  if (w.fillersPer100 !== null && w.fillersPer100 > FILLER_LIMIT_PER_100) parts.push(`${w.fillerTotal} fillers`);
  if (w.mistakes.length) parts.push(w.mistakes.length === 1 ? "1 wrong word" : `${w.mistakes.length} wrong words`);
  return parts.join(", ") || "A few to fix";
}

const things = (n: number) => (n === 1 ? "1 thing to fix" : `${n} things to fix`);

export function buildQuickReport(s: Session): QuickReport {
  const ai = s.report.ai;
  const reading = readingFrom(s);
  const talk = conversationFrom(s);
  const camera = cameraFrom(s);
  const words = wordsFrom(s);
  const noAnswers = s.speech.totalWords === 0;
  const say = s.report.sayItBetter?.find((x) => !hasPlaceholder(x.better) && clean(x.better) !== clean(x.said));

  const readingFixes = reading.lines.filter((l) => l.kind === "fix").length;
  const tiles: Tile[] = [
    { area: "Reading", status: readingFixes ? "fix" : "good", text: readingFixes ? things(readingFixes) : "All good" },
    noAnswers
      ? { area: "Conversation", status: "off", text: "No answers heard" }
      : { area: "Conversation", status: talk.fix.length ? "fix" : "good", text: talk.fix.length ? things(talk.fix.length) : "All good" },
    noAnswers
      ? { area: "Your words", status: "off", text: "No answers heard" }
      : { area: "Your words", status: words.status, text: words.status === "good" ? "Clean speech" : wordsTile(words) },
    camera.status === "ok"
      ? { area: "Face and body", status: camera.fix.length ? "fix" : "good", text: camera.fix.length ? things(camera.fix.length) : "All good" }
      : { area: "Face and body", status: "off", text: camera.status === "off" ? "Camera off" : "Not available" },
  ];

  return {
    headline: noAnswers
      ? "We did not hear any answers this time, so there is nothing to review yet. After the coach asks a question, wait for it to finish, then speak clearly or type your answer."
      : clean(ai?.headline) || (talk.good.length ? "Good effort today. Here is what to keep and what to fix." : "Here is what to work on next."),
    noAnswers,
    tiles,
    reading,
    good: talk.good,
    fix: talk.fix,
    sayItBetter: say ? { said: say.said, better: say.better } : null,
    words,
    camera,
    plan: planFrom(reading, talk, words, camera),
  };
}
