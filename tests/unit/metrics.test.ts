import { describe, expect, it } from "vitest";
import { computeSpeechMetrics, findFillers, findRepetitions, paceLabel, tokenize } from "@/features/speech/metrics";
import type { Turn } from "@/features/session/types";

const turn = (over: Partial<Turn>): Turn => ({ id: "t", role: "student", text: "", at: 0, ...over });

describe("tokenize", () => {
  it("lowercases, strips punctuation and apostrophes", () => {
    expect(tokenize("It's a Test, isn't it?")).toEqual(["its", "a", "test", "isnt", "it"]);
  });
});

describe("findFillers", () => {
  it("counts unambiguous fillers and phrases, not ordinary words like 'like'", () => {
    const r = findFillers("Um, I like pizza, you know, and uh basically it is um good");
    const map = Object.fromEntries(r.map((f) => [f.word, f.count]));
    expect(map["um"]).toBe(2);
    expect(map["uh"]).toBe(1);
    expect(map["you know"]).toBe(1);
    expect(map["basically"]).toBe(1);
    expect(map["like"]).toBeUndefined();
  });
});

describe("findRepetitions", () => {
  it("finds immediate word and phrase repeats", () => {
    expect(findRepetitions("I I think the the answer is good")).toEqual(["i i", "the the"]);
    expect(findRepetitions("i think i think it works")).toEqual(["i think i think"]);
  });
  it("ignores normal text", () => {
    expect(findRepetitions("this is a normal sentence")).toEqual([]);
  });
});

describe("computeSpeechMetrics", () => {
  const long = "word ".repeat(60).trim();

  it("computes pace only from voice turns with enough speech", () => {
    const m = computeSpeechMetrics([turn({ text: long, inputMode: "voice", speakingSec: 30, pauseCount: 2, longestPauseSec: 1.6, latencySec: 1.2 })]);
    expect(m.wpm).toBe(120);
    expect(m.pauseCount).toBe(2);
    expect(m.longestPauseSec).toBe(1.6);
    expect(m.avgLatencySec).toBe(1.2);
  });

  it("does not invent pace when there is too little voice data", () => {
    const m = computeSpeechMetrics([turn({ text: "short answer here", inputMode: "voice", speakingSec: 3 })]);
    expect(m.wpm).toBeNull();
    expect(m.lexicalVariety).toBeNull();
  });

  it("excludes typed answers from pace but includes them in word counts", () => {
    const m = computeSpeechMetrics([turn({ text: long, inputMode: "typed" })]);
    expect(m.wpm).toBeNull();
    expect(m.totalWords).toBe(60);
    expect(m.typedTurns).toBe(1);
    expect(m.voiceTurns).toBe(0);
  });

  it("ignores coach turns", () => {
    const m = computeSpeechMetrics([turn({ role: "coach", text: "Hello um there" })]);
    expect(m.totalWords).toBe(0);
    expect(m.fillerCount).toBe(0);
  });

  it("reports filler rate per 100 words", () => {
    const text = `um ${"word ".repeat(39)}`.trim(); // 40 words, 1 filler
    const m = computeSpeechMetrics([turn({ text, inputMode: "voice", speakingSec: 25 })]);
    expect(m.fillerCount).toBe(1);
    expect(m.fillerPer100).toBe(2.5);
  });
});

describe("paceLabel", () => {
  it("labels bands and null", () => {
    expect(paceLabel(null)).toMatch(/not enough/i);
    expect(paceLabel(80)).toMatch(/slower/i);
    expect(paceLabel(130)).toMatch(/comfortable/i);
    expect(paceLabel(190)).toMatch(/faster/i);
  });
});
