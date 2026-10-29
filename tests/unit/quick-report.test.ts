import { describe, expect, it } from "vitest";
import { buildSession } from "@/features/practice/finalize";
import { buildQuickReport, MAX_FIX, MAX_GOOD } from "@/features/report/quick";
import type { AiFeedback, CoachingItem, Session, Turn } from "@/features/session/types";

const turn = (role: Turn["role"], text: string): Turn => ({ id: Math.random().toString(), role, text, at: 0, inputMode: role === "student" ? "typed" : undefined });

function base(): Session {
  return buildSession({
    id: "q1",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    budgetSec: 720,
    moduleId: "engineering-intermediate-clarity",
    field: "engineering",
    level: "intermediate",
    goal: "clarity",
    liveAi: false,
    readingSec: 90,
    passageWords: 150,
    reading: { mode: "silent", durationSec: 90 },
    turns: [turn("coach", "Why do engineers build prototypes?"), turn("student", "Because it is cheaper to find a mistake early and fix it before the real thing."), turn("coach", "Can you give an example?"), turn("student", "A bridge model can be tested in water.")],
    vision: null,
    keepTranscript: true,
    ai: null,
    aiReason: "Development mode",
  });
}

/** A session whose camera was on and analysed (the numbers are not used here, only that analysis happened). */
function withCamera(s: Session): Session {
  s.cameraOn = true;
  s.vision = {
    framesAnalyzed: 100, durationSec: 25, facePresentPct: 90, cameraFacingPct: 80, avgHeadYawDeg: 5, avgHeadPitchDeg: 5, shoulderTiltDeg: 2,
    uprightPct: 80, bodyVisiblePct: 90, handsVisiblePct: 30, movementIndex: 0.03, movementLevel: "moderate", facialMovementIndex: 0.02, facialMovementLevel: "moderate",
  };
  return s;
}

const good = (observation: string): CoachingItem => ({ kind: "good", topic: "t", observation });
const improve = (observation: string, howTo?: string): CoachingItem => ({ kind: "improve", topic: "t", observation, howTo });

const ai = (over: Partial<AiFeedback> = {}): AiFeedback => ({
  headline: "You explained your ideas clearly today.",
  strengths: [
    { title: "Clear reasons", detail: "You gave a reason for your main point." },
    { title: "Good example", detail: "Your bridge example was easy to picture." },
  ],
  improvements: [
    { title: "Answers are short", detail: "Your second answer had only seven words.", tip: "Add one more sentence with an example." },
    { title: "Missing detail", detail: "You did not say why.", tip: "Say because, then give the reason." },
  ],
  grammar: [],
  vocabulary: { summary: "Fine.", upgrades: [] },
  structure: { summary: "Clear.", perAnswer: [] },
  reading: { summary: "You read well.", wentWell: ["You read to the end."], improve: [{ issue: "You read a little fast.", howTo: "Pause at each full stop." }] },
  exercises: [
    { title: "Say it in 3 parts", instructions: "Point, reason, example.", minutes: 5 },
    { title: "Second task", instructions: "Do it again.", minutes: 5 },
  ],
  nextSessionFocus: "Longer answers.",
  ...over,
});

describe("buildQuickReport", () => {
  it("keeps only a couple of points about the conversation", () => {
    const s = base();
    s.report.ai = ai();
    const q = buildQuickReport(s);
    expect(q.good.length).toBeLessThanOrEqual(MAX_GOOD);
    expect(q.fix.length).toBeLessThanOrEqual(MAX_FIX);
    expect(q.good.length).toBeGreaterThan(0);
    expect(q.fix.length).toBeGreaterThan(0);
  });

  it("uses the AI's headline and a fix with its how-to", () => {
    const s = base();
    s.report.ai = ai();
    const q = buildQuickReport(s);
    expect(q.headline).toBe("You explained your ideas clearly today.");
    expect(q.fix[0]).toMatchObject({ problem: "Answers are short", how: "Add one more sentence with an example." });
  });

  it("keeps the camera in its own section, with its good points and fixes", () => {
    const s = withCamera(base());
    s.report.ai = null;
    s.report.answerCoaching = [];
    s.report.readingCoaching = [];
    s.turns = [];
    s.transcriptKept = false;
    s.report.bodyLanguageCoaching = [good("Your face stayed in view."), improve("You looked away a lot.", "Look at the lens.")];
    const q = buildQuickReport(s);
    expect(q.good).toEqual([]);
    expect(q.fix).toEqual([]);
    expect(q.camera).toEqual({ status: "ok", looked: null, good: ["Your face stayed in view."], fix: [{ problem: "You looked away a lot.", how: "Look at the lens." }] });
  });

  it("puts how the student looked first: a problem leads the fixes, a good look is its own sentence", () => {
    const s = withCamera(base());
    s.report.bodyLanguageCoaching = [
      { kind: "improve", topic: "You looked nervous", observation: "You looked a little nervous: you blinked a lot.", howTo: "Breathe in slowly." },
      good("Your face stayed in view."),
      improve("You looked away a lot.", "Look at the lens."),
    ];
    const nervous = buildQuickReport(s).camera;
    expect(nervous.looked).toBeNull();
    expect(nervous.fix.map((f) => f.problem)).toEqual(["You looked a little nervous: you blinked a lot.", "You looked away a lot."]);

    s.report.bodyLanguageCoaching = [{ kind: "good", topic: "How you looked", observation: "You looked relaxed and friendly." }, good("Your face stayed in view.")];
    const relaxed = buildQuickReport(s).camera;
    expect(relaxed.looked).toBe("You looked relaxed and friendly.");
    expect(relaxed.good).toEqual(["Your face stayed in view."]);
  });

  it("says whether the camera was off or could not be used", () => {
    expect(buildQuickReport(base()).camera.status).toBe("off");
    const s = base();
    s.cameraOn = true;
    expect(buildQuickReport(s).camera.status).toBe("unavailable");
  });

  it("says so when no answers were captured", () => {
    const s = base();
    expect(buildQuickReport(s).noAnswers).toBe(false);
    s.speech = { ...s.speech, totalWords: 0 };
    const q = buildQuickReport(s);
    expect(q.noAnswers).toBe(true);
    expect(q.headline).toMatch(/did not hear any answers/i);
  });

  it("works from the rule-based coaching when there is no AI feedback", () => {
    const s = base();
    s.report.ai = null;
    s.turns = [];
    s.transcriptKept = false;
    s.report.answerCoaching = [good("You used many different words."), improve("Answers were short.", "Add a reason."), improve("Many fillers.", "Pause instead.")];
    s.report.readingCoaching = [improve("You read very fast.", "Slow down.")];
    const q = buildQuickReport(s);
    // Filler words are not listed here: they have their own box ("Your words").
    expect(q.fix.map((x) => x.problem)).toEqual(["Answers were short."]);
    expect(q.headline.length).toBeGreaterThan(10);
  });

  it("returns the first say-it-like-this example, or none", () => {
    const s = base();
    s.report.sayItBetter = [
      { said: "um I think it is good", better: "I think it is good.", why: "No filler.", source: "rule" },
      { said: "second", better: "second better", why: "x", source: "rule" },
    ];
    expect(buildQuickReport(s).sayItBetter).toEqual({ said: "um I think it is good", better: "I think it is good." });
    s.report.sayItBetter = [];
    expect(buildQuickReport(s).sayItBetter).toBeNull();
  });

  it("never returns empty points", () => {
    const s = base();
    s.report.ai = ai({ strengths: [{ title: "", detail: "" }], improvements: [{ title: "", detail: "", tip: "" }] });
    const q = buildQuickReport(s);
    expect(q.good.every((g) => g.text.length > 0)).toBe(true);
    expect(q.fix.every((x) => x.problem.length > 0)).toBe(true);
  });
});

describe("buildQuickReport: only true, useful points", () => {
  it("never shows praise that fits every student", () => {
    const s = base();
    s.report.ai = ai({ strengths: [{ title: "Effort", detail: "You answered every question the coach asked." }, { title: "Reason", detail: "Answer 3 gave a reason: because it is cheaper." }] });
    const q = buildQuickReport(s);
    expect(q.good.map((g) => g.text).join(" ")).not.toMatch(/every question/);
    expect(q.good.map((g) => g.text).join(" ")).toMatch(/because it is cheaper/);
  });

  it("takes the reading section from the measurements, not from the AI's words", () => {
    const s = base();
    s.report.ai = ai({ reading: { summary: "x", wentWell: ["You read the whole passage correctly."], improve: [] } });
    s.reading = { mode: "aloud", durationSec: 60, aloud: { accuracyPct: 70, coveragePct: 95, wpm: 120, spokenWordCount: 100, missedWords: ["vapour"], skipped: ["the sun warms the sea"], misheard: [{ word: "vapour", heard: "paper" }] } };
    const q = buildQuickReport(s);
    expect(q.good.map((g) => g.text).join(" ")).not.toMatch(/whole passage correctly/);
    expect(q.reading.lines.some((l) => l.text === "You read the whole passage.")).toBe(true); // it reached the end, even though a part was skipped
    expect(q.reading.skipped).toEqual(["the sun warms the sea"]);
    expect(q.reading.pronunciation[0]).toMatchObject({ word: "vapour", heard: "paper", parts: "va-pour" });
  });

  it("skips a 'say it like this' that still has a blank to fill in", () => {
    const s = base();
    s.report.sayItBetter = [
      { said: "It is good.", better: "It is good because [give one reason].", why: "w", source: "rule" },
      { said: "Um it is cheap.", better: "It is cheap.", why: "w", source: "rule" },
    ];
    expect(buildQuickReport(s).sayItBetter).toEqual({ said: "Um it is cheap.", better: "It is cheap." });
  });

  it("shows the student's own words with a fix when the AI quoted them", () => {
    const s = base();
    s.report.ai = ai({ improvements: [{ title: "Verb form", detail: "x", quote: "It have only the main parts", tip: "Say: it has." }, { title: "b", detail: "d", tip: "t" }] });
    expect(buildQuickReport(s).fix[0]).toMatchObject({ problem: "Verb form", quote: "It have only the main parts" });
  });
});

describe("buildQuickReport: no repeated praise", () => {
  it("does not show a point about fillers from the AI when the measured points already say it", () => {
    const s = base();
    s.report.answerCoaching = [good("You used very few filler words. Well done.")];
    s.report.ai = ai({ strengths: [{ title: "No fillers", detail: "You used zero filler words in all answers." }, { title: "Reason", detail: "You gave a reason: because it is cheaper." }] });
    const texts = buildQuickReport(s).good.map((g) => g.text);
    expect(texts.filter((t) => /filler/i.test(t))).toHaveLength(1);
    expect(texts.join(" ")).toMatch(/because it is cheaper/);
  });
});

describe("buildQuickReport: the reading section", () => {
  const aloud = (over: Partial<NonNullable<Session["reading"]["aloud"]>> = {}): Session => {
    const s = base();
    s.reading = { mode: "aloud", durationSec: 80, aloud: { accuracyPct: 96, coveragePct: 100, wpm: 130, spokenWordCount: 120, missedWords: [], skipped: [], misheard: [], ...over } };
    return s;
  };
  const lines = (s: Session) => buildQuickReport(s).reading.lines;
  const texts = (s: Session) => lines(s).map((l) => l.text).join(" | ");

  it("praises a clean read: all of it read, clear words, good speed", () => {
    const l = lines(aloud());
    expect(l.map((x) => x.kind)).toEqual(["good", "good", "good"]);
    expect(texts(aloud())).toMatch(/You read the whole passage/);
    expect(texts(aloud())).toMatch(/words were clear/);
    expect(texts(aloud())).toMatch(/reading speed was good/);
  });

  it("never says there is nothing to fix when only part of the passage was read", () => {
    const half = aloud({ coveragePct: 48, unreadTail: "the cloud brings rain to the hills" });
    const r = buildQuickReport(half).reading;
    expect(r.lines.find((x) => /only part of the passage/.test(x.text))?.kind).toBe("fix");
    expect(r.lines.find((x) => /only part of the passage/.test(x.text))?.how).toMatch(/all the way to the end/);
    expect(r.unreadTail).toBe("the cloud brings rain to the hills");
    expect(r.coveragePct).toBe(48);
    expect(buildQuickReport(half).tiles[0]).toMatchObject({ area: "Reading", status: "fix" });
  });

  it("says when most but not all of the passage was read", () => {
    expect(texts(aloud({ coveragePct: 88 }))).toMatch(/most of the passage, but you did not reach the very end/);
  });

  it("lists what was skipped, and each unclear word with how to say it, and says the pronunciation can be clearer", () => {
    const r = buildQuickReport(
      aloud({ accuracyPct: 82, skipped: ["high up the air is cold", "tiny drops", "to the hills"], misheard: [{ word: "vapour", heard: "paper" }, { word: "plants", heard: "plant" }] }),
    ).reading;
    expect(r.skipped).toEqual(["high up the air is cold", "tiny drops"]); // at most two
    expect(r.lines.some((l) => /skipped some parts/.test(l.text))).toBe(true);
    expect(r.lines.some((l) => /pronunciation can be clearer/.test(l.text) && l.kind === "fix")).toBe(true);
    expect(r.pronunciation.map((w) => w.word)).toEqual(["vapour", "plants"]);
    expect(r.pronunciation[0]).toMatchObject({ heard: "paper", parts: "va-pour" });
    expect(r.pronunciation[1].tip).toMatch(/ending "s"/);
  });

  it("says the pronunciation can be clearer even when no single word stands out", () => {
    const r = buildQuickReport(aloud({ accuracyPct: 70 })).reading;
    expect(r.lines.some((l) => /pronunciation can be clearer/.test(l.text) && l.kind === "fix")).toBe(true);
    expect(r.pronunciation).toEqual([]);
  });

  it("always says how the speed was: good, too fast, or too slow, with how to fix it", () => {
    expect(buildQuickReport(aloud({ wpm: 130 })).reading.pace).toEqual({ level: "good", wpm: 130 });
    const fast = buildQuickReport(aloud({ wpm: 190 })).reading;
    expect(fast.pace?.level).toBe("fast");
    expect(fast.lines.find((l) => /too fast/.test(l.text))).toMatchObject({ kind: "fix", how: expect.stringMatching(/breath at every full stop/) });
    const slow = buildQuickReport(aloud({ wpm: 70 })).reading;
    expect(slow.pace?.level).toBe("slow");
    expect(slow.lines.find((l) => /too slowly/.test(l.text))).toMatchObject({ kind: "fix", how: expect.stringMatching(/one breath/) });
  });

  it("keeps the marks that draw the underlined passage", () => {
    expect(buildQuickReport(aloud({ marks: "rrrsmu" })).reading.marks).toBe("rrrsmu");
  });

  it("says what to do next time when the student read silently", () => {
    const s = base();
    s.reading = { mode: "silent", durationSec: 60 };
    const r = buildQuickReport(s).reading;
    expect(r.mode).toBe("silent");
    expect(r.lines[0].text).toMatch(/read silently/);
    expect(r.lines[0].how).toMatch(/read the passage out loud/);
  });

  it("works for reports saved before skipped and unclear words were recorded", () => {
    const r = buildQuickReport(aloud({ skipped: undefined, misheard: undefined, unreadTail: undefined })).reading;
    expect(r.mode).toBe("aloud");
    expect(r.skipped).toEqual([]);
  });
});

describe("buildQuickReport: each fix says which question it is about", () => {
  const talk = (): Session => {
    const s = base();
    s.transcriptKept = true;
    s.turns = [
      { id: "1", role: "coach", text: "Hi Riya! Thanks for reading. What is a brand?", at: 0 },
      { id: "2", role: "student", text: "A brand is the promise a company makes to its customers every single day.", at: 0, inputMode: "voice" },
      { id: "3", role: "coach", text: "Great. Why do people trust a brand?", at: 0 },
      { id: "4", role: "student", text: "Because it is good.", at: 0, inputMode: "voice" },
      { id: "5", role: "coach", text: "Can you give an example?", at: 0 },
      { id: "6", role: "student", text: "Um I think basically um the bakery is um good you know.", at: 0, inputMode: "voice" },
    ];
    s.speech = { ...s.speech, totalWords: 40 };
    return s;
  };

  it("ties a point from the AI to the question where the student said the words", () => {
    const s = talk();
    s.report.ai = ai({ improvements: [{ title: "Give a reason", detail: "x", quote: "Because it is good", tip: "Say why it is good." }, { title: "b", detail: "d", tip: "t" }] });
    const f = buildQuickReport(s).fix.find((x) => x.problem === "Give a reason")!;
    expect(f.where).toEqual({ n: 2, question: "Why do people trust a brand?" });
  });

  it("finds the short answer, and says which question it was; fillers are in the words box, with their question", () => {
    const s = talk();
    s.report.ai = null;
    s.report.answerCoaching = [];
    const fixes = buildQuickReport(s).fix;
    const short = fixes.find((x) => /was short/.test(x.problem))!;
    expect(short.where?.n).toBe(2);
    expect(short.quote).toBe("Because it is good.");
    expect(fixes.some((x) => /filler/i.test(x.problem))).toBe(false);
    const words = buildQuickReport(s).words;
    expect(words.worstQuestion?.where).toEqual({ n: 3, question: "Can you give an example?" });
    expect(words.fillers[0].word).toBe("um");
  });

  it("shows the question only as the question, not the greeting before it", () => {
    const s = talk();
    s.report.ai = ai({ improvements: [{ title: "Be clear", detail: "x", quote: "A brand is the promise", tip: "t" }] });
    expect(buildQuickReport(s).fix[0].where?.question).toBe("What is a brand?");
  });

  it("puts speed and stopping points (about all answers) in the list, without a question", () => {
    const s = talk();
    s.report.ai = null;
    s.report.answerCoaching = [improve("You spoke fast: about 190 words a minute.", "Take a breath.")];
    const f = buildQuickReport(s).fix.find((x) => /spoke fast/.test(x.problem))!;
    expect(f.where).toBeUndefined();
    expect(f.how).toBe("Take a breath.");
  });

  it("cannot tell the question when the transcript was not saved, but still gives the fix", () => {
    const s = talk();
    s.transcriptKept = false;
    s.turns = [];
    s.report.ai = ai({ improvements: [{ title: "Give a reason", detail: "x", quote: "Because it is good", tip: "Say why." }] });
    const f = buildQuickReport(s).fix[0];
    expect(f.problem).toBe("Give a reason");
    expect(f.where).toBeUndefined();
  });
});

describe("buildQuickReport: the tiles at the top", () => {
  it("shows how each part went at a glance", () => {
    const s = base();
    s.report.ai = null;
    s.turns = [];
    s.transcriptKept = false;
    s.report.answerCoaching = [improve("Answers were short.", "Add a reason."), improve("Many fillers.", "Pause.")];
    s.reading = { mode: "aloud", durationSec: 60, aloud: { accuracyPct: 98, coveragePct: 100, wpm: 130, spokenWordCount: 100, missedWords: [] } };
    const t = buildQuickReport(s).tiles;
    expect(t.map((x) => x.area)).toEqual(["Reading", "Conversation", "Your words", "Face and body"]);
    expect(t[0]).toEqual({ area: "Reading", status: "good", text: "All good" });
    expect(t[1]).toEqual({ area: "Conversation", status: "fix", text: "1 thing to fix" });
    expect(t[3]).toMatchObject({ status: "off", text: "Camera off" });
  });
});

describe("buildQuickReport: fillers, wrong words and the plan", () => {
  const talk = (answers: string[], totalWords = 60): Session => {
    const s = base();
    s.report.ai = null;
    s.transcriptKept = true;
    s.turns = answers.flatMap((a, i) => [
      { id: `c${i}`, role: "coach" as const, text: i === 0 ? "Hi! What is a brand?" : `Question number ${i + 1}?`, at: 0 },
      { id: `s${i}`, role: "student" as const, text: a, at: 0, inputMode: "voice" as const },
    ]);
    s.speech = { ...s.speech, totalWords, fillers: [] };
    return s;
  };

  it("counts the fillers a student used, including haa and umm, and says which question had the most", () => {
    const q = buildQuickReport(talk(["A brand is umm a name haa and umm a promise haa to people", "Um it is um trust um and um good umm service"], 60)).words;
    expect(q.fillerTotal).toBe(9);
    expect(q.fillers[0]).toEqual({ word: "um", count: 4 });
    expect(q.fillers.find((f) => f.word === "umm")?.count).toBe(3);
    expect(q.fillers.some((f) => f.word === "haa")).toBe(true);
    expect(q.fillersPer100).toBe(15);
    expect(q.worstQuestion?.where.n).toBe(2);
    expect(q.status).toBe("fix");
  });

  it("says nothing is wrong when the speech is clean", () => {
    const w = buildQuickReport(talk(["A brand is the name and the promise of a company to people.", "People trust it because the service is good."], 60)).words;
    expect(w.fillerTotal).toBe(0);
    expect(w.mistakes).toEqual([]);
    expect(w.status).toBe("good");
  });

  it("lists wrong words with the right way to say them and the question they were in", () => {
    const w = buildQuickReport(talk(["A brand is a promise.", "I am agree that people don't trust more better shops. He don't know it."], 40)).words;
    expect(w.mistakes.map((m) => m.said)).toEqual(expect.arrayContaining(["I am agree", "more better", "He don't"]));
    const agree = w.mistakes.find((m) => m.said === "I am agree")!;
    expect(agree).toMatchObject({ better: "I agree", where: { n: 2 } });
    expect(w.status).toBe("fix");
  });

  it("uses the wrong words the AI found as well, and does not repeat one the rules found", () => {
    const s = talk(["I am agree with this idea", "People like the discuss about it"], 40);
    s.report.ai = ai({ grammar: [{ quote: "I am agree with this idea", issue: "Wrong verb form", suggestion: "I agree with this idea" }, { quote: "People like the discuss", issue: "Wrong word", suggestion: "People like the discussion" }] });
    const w = buildQuickReport(s).words;
    expect(w.mistakes.filter((m) => /agree/.test(m.said))).toHaveLength(1);
    expect(w.mistakes.some((m) => m.better === "People like the discussion")).toBe(true);
  });

  it("falls back on the measured filler counts when the transcript was not kept", () => {
    const s = talk(["x"], 100);
    s.transcriptKept = false;
    s.turns = [];
    s.speech = { ...s.speech, fillers: [{ word: "umm", count: 7 }] };
    const w = buildQuickReport(s).words;
    expect(w.fillerTotal).toBe(7);
    expect(w.status).toBe("fix");
    expect(w.mistakes).toEqual([]);
  });

  it("gives a plan of at most three steps, and they differ", () => {
    const s = talk(["A brand is umm a name haa and umm a promise haa to people", "I am agree"], 60);
    s.reading = { mode: "aloud", durationSec: 40, aloud: { accuracyPct: 70, coveragePct: 50, wpm: 200, spokenWordCount: 50, missedWords: [], misheard: [{ word: "vapour", heard: "paper" }] } };
    const plan = buildQuickReport(s).plan;
    expect(plan.length).toBeLessThanOrEqual(3);
    expect(plan[0]).toMatch(/whole passage/);
    expect(new Set(plan).size).toBe(plan.length);
  });

  it("shows no words section for a session with no answers", () => {
    const s = base();
    s.speech = { ...s.speech, totalWords: 0 };
    expect(buildQuickReport(s).words.status).toBe("off");
  });
});
