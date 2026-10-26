import { describe, expect, it } from "vitest";
import { buildAnswerCoaching, buildBodyLanguageCoaching, buildReadingCoaching, buildSayItBetter } from "@/features/coach/report-builder";
import { verifyFeedback } from "@/features/coach/verify";
import { cleanSpeech, computeSpeechMetrics } from "@/features/speech/metrics";
import type { AiFeedback, Turn, VisionMetrics } from "@/features/session/types";

const student = (text: string, inputMode: Turn["inputMode"] = "voice"): Turn => ({ id: text.slice(0, 6), role: "student", text, at: 0, inputMode });

describe("cleanSpeech", () => {
  it("removes fillers and repeated words but keeps the ideas", () => {
    expect(cleanSpeech("um I think the the answer is basically you know good")).toBe("I think the answer is good.");
  });
  it("capitalises, adds a full stop, and returns empty for nothing but fillers", () => {
    expect(cleanSpeech("so it works well")).toBe("So it works well.");
    expect(cleanSpeech("um uh")).toBe("");
  });
  it("keeps real punctuation", () => {
    expect(cleanSpeech("Is it safe?")).toBe("Is it safe?");
  });
});

describe("buildSayItBetter (no AI)", () => {
  it("shows the student's own sentence next to a cleaner version", () => {
    const out = buildSayItBetter([student("um I think basically a long password is harder to guess because it has more combinations you know")]);
    expect(out).toHaveLength(1);
    expect(out[0].said).toContain("um I think basically");
    expect(out[0].better).toBe("I think a long password is harder to guess because it has more combinations.");
    expect(out[0].source).toBe("rule");
  });

  it("gives a simple frame for a short answer, built from the student's own words", () => {
    const out = buildSayItBetter([student("Passwords keep accounts safe")]);
    expect(out[0].said).toBe("Passwords keep accounts safe");
    expect(out[0].better).toBe("Passwords keep accounts safe, because [give one reason]. For example, [give one real example].");
  });

  it("returns nothing when answers are already clear and long", () => {
    const long = "A long passphrase is harder to guess because a computer has to try many more combinations, and I can remember four random words much more easily than a mix of symbols";
    expect(buildSayItBetter([student(long)])).toEqual([]);
  });

  it("ignores coach turns and very short replies, and never returns more than three examples", () => {
    const turns: Turn[] = [
      { id: "c", role: "coach", text: "um why do you think so", at: 0 },
      student("yes"),
      ...Array.from({ length: 6 }, (_, i) => student(`um basically I think number ${i} is the best one you know`)),
    ];
    const out = buildSayItBetter(turns);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.every((o) => !o.said.startsWith("um why"))).toBe(true);
  });

  it("shortens very long answers instead of storing them whole", () => {
    const out = buildSayItBetter([student(`um ${"word ".repeat(120)}`)]);
    expect(out[0].said.length).toBeLessThanOrEqual(225);
  });
});

describe("AI 'say it better' examples are verified", () => {
  const base = (): AiFeedback => ({
    headline: "h",
    strengths: [],
    improvements: [],
    grammar: [],
    vocabulary: { summary: "s", upgrades: [] },
    structure: { summary: "s", perAnswer: [] },
    exercises: [{ title: "e", instructions: "i", minutes: 3 }],
    nextSessionFocus: "f",
    sayItBetter: [
      { said: "he go to school every day", better: "He goes to school every day.", why: "Verb form." },
      { said: "something the student never said", better: "x", why: "y" },
    ],
  });
  it("drops examples whose 'said' text is not in the transcript", () => {
    const { feedback, droppedQuotes } = verifyFeedback(base(), ["Well he go to school every day and likes it"]);
    expect(feedback.sayItBetter).toHaveLength(1);
    expect(feedback.sayItBetter?.[0].better).toBe("He goes to school every day.");
    expect(droppedQuotes).toBe(1);
  });
});

describe("report wording stays simple and honest", () => {
  const vision = (over: Partial<VisionMetrics> = {}): VisionMetrics => ({
    framesAnalyzed: 100, durationSec: 60, facePresentPct: 55, cameraFacingPct: 40, avgHeadYawDeg: 25, avgHeadPitchDeg: 20,
    shoulderTiltDeg: 12, uprightPct: 30, bodyVisiblePct: 80, handsVisiblePct: 5, movementIndex: 0.01, movementLevel: "low",
    facialMovementIndex: 0.005, facialMovementLevel: "low", ...over,
  });

  const allText = () => {
    const speech = computeSpeechMetrics([student("Passwords keep accounts safe and they are very important for everybody"), student("um um basically it is good good")]);
    const items = [
      ...buildReadingCoaching({ mode: "aloud", durationSec: 60, aloud: { accuracyPct: 60, coveragePct: 50, wpm: 200, spokenWordCount: 80, missedWords: ["passphrase"] } }, 120),
      ...buildAnswerCoaching({ ...speech, voiceTurns: 2, wpm: 180, pauseCount: 6, longestPauseSec: 5, avgLatencySec: 6, fillerPer100: 8, fillerCount: 4, repetitionCount: 4, repetitions: ["good good"] }),
      ...buildBodyLanguageCoaching(vision()),
    ];
    return items.map((i) => `${i.topic} ${i.observation} ${i.why ?? ""} ${i.howTo ?? ""}`).join(" ");
  };

  it("avoids jargon", () => {
    expect(allText()).not.toMatch(/articulation|syntax|cohesion|lexical|metric|geometry|recogniser|latency|calibrat/i);
  });

  it("every item that needs fixing says how to fix it", () => {
    const speech = computeSpeechMetrics([student("Passwords keep accounts safe")]);
    const items = [...buildAnswerCoaching({ ...speech, voiceTurns: 2, wpm: 180, pauseCount: 6, avgLatencySec: 6, fillerPer100: 8, fillerCount: 4 }), ...buildBodyLanguageCoaching(vision())];
    for (const i of items.filter((x) => x.kind === "improve")) expect((i.howTo ?? "").length).toBeGreaterThan(15);
  });

  it("covers face in the picture, looking at the camera, facial expression, posture and body", () => {
    const topics = buildBodyLanguageCoaching(vision()).map((i) => i.topic);
    for (const t of ["Your face in the picture", "Looking at the camera", "Your face while talking", "How you sat", "Your body and hands"]) expect(topics).toContain(t);
  });

  it("is honest that it sees head direction, not eyes, and never judges feelings", () => {
    const text = buildBodyLanguageCoaching(vision()).map((i) => `${i.observation} ${i.why ?? ""} ${i.howTo ?? ""}`).join(" ");
    expect(text).toMatch(/cannot see exactly where your eyes look/);
    expect(text).toMatch(/says nothing about how you feel/);
    expect(text).not.toMatch(/nervous|anxious|confident|honest|lying|happy|sad|angry|bored|stress/i);
  });
});
