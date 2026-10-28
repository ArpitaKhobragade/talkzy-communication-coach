import { tokenize } from "./metrics";

export interface ReadingAloudAnalysis {
  /** Of the passage words the student reached, the share the recogniser heard. */
  accuracyPct: number;
  /** Share of the passage the student reached (first to last matched word). */
  coveragePct: number;
  spokenWordCount: number;
  /** Passage words (4+ letters) inside the covered range the recogniser did not hear. Approximate. */
  missedWords: string[];
  wpm: number | null;
  /** Parts of the passage that were skipped, as the words themselves (for example "the sun warms the sea"). */
  skipped: string[];
  /** The start of the part of the passage that was never reached, when the student stopped early. */
  unreadTail?: string;
  /** Words the recogniser heard as a different word, which usually means the word was not said clearly. */
  misheard: { word: string; heard: string }[];
  /** One letter for each word of the passage: r read, s skipped, m not clear, u not reached. Used to underline the passage in the report. */
  marks: string;
}

/** What happened to each word of the passage while the student read it. */
export type WordStatus = "read" | "skipped" | "misheard" | "unread";

export interface ReadingAlignment {
  status: WordStatus[];
  /** For a misheard word, what the recogniser heard instead. */
  heard: (string | undefined)[];
  /** Index of the first and the last passage word that were heard, or -1 when nothing matched. */
  first: number;
  last: number;
  matched: number;
}

/** Numbers are written differently by a recogniser ("120" or "one hundred and twenty"), so they are never counted as a mistake. */
const NUMBER_WORDS = new Set(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand lakh crore first second third".split(" "),
);

/** Longest-common-subsequence match between passage words and recognised words: pairs of [passage index, spoken index]. */
function lcsPairs(passage: string[], spoken: string[]): [number, number][] {
  const n = passage.length;
  const m = spoken.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = passage[i - 1] === spoken[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (passage[i - 1] === spoken[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return pairs.reverse();
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** The consonant sounds of a word, with sounds that are easy to mix up written as one letter ("vapour" and "paper" both give "PPr"). */
function skeleton(word: string): string {
  const groups: [string, string][] = [["bpfv", "P"], ["dt", "T"], ["szcx", "S"], ["kgq", "K"], ["mn", "N"]];
  let out = "";
  for (const ch of word) {
    if ("aeiouyhw".includes(ch)) continue;
    const g = groups.find(([letters]) => letters.includes(ch));
    out += g ? g[1] : ch;
  }
  return out;
}

/** True when the recogniser probably heard `heard` for the passage word `word` (a near miss, not a different word). */
export function soundsLike(word: string, heard: string): boolean {
  if (word === heard || heard.length < 2) return false;
  const shorter = Math.min(word.length, heard.length);
  if (shorter >= 3 && (word.startsWith(heard) || heard.startsWith(word)) && Math.abs(word.length - heard.length) <= 3) return true;
  if (1 - editDistance(word, heard) / Math.max(word.length, heard.length) >= 0.6) return true;
  const a = skeleton(word);
  const b = skeleton(heard);
  return a.length >= 3 && b.length >= 3 && editDistance(a, b) <= (a.length >= 5 ? 1 : 0);
}

/**
 * Lines the passage up with what was heard, word by word. Words between two matches are either
 * heard as a near miss ("misheard") or left out ("skipped"). Words before the first match and after the
 * last match are "unread": the student has not got there yet, or stopped early.
 */
export function alignReading(passage: string[], spoken: string[]): ReadingAlignment {
  const status: WordStatus[] = new Array(passage.length).fill("unread");
  const heard: (string | undefined)[] = new Array(passage.length).fill(undefined);
  const pairs = lcsPairs(passage, spoken);
  if (pairs.length < 3) return { status, heard, first: -1, last: -1, matched: 0 };

  for (const [pi] of pairs) status[pi] = "read";
  // Words before the first heard word: a recogniser often misses the first one or two, so those count as read.
  // A longer gap at the start means the student began further into the passage, so those words were skipped.
  const head = pairs[0][0];
  for (let pi = 0; pi < head; pi++) status[pi] = head >= HEAD_SKIP_WORDS ? "skipped" : "read";
  for (let k = 0; k < pairs.length - 1; k++) {
    const [pa, sa] = pairs[k];
    const [pb, sb] = pairs[k + 1];
    let cursor = sa + 1;
    for (let pi = pa + 1; pi < pb; pi++) {
      status[pi] = "skipped";
      const word = passage[pi];
      if (word.length < 4 || NUMBER_WORDS.has(word)) continue;
      for (let sj = cursor; sj < sb; sj++) {
        if (soundsLike(word, spoken[sj]) && !/^\d+$/.test(spoken[sj])) {
          status[pi] = "misheard";
          heard[pi] = spoken[sj];
          cursor = sj + 1;
          break;
        }
      }
    }
  }
  return { status, heard, first: pairs[0][0], last: pairs[pairs.length - 1][0], matched: pairs.length };
}

/** This many unheard words at the very start count as skipped. Fewer are put down to the recogniser missing the first words. */
const HEAD_SKIP_WORDS = 4;

const phrase = (words: string[]) => words.join(" ");

const MARK: Record<WordStatus, string> = { read: "r", skipped: "s", misheard: "m", unread: "u" };

export function analyzeReadingAloud(passage: string, spokenText: string, speakingSec: number): ReadingAloudAnalysis | null {
  const p = tokenize(passage);
  const s = tokenize(spokenText);
  if (p.length === 0 || s.length < 5) return null;

  const al = alignReading(p, s);
  // A few coincidental matches ("a", "the") are not a reading attempt.
  if (al.matched < 5 || al.matched / s.length < 0.3) {
    return { accuracyPct: 0, coveragePct: 0, spokenWordCount: s.length, missedWords: [], wpm: null, skipped: [], misheard: [], marks: "u".repeat(p.length) };
  }

  // The passage is "reached" up to the last word that was heard. Words skipped at the start count against accuracy.
  const start = al.first >= HEAD_SKIP_WORDS ? 0 : al.first;
  const covered = al.last - start + 1;
  const missed: string[] = [];
  const misheard: { word: string; heard: string }[] = [];
  const skipped: string[] = [];
  let run: string[] = [];
  const flush = () => {
    // A run of two or more words, or one long word, is worth telling the student about.
    if (run.length >= 2 || (run.length === 1 && run[0].length >= 5 && !NUMBER_WORDS.has(run[0]))) skipped.push(phrase(run.slice(0, 8)));
    run = [];
  };
  for (let i = start; i <= al.last; i++) {
    const st = al.status[i];
    if (st === "skipped" || st === "misheard") {
      if (p[i].length >= 4 && !NUMBER_WORDS.has(p[i]) && !missed.includes(p[i])) missed.push(p[i]);
    }
    if (st === "skipped") run.push(p[i]);
    else flush();
    if (st === "misheard" && !misheard.some((m) => m.word === p[i])) misheard.push({ word: p[i], heard: al.heard[i] ?? "" });
  }
  flush();

  const tailWords = p.slice(al.last + 1);
  return {
    accuracyPct: Math.round((al.matched / covered) * 100),
    coveragePct: Math.round(((al.last + 1) / p.length) * 100),
    spokenWordCount: s.length,
    missedWords: missed.slice(0, 12),
    wpm: speakingSec >= 10 && s.length >= 15 ? Math.round(s.length / (speakingSec / 60)) : null,
    skipped: skipped.slice(0, 4),
    unreadTail: tailWords.length >= 3 ? phrase(tailWords.slice(0, 8)) : undefined,
    misheard: misheard.slice(0, 6),
    marks: al.status.map((st) => MARK[st]).join(""),
  };
}

/**
 * Index of the next passage word to be read, for live highlighting. Moves forward greedily:
 * each recognised word may match a passage word up to `window` words ahead of the pointer.
 */
export function readingProgress(passageWords: string[], spoken: string[], window = 6): number {
  let pointer = 0;
  for (const word of spoken) {
    for (let k = 0; k < window && pointer + k < passageWords.length; k++) {
      if (passageWords[pointer + k] === word) {
        pointer = pointer + k + 1;
        break;
      }
    }
  }
  return pointer;
}

/** True when the last words of the passage have been heard, so the student has finished reading it. */
export function finishedReading(passage: string[], spoken: string[]): boolean {
  if (passage.length < 8 || spoken.length < 5) return false;
  const pointer = readingProgress(passage, spoken);
  return pointer >= passage.length - 1 || (pointer >= passage.length - 3 && pointer / passage.length > 0.9);
}
