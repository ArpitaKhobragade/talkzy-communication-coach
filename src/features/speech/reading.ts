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
}

/** Longest-common-subsequence match between passage words and recognised words. */
function lcsMatches(passage: string[], spoken: string[]): number[] {
  const n = passage.length;
  const m = spoken.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = passage[i - 1] === spoken[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matchedPassageIdx: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (passage[i - 1] === spoken[j - 1]) {
      matchedPassageIdx.push(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return matchedPassageIdx.reverse();
}

export function analyzeReadingAloud(passage: string, spokenText: string, speakingSec: number): ReadingAloudAnalysis | null {
  const p = tokenize(passage);
  const s = tokenize(spokenText);
  if (p.length === 0 || s.length < 5) return null;

  const matched = lcsMatches(p, s);
  // A few coincidental matches ("a", "the") are not a reading attempt.
  if (matched.length < 5 || matched.length / s.length < 0.3) {
    return { accuracyPct: 0, coveragePct: 0, spokenWordCount: s.length, missedWords: [], wpm: null };
  }

  const first = matched[0];
  const last = matched[matched.length - 1];
  const covered = last - first + 1;
  const matchedSet = new Set(matched);

  const missed: string[] = [];
  for (let i = first; i <= last; i++) {
    if (!matchedSet.has(i) && p[i].length >= 4 && !missed.includes(p[i])) missed.push(p[i]);
  }

  return {
    accuracyPct: Math.round((matched.length / covered) * 100),
    coveragePct: Math.round((covered / p.length) * 100),
    spokenWordCount: s.length,
    missedWords: missed.slice(0, 12),
    wpm: speakingSec >= 10 && s.length >= 15 ? Math.round(s.length / (speakingSec / 60)) : null,
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
