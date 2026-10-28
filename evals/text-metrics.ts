/*
 * Simple text measurements used to check that the feedback is easy to read.
 * No AI is involved here, so the same text always gives the same numbers.
 */

/** Words a 12-year-old learning English should not meet in feedback. */
export const JARGON = [
  "articulate",
  "articulation",
  "enunciation",
  "syntax",
  "syntactic",
  "cohesion",
  "cohesive",
  "coherence",
  "coherent",
  "lexical",
  "lexicon",
  "discourse",
  "paraphrase",
  "fluency",
  "disfluency",
  "disfluencies",
  "prosody",
  "intonation",
  "elaborate",
  "elaboration",
  "utilize",
  "utilise",
  "demonstrate",
  "proficiency",
  "terminology",
  "rhetorical",
];

export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

/** Rough syllable count: groups of vowels, minus a silent final "e". Good enough for a reading grade. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => wordsOf(s).length > 0);
}

export interface Readability {
  words: number;
  sentences: number;
  avgSentenceWords: number;
  longestSentenceWords: number;
  /** Flesch-Kincaid grade level. 6 to 7 is easy for a 12-year-old. */
  grade: number;
  /** Share of words with 3 or more syllables. */
  hardWordPct: number;
  jargon: string[];
}

export function readability(text: string): Readability {
  const words = wordsOf(text);
  const sentences = sentencesOf(text);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const nW = Math.max(1, words.length);
  const nS = Math.max(1, sentences.length);
  const grade = 0.39 * (nW / nS) + 11.8 * (syl / nW) - 15.59;
  const jargon = [...new Set(words.filter((w) => JARGON.includes(w)))];
  return {
    words: words.length,
    sentences: sentences.length,
    avgSentenceWords: Math.round((nW / nS) * 10) / 10,
    longestSentenceWords: Math.max(0, ...sentences.map((s) => wordsOf(s).length)),
    grade: Math.round(grade * 10) / 10,
    hardWordPct: Math.round((words.filter((w) => syllables(w) >= 3).length / nW) * 1000) / 10,
    jargon,
  };
}

/** Numbers (as digits) that appear in a text, e.g. "82%" gives 82. */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Spearman rank correlation between two lists of numbers (ties get the average rank). */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k].i] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return Math.round((num / Math.sqrt(da * db)) * 100) / 100;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
export const pct = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 10);
