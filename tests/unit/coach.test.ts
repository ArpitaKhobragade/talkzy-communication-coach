import { describe, expect, it } from "vitest";
import { extractJson, quoteAppears, normalizeText, verifyFeedback } from "@/features/coach/verify";
import { buildChatMessages, coachSystemPrompt } from "@/features/coach/server/prompts";
import { devCoachReply, openingMessage } from "@/features/coach/dev-coach";
import { buildBodyLanguageNotes, buildFallbackExercises, buildSpeechNotes } from "@/features/coach/report-builder";
import { computeSpeechMetrics } from "@/features/speech/metrics";
import { rateLimit } from "@/lib/rate-limit";
import { CoachTurnRequestSchema, ReportRequestSchema, type AiFeedback, type CoachTurnRequest, type VisionMetrics } from "@/features/session/types";
import { MODULES, getModule } from "@/features/content/modules";
import { ADULT_ONLY_FIELDS, FIELDS } from "@/features/content/fields";

const feedback = (over: Partial<AiFeedback> = {}): AiFeedback => ({
  headline: "Nice work",
  strengths: [{ title: "Clear idea", detail: "You made a point", quote: "i think robots help people" }],
  improvements: [{ title: "Add examples", detail: "d", quote: "this sentence never happened", tip: "t" }],
  grammar: [
    { quote: "he go to school", issue: "verb form", suggestion: "he goes to school" },
    { quote: "invented grammar mistake", issue: "x", suggestion: "y" },
  ],
  vocabulary: { summary: "s", upgrades: [] },
  structure: {
    summary: "s",
    perAnswer: [
      { answerNumber: 1, relevance: 4, completeness: 3, organization: 3, comment: "c" },
      { answerNumber: 9, relevance: 4, completeness: 3, organization: 3, comment: "c" },
    ],
  },
  exercises: [{ title: "e", instructions: "i", minutes: 3 }],
  nextSessionFocus: "f",
  ...over,
});

describe("verifyFeedback", () => {
  const answers = ["I think robots help people. He go to school every day.", "Because they save time"];

  it("drops fabricated grammar quotes and fabricated example quotes", () => {
    const { feedback: f, droppedQuotes } = verifyFeedback(feedback(), answers);
    expect(f.grammar).toHaveLength(1);
    expect(f.grammar[0].quote).toBe("he go to school");
    expect(f.strengths[0].quote).toBe("i think robots help people");
    expect(f.improvements[0].quote).toBeUndefined();
    expect(droppedQuotes).toBe(2);
  });

  it("removes scores for answers that do not exist", () => {
    const { feedback: f } = verifyFeedback(feedback(), answers);
    expect(f.structure.perAnswer.map((a) => a.answerNumber)).toEqual([1]);
  });

  it("matches quotes regardless of punctuation and case", () => {
    expect(quoteAppears("Robots help, people!", normalizeText("i think robots help people."))).toBe(true);
    expect(quoteAppears("", "anything")).toBe(false);
  });
});

describe("extractJson", () => {
  it("parses JSON wrapped in prose and fences, with braces inside strings", () => {
    const out = extractJson('Here you go:\n```json\n{"a": "x } y", "b": {"c": 1}}\n```\nDone');
    expect(out).toEqual({ a: "x } y", b: { c: 1 } });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("buildChatMessages", () => {
  const base: CoachTurnRequest = {
    moduleId: "computer-science-beginner",
    goal: "clarity",
    level: "beginner",
    ageBand: "13to17",
    remainingSec: 300,
    event: "answer",
    history: [
      { role: "coach", text: "What did you learn?" },
      { role: "student", text: "Computers follow programs." },
    ],
  };

  it("starts with a user message and alternates roles", () => {
    const msgs = buildChatMessages(base);
    expect(msgs[0].role).toBe("user");
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    expect(msgs[msgs.length - 1].role).toBe("user");
    expect(msgs[msgs.length - 1].content).toContain("Computers follow programs.");
  });

  it("adds a system-style note for silence without inventing student text", () => {
    const msgs = buildChatMessages({ ...base, event: "silence", history: [base.history[0]] });
    expect(msgs[msgs.length - 1].content).toMatch(/not said anything/);
    expect(msgs[msgs.length - 1].role).toBe("user");
  });

  it("gives the coach the lesson topic and the passage, but no list of questions to get through", () => {
    const m = getModule("computer-science-beginner")!;
    const system = coachSystemPrompt(m, { ...base, ladderIndex: 2 }, false);
    expect(system).toContain(m.title);
    expect(system).toContain(m.passage.slice(0, 40));
    for (const q of [m.openingQuestion, ...m.followUpQuestions]) expect(system).not.toContain(q);
    expect(system).toMatch(/NO list of questions/);
    expect(system).toMatch(/grows out of what the student has just said/);
  });

  it("covers questions that have nothing to do with the lesson, interruptions and changes of topic", () => {
    const system = coachSystemPrompt(getModule("computer-science-beginner")!, { ...base, event: "ask" }, false);
    expect(system).toMatch(/ANYTHING/);
    expect(system).toMatch(/FOLLOW THEIR LEAD/);
    expect(system).toMatch(/interrupt/i);
    expect(system).toMatch(/last message is a question or request/);
  });

  it("describes the skip situation to the coach", () => {
    const system = coachSystemPrompt(getModule("computer-science-beginner")!, { ...base, event: "skip" }, false);
    expect(system).toMatch(/skipped the last question/);
  });

  it("tells the coach the student skipped the last question", () => {
    const msgs = buildChatMessages({ ...base, event: "skip", history: [base.history[0]] });
    expect(msgs[msgs.length - 1].content).toMatch(/skipped the last question/);
    expect(msgs[msgs.length - 1].role).toBe("user");
  });
});

describe("dev coach", () => {
  const req = (over: Partial<CoachTurnRequest>): CoachTurnRequest => ({
    moduleId: "computer-science-beginner",
    goal: "clarity",
    level: "beginner",
    ageBand: "13to17",
    remainingSec: 300,
    event: "answer",
    history: [
      { role: "coach", text: "q" },
      { role: "student", text: "a long enough answer about programs and how people write instructions for computers" },
    ],
    ...over,
  });

  it("is labelled dev and asks the next scripted question", () => {
    const m = getModule("computer-science-beginner")!;
    const r = devCoachReply(req({}));
    expect(r.mode).toBe("dev");
    expect(r.wrapUp).toBe(false);
    expect(r.text).toContain(m.followUpQuestions[0]);
  });

  it("nudges for more detail after a very short answer", () => {
    const r = devCoachReply(req({ history: [{ role: "coach", text: "q" }, { role: "student", text: "yes" }] }));
    expect(r.text).toMatch(/more detail/i);
  });

  it("wraps up when time is nearly out", () => {
    expect(devCoachReply(req({ remainingSec: 20 })).wrapUp).toBe(true);
  });

  it("handles silence and unclear speech gracefully", () => {
    expect(devCoachReply(req({ event: "silence" })).text).toMatch(/take your time/i);
    expect(devCoachReply(req({ event: "unclear" })).text).toMatch(/say it again/i);
  });

  it("moves on to the next question when the student skips one", () => {
    const m = getModule("computer-science-beginner")!;
    const r = devCoachReply(req({ event: "skip", ladderIndex: 1, history: [{ role: "coach", text: "q" }] }));
    expect(r.text).toMatch(/let us move on/i);
    expect(r.text).toContain(m.followUpQuestions[0]);
    // A second skip goes one question further.
    const again = devCoachReply(req({ event: "skip", ladderIndex: 2, history: [{ role: "coach", text: "q" }] }));
    expect(again.text).toContain(m.followUpQuestions[1]);
  });

  it("does not move the lesson on when the student asks a question; it asks the open question again", () => {
    const m = getModule("computer-science-beginner")!;
    const r = devCoachReply(req({ event: "ask", ladderIndex: 1, history: [{ role: "coach", text: "q" }, { role: "student", text: "What does value mean?" }] }));
    expect(r.wrapUp).toBe(false);
    expect(r.text).toContain(m.openingQuestion);
  });

  it("uses the question place the app sends, not the number of answers", () => {
    const m = getModule("computer-science-beginner")!;
    const r = devCoachReply(req({ ladderIndex: 3 }));
    expect(r.text).toContain(m.followUpQuestions[2]);
  });

  it("greets by first name only", () => {
    expect(openingMessage("computer-science-beginner", "Asha Verma")).toMatch(/^Hi Asha!/);
  });
});

describe("report builder", () => {
  it("never claims pace when there is no voice data", () => {
    const speech = computeSpeechMetrics([{ id: "1", role: "student", text: "typed answer only here", at: 0, inputMode: "typed" }]);
    const notes = buildSpeechNotes(speech).join(" ");
    expect(notes).toMatch(/could not be measured/);
    expect(notes).not.toMatch(/words per minute \(/);
  });

  it("returns no body-language notes without vision data", () => {
    expect(buildBodyLanguageNotes(null)).toEqual([]);
  });

  it("always includes the no-emotion-inference disclaimer when vision data exists", () => {
    const v: VisionMetrics = {
      framesAnalyzed: 100, durationSec: 60, facePresentPct: 90, cameraFacingPct: 70, avgHeadYawDeg: 5, avgHeadPitchDeg: 2,
      shoulderTiltDeg: 2, uprightPct: 80, bodyVisiblePct: 85, handsVisiblePct: 40, movementIndex: 0.1, movementLevel: "moderate",
      facialMovementIndex: 0.05, facialMovementLevel: "low",
    };
    const notes = buildBodyLanguageNotes(v);
    expect(notes[notes.length - 1]).toMatch(/nothing about how you feel/i);
  });

  it("suggests at least two exercises", () => {
    const speech = computeSpeechMetrics([]);
    expect(buildFallbackExercises(speech, "fluency").length).toBeGreaterThanOrEqual(2);
  });
});

describe("request schemas", () => {
  it("rejects oversize history and bad enums", () => {
    const base = { moduleId: "x", goal: "clarity", level: "beginner", ageBand: "13to17", remainingSec: 10, history: [] };
    expect(CoachTurnRequestSchema.safeParse(base).success).toBe(true);
    expect(CoachTurnRequestSchema.safeParse({ ...base, goal: "hack" }).success).toBe(false);
    const many = Array.from({ length: 41 }, () => ({ role: "student", text: "a" }));
    expect(CoachTurnRequestSchema.safeParse({ ...base, history: many }).success).toBe(false);
    expect(CoachTurnRequestSchema.safeParse({ ...base, history: [{ role: "student", text: "a".repeat(2001) }] }).success).toBe(false);
  });
  it("rejects a report request with too many turns", () => {
    const speech = computeSpeechMetrics([]);
    const turns = Array.from({ length: 61 }, () => ({ role: "student" as const, text: "a" }));
    expect(ReportRequestSchema.safeParse({ moduleId: "x", goal: "clarity", level: "beginner", ageBand: "13to17", turns, speech }).success).toBe(false);
  });
});

describe("rateLimit", () => {
  it("blocks after the limit and recovers after the window", () => {
    const key = `k-${Math.random()}`;
    expect(rateLimit(key, 2, 1000, 0).ok).toBe(true);
    expect(rateLimit(key, 2, 1000, 10).ok).toBe(true);
    expect(rateLimit(key, 2, 1000, 20).ok).toBe(false);
    expect(rateLimit(key, 2, 1000, 1500).ok).toBe(true);
  });
});

describe("content library", () => {
  it("has a module for every subject, level and goal with complete content", () => {
    expect(MODULES).toHaveLength(FIELDS.reduce((n, f) => n + 3 * 5 * (ADULT_ONLY_FIELDS.includes(f.id) ? 1 : 3), 0));
    for (const m of MODULES) {
      expect(m.id).toBe(`${m.field}-${m.level}-${m.goal}-${m.age}`);
      expect(m.passage.split(/\s+/).length).toBeGreaterThan(55);
      expect(m.followUpQuestions.length).toBe(6);
      expect(m.keyTerms.length).toBeGreaterThanOrEqual(4);
      for (const t of m.keyTerms) expect(m.passage.toLowerCase()).toContain(t.toLowerCase());
      expect(/[^\x00-\x7F‘’“”]/.test(m.passage)).toBe(false); // plain letters, curly quotes allowed
    }
  });
});
