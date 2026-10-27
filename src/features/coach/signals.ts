import type { ReadingResult, SpeechMetrics } from "../session/types";
import { tokenize } from "../speech/metrics";

/*
 * Facts that software can see for certain in the student's answers. They are given to the AI that
 * writes the report so it spends its words on what really matters, and so it cannot praise or
 * criticise something the numbers do not show. The AI still decides what to say about them.
 */

export interface AnswerSignals {
  answers: number;
  /** Answers with fewer than SHORT_ANSWER_WORDS words. */
  shortAnswers: number;
  /** Answers where the student says they do not know, are not sure, or only guess. */
  noOpinionAnswers: number;
  /** Plain words used 3 or more times, such as "very" or "good". */
  overusedWords: { word: string; count: number }[];
}

export const SHORT_ANSWER_WORDS = 15;

const NO_OPINION = /\b(i (really )?(do not|don't|dont) know|no idea|(i am|i'm|im) not (really )?sure|not sure|i guess|i can('|no)?t (really )?say|maybe yes,? maybe no|whatever you think)\b/i;

/** Plain words that students repeat a lot. Repeating them is a vocabulary habit worth mentioning. */
const WEAK_WORDS = new Set(["very", "really", "good", "bad", "nice", "thing", "things", "stuff", "lot", "big", "got", "get"]);

export function answerSignals(answers: string[]): AnswerSignals {
  const texts = answers.map((a) => a.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const a of texts) for (const w of tokenize(a)) if (WEAK_WORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return {
    answers: texts.length,
    shortAnswers: texts.filter((a) => tokenize(a).length < SHORT_ANSWER_WORDS).length,
    noOpinionAnswers: texts.filter((a) => NO_OPINION.test(a.replace(/[‘’]/g, "'"))).length,
    overusedWords: [...counts.entries()]
      .filter(([, n]) => n >= 3)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** The signals as short plain sentences for the AI. Only things that are true and worth saying are listed. */
export function signalLines(answers: string[], speech: SpeechMetrics, reading: ReadingResult["aloud"]): string[] {
  const sig = answerSignals(answers);
  const out: string[] = [];
  if (sig.answers > 0 && sig.shortAnswers >= Math.ceil(sig.answers / 2)) {
    out.push(`${sig.shortAnswers} of ${sig.answers} answers had fewer than ${SHORT_ANSWER_WORDS} words (average ${speech.avgAnswerWords ?? "?"}). They are short.`);
  }
  if (sig.noOpinionAnswers > 0) {
    out.push(`${sig.noOpinionAnswers} of ${sig.answers} answers say "I don't know", "not sure" or only guess, so no opinion or reason was given.`);
  }
  if (speech.fillerPer100 !== null && speech.fillerPer100 >= 4) {
    out.push(`Filler words are high: ${speech.fillerCount} in total, ${speech.fillerPer100} per 100 words.`);
  } else if (speech.fillerPer100 !== null && speech.fillerCount === 0) {
    out.push("There were no filler words. That is a real strength.");
  }
  if (sig.overusedWords.length) {
    out.push(`Plain words used again and again: ${sig.overusedWords.map((w) => `"${w.word}" ${w.count} times`).join(", ")}.`);
  }
  if (reading && reading.coveragePct < 85) {
    out.push(`In the reading, only ${reading.coveragePct}% of the passage was read aloud. The student stopped early.`);
  }
  return out;
}
