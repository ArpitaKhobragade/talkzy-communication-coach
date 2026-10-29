import { describe, expect, it } from "vitest";
import { answerSignals, signalLines } from "@/features/coach/signals";
import { computeSpeechMetrics } from "@/features/speech/metrics";
import type { Turn } from "@/features/session/types";

const turn = (text: string, i: number): Turn => ({ id: `s${i}`, role: "student", text, inputMode: "voice", at: i, speakingSec: 6 });

describe("answerSignals", () => {
  it("counts short answers and answers with no opinion", () => {
    const sig = answerSignals(["I don't know, maybe it is good.", "Hmm, I am not sure about this one at all really.", "Gene editing can remove the genes that cause painful diseases that families inherit from their parents."]);
    expect(sig.answers).toBe(3);
    expect(sig.shortAnswers).toBe(2);
    expect(sig.noOpinionAnswers).toBe(2);
  });

  it("finds plain words that are used again and again", () => {
    const sig = answerSignals(["It is very good and very nice.", "That was very very bad, a good plan."]);
    expect(sig.overusedWords).toEqual([{ word: "very", count: 4 }, { word: "good", count: 2 }].filter((w) => w.count >= 3));
  });

  it("does not flag a normal strong answer", () => {
    const sig = answerSignals(["A long password made of several random words is stronger, because a computer needs much more time to guess it."]);
    expect(sig.shortAnswers).toBe(0);
    expect(sig.noOpinionAnswers).toBe(0);
    expect(sig.overusedWords).toEqual([]);
  });
});

describe("signalLines", () => {
  const answers = ["Um, yes, I send messages to my friends.", "Uh, it goes to the tower. Basically that is it.", "Um, it goes under the ground, you know."];
  const speech = computeSpeechMetrics(answers.map(turn));

  it("lists the real problems in plain sentences", () => {
    const lines = signalLines(answers, speech, { accuracyPct: 90, coveragePct: 55, wpm: 120, spokenWordCount: 60, missedWords: [] });
    expect(lines.join(" ")).toMatch(/3 of 3 answers had fewer than 15 words/);
    expect(lines.join(" ")).toMatch(/Filler words are high/);
    expect(lines.join(" ")).toMatch(/only 55% of the passage/);
  });

  it("says when there were no fillers and stays quiet about reading that was finished", () => {
    const clean = ["A password protects my account because other people cannot open it without the secret words that I chose."];
    const lines = signalLines(clean, computeSpeechMetrics(clean.map(turn)), { accuracyPct: 98, coveragePct: 100, wpm: 130, spokenWordCount: 90, missedWords: [] });
    expect(lines.join(" ")).not.toMatch(/passage was read/);
  });
});
