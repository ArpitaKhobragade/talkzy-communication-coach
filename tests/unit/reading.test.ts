import { describe, expect, it } from "vitest";
import { analyzeReadingAloud, readingProgress } from "@/features/speech/reading";
import { tokenize } from "@/features/speech/metrics";

const passage =
  "Computers follow instructions called programs. A program is written by a person. Good programmers test their work carefully and fix mistakes quickly.";

describe("analyzeReadingAloud", () => {
  it("scores a perfect read at 100% accuracy and 100% coverage", () => {
    const r = analyzeReadingAloud(passage, passage, 20);
    expect(r?.accuracyPct).toBe(100);
    expect(r?.coveragePct).toBe(100);
    expect(r?.missedWords).toEqual([]);
    expect(r?.wpm).toBe(Math.round(tokenize(passage).length / (20 / 60)));
  });

  it("reports missed words inside the covered range", () => {
    const spoken = passage.replace("carefully ", "");
    const r = analyzeReadingAloud(passage, spoken, 20);
    expect(r?.missedWords).toContain("carefully");
    expect(r!.accuracyPct).toBeLessThan(100);
  });

  it("separates partial reads (coverage) from accuracy", () => {
    const half = passage.split(". ").slice(0, 2).join(". ");
    const r = analyzeReadingAloud(passage, half, 10);
    expect(r!.accuracyPct).toBe(100);
    expect(r!.coveragePct).toBeLessThan(80);
  });

  it("returns null when almost nothing was said", () => {
    expect(analyzeReadingAloud(passage, "hello", 5)).toBeNull();
  });

  it("gives zero accuracy for unrelated speech", () => {
    const r = analyzeReadingAloud(passage, "I went to the market yesterday and bought some apples", 10);
    expect(r?.accuracyPct).toBe(0);
  });
});

describe("readingProgress", () => {
  it("advances through the passage as words are recognised", () => {
    const words = tokenize(passage);
    expect(readingProgress(words, tokenize("computers follow instructions"))).toBe(3);
  });
  it("tolerates a skipped word", () => {
    const words = tokenize(passage);
    expect(readingProgress(words, tokenize("computers instructions called"))).toBe(4);
  });
});
