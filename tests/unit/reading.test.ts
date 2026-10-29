import { describe, expect, it } from "vitest";
import { alignReading, analyzeReadingAloud, finishedReading, readingProgress } from "@/features/speech/reading";
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

describe("analyzeReadingAloud: what was skipped and what was not said clearly", () => {
  const longPassage =
    "The Sun warms the sea all day. The water becomes vapour and rises into the sky. High up the air is cold, so the vapour cools and turns back into tiny drops. Many drops make a cloud, and the cloud brings rain to the hills and the fields.";

  it("lists a skipped part of the passage in the student's reading order", () => {
    const spoken = longPassage.replace("High up the air is cold, so the vapour cools and ", "");
    const r = analyzeReadingAloud(longPassage, spoken, 25)!;
    expect(r.skipped.join(" | ")).toMatch(/high up the air is cold/);
    expect(r.missedWords).toEqual(expect.arrayContaining(["high", "cold", "vapour", "cools"]));
    expect(r.misheard).toEqual([]);
  });

  it("calls a near miss 'misheard' and says what was heard", () => {
    const spoken = longPassage.replace("vapour", "paper").replace("tiny", "teeny");
    const r = analyzeReadingAloud(longPassage, spoken, 25)!;
    expect(r.misheard.find((m) => m.word === "vapour")?.heard).toBe("paper");
    expect(r.misheard.find((m) => m.word === "tiny")?.heard).toBe("teeny");
  });

  it("says where the student stopped when the end was never read", () => {
    const spoken = longPassage.split(". ").slice(0, 2).join(". ");
    const r = analyzeReadingAloud(longPassage, spoken, 12)!;
    expect(r.coveragePct).toBeLessThan(60);
    expect(r.unreadTail).toMatch(/^high up the air/);
  });

  it("does not count numbers written as words or digits as mistakes", () => {
    const text = "The shop sells twenty bags every single morning before the school opens its doors to everybody.";
    const spoken = text.replace("twenty", "20");
    const r = analyzeReadingAloud(text, spoken, 15)!;
    expect(r.missedWords).not.toContain("twenty");
    expect(r.misheard).toEqual([]);
  });

  it("a perfect read has nothing skipped, nothing misheard and no unread tail", () => {
    const r = analyzeReadingAloud(longPassage, longPassage, 25)!;
    expect(r.skipped).toEqual([]);
    expect(r.misheard).toEqual([]);
    expect(r.unreadTail).toBeUndefined();
  });
});

describe("alignReading and finishedReading", () => {
  const words = tokenize("the sun warms the sea all day and the water rises into the sky");
  it("marks each word as read, skipped or not reached yet", () => {
    const al = alignReading(words, tokenize("the sun the sea all day"));
    expect(al.status[0]).toBe("read");
    expect(al.status[2]).toBe("skipped"); // "warms"
    expect(al.status[al.status.length - 1]).toBe("unread");
  });

  it("knows the student has finished only when the end of the passage is heard", () => {
    expect(finishedReading(words, tokenize("the sun warms the sea all day and"))).toBe(false);
    expect(finishedReading(words, tokenize("the sun warms the sea all day and the water rises into the sky"))).toBe(true);
    expect(finishedReading(words, tokenize("the sun warms the sea all day and the water rises into the"))).toBe(true); // last word not heard
  });
});

describe("reading: the start of the passage, how much was reached, and a mark for every word", () => {
  const text =
    "The Sun warms the sea all day. The water becomes vapour and rises into the sky. High up the air is cold, so the vapour cools and turns back into tiny drops. Many drops make a cloud, and the cloud brings rain to the hills and the fields.";
  const words = tokenize(text);

  it("counts a long skipped start as skipped, but not the first word or two that a recogniser often misses", () => {
    const lateStart = text.split(". ").slice(1).join(". "); // the first sentence was never read
    const r = analyzeReadingAloud(text, lateStart, 20)!;
    expect(r.skipped.join(" | ")).toMatch(/the sun warms the sea all day/);
    expect(r.marks.startsWith("ssssss")).toBe(true);

    const missedFirstWord = text.replace("The Sun ", "");
    const r2 = analyzeReadingAloud(text, missedFirstWord, 20)!;
    expect(r2.skipped).toEqual([]);
    expect(r2.marks.startsWith("rr")).toBe(true);
  });

  it("says how much of the passage was reached, so reading half is never 'nothing to fix'", () => {
    const half = text.split(". ").slice(0, 2).join(". ");
    const r = analyzeReadingAloud(text, half, 12)!;
    expect(r.coveragePct).toBeLessThan(55);
    expect(r.unreadTail).toBeTruthy();
    expect(r.marks.endsWith("uuuuuuuu")).toBe(true);
  });

  it("gives one mark for every word of the passage", () => {
    const spoken = text.replace("vapour", "paper").replace("High up the air is cold, so ", "");
    const r = analyzeReadingAloud(text, spoken, 25)!;
    expect(r.marks).toHaveLength(words.length);
    expect(r.marks).toMatch(/m/); // vapour heard as paper
    expect(r.marks).toMatch(/s/); // the skipped part
    expect(r.marks).toMatch(/r/);
  });

  it("a perfect read is all read", () => {
    expect(analyzeReadingAloud(text, text, 25)!.marks).toBe("r".repeat(words.length));
  });
});

describe("reading while it is still being heard (the first few words)", () => {
  const long =
    "Your team receives bug reports from users. A good team does not simply guess. It follows a steady process so that the fix is correct and the same bug does not return. First, the engineer tries to reproduce the problem, which means making it happen again on purpose. If the bug cannot be reproduced, it is almost impossible to fix with confidence. Next, the engineer searches for the cause by reading logs and testing small changes.";
  const words = tokenize(long);

  it("does not mark the whole passage as skipped because a few common words match far ahead", () => {
    // Only the start has been heard, and the recogniser got it a little different. "a" and "that" also appear much later.
    const al = alignReading(words, tokenize("a team receives bug reports from users a good that"));
    const skipped = al.status.filter((s) => s === "skipped").length;
    expect(skipped).toBeLessThanOrEqual(3);
    expect(al.status[words.length - 1]).toBe("unread");
  });

  it("underlines the words as more of the passage is heard, one word at a time, without jumping ahead", () => {
    const heard = words.slice(0, 40);
    let lastRead = 0;
    for (let n = 8; n <= heard.length; n += 4) {
      const al = alignReading(words, heard.slice(0, n));
      const read = al.status.filter((s) => s === "read").length;
      expect(read).toBeGreaterThanOrEqual(lastRead); // it only moves forward
      expect(read).toBeLessThanOrEqual(n);
      expect(al.status.filter((s) => s === "skipped").length).toBeLessThanOrEqual(2);
      lastRead = read;
    }
    expect(lastRead).toBeGreaterThanOrEqual(36);
  });

  it("still lines up a student who starts in the middle of the passage, or jumps over a sentence", () => {
    const fromMiddle = alignReading(words, words.slice(30, 70));
    expect(fromMiddle.first).toBeGreaterThanOrEqual(28);
    expect(fromMiddle.status[0]).toBe("skipped");

    const jumped = alignReading(words, [...words.slice(0, 20), ...words.slice(35, 70)]);
    expect(jumped.status.slice(20, 35).filter((s) => s === "skipped").length).toBeGreaterThanOrEqual(10);
    expect(jumped.status[40]).toBe("read");
  });
});
