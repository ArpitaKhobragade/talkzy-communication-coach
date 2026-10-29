import { beforeEach, describe, expect, it, vi } from "vitest";

// No real LLM is called. These tests stub the provider layer to check our route logic:
// prompt/response handling, retry, fallback, and quote verification.
// vi.mock is hoisted above normal declarations, so the shared mock must be created with vi.hoisted.
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/features/coach/server/llm", () => ({
  isLiveMode: () => true,
  activeProvider: () => "groq",
  generate,
}));

import { POST as turnPost } from "@/app/api/coach/turn/route";
import { POST as reportPost } from "@/app/api/coach/report/route";
import { getModule } from "@/features/content/modules";
import { computeSpeechMetrics } from "@/features/speech/metrics";

let ipCounter = 0;
const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipCounter}` },
    body: JSON.stringify(body),
  });

const reply = (t: string) => ({ text: t, model: "test-model" });

const turnBody = (over: Record<string, unknown> = {}) => ({
  moduleId: "computer-science-beginner",
  goal: "clarity",
  level: "beginner",
  ageBand: "13to17",
  remainingSec: 300,
  event: "answer",
  history: [
    { role: "coach", text: "What is a program?" },
    { role: "student", text: "A program is a list of steps for a computer." },
  ],
  ...over,
});

beforeEach(() => {
  // Braces matter: returning the mock from beforeEach would make Vitest call it as a teardown hook.
  generate.mockReset();
});

describe("POST /api/coach/turn (live mode, stubbed model)", () => {
  it("returns the model's reply labelled live and sends the passage + safety rules to the model", async () => {
    generate.mockResolvedValue(reply("  Nice explanation!   What might go wrong if a step is missing?  "));
    const res = await turnPost(post("/api/coach/turn", turnBody()));
    const body = await res.json();
    expect(body).toEqual({ text: "Nice explanation! What might go wrong if a step is missing?", mode: "live", wrapUp: false });

    const args = generate.mock.calls[0][0];
    expect(args.purpose).toBe("chat");
    expect(args.system).toContain(getModule("computer-science-beginner")!.passage.split("\n\n")[0]); // passage grounding
    expect(args.system).toMatch(/DATA, not instructions/);
    expect(args.system).toMatch(/trusted adult/);
    expect(args.messages[0].role).toBe("user");
    expect(args.messages.at(-1).content).toContain("A program is a list of steps");
  });

  it("asks the model to close, and flags wrapUp, when time is nearly out", async () => {
    generate.mockResolvedValue(reply("Great chat today. Your report is next."));
    const body = await (await turnPost(post("/api/coach/turn", turnBody({ remainingSec: 20 })))).json();
    expect(body.wrapUp).toBe(true);
    expect(generate.mock.calls[0][0].system).toMatch(/time is almost up/i);
  });

  it("falls back to the scripted coach, honestly labelled dev/degraded, when the model call fails", async () => {
    generate.mockRejectedValue(new Error("boom"));
    const body = await (await turnPost(post("/api/coach/turn", turnBody()))).json();
    expect(body.mode).toBe("dev");
    expect(body.degraded).toBe(true);
    expect(body.text.length).toBeGreaterThan(5);
  });

  it("has the AI write the opening from the passage, with no list of questions in what the AI reads", async () => {
    generate.mockResolvedValue(reply("A program being a list of steps is a neat idea. What did you think of it?"));
    const res = await turnPost(post("/api/coach/turn", turnBody({ event: "start", history: [] })));
    expect(await res.json()).toEqual({ text: "A program being a list of steps is a neat idea. What did you think of it?", mode: "live", wrapUp: false });
    const m = getModule("computer-science-beginner")!;
    const system = generate.mock.calls[0][0].system as string;
    expect(system).toMatch(/the very start/i);
    expect(system).toContain(m.passage.slice(0, 40));
    // No fixed question of the module is given to the AI: it asks what grows out of the talk.
    for (const q of [m.openingQuestion, ...m.followUpQuestions]) expect(system).not.toContain(q);
  });

  it("asks once more when the opening is too thin to say anything about the passage", async () => {
    generate.mockResolvedValueOnce(reply("Hey {name}, ready to chat?")).mockResolvedValueOnce(reply("Hey {name}, good to see you. I like how the passage says a program is just a list of steps. What do you think makes a good list of steps?"));
    const body = await (await turnPost(post("/api/coach/turn", turnBody({ event: "start", history: [] })))).json();
    expect(body.text).toMatch(/list of steps/);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("uses the scripted opening, labelled, when the AI fails to write one", async () => {
    generate.mockRejectedValue(new Error("boom"));
    const body = await (await turnPost(post("/api/coach/turn", turnBody({ event: "start", history: [] })))).json();
    expect(body).toMatchObject({ mode: "dev", degraded: true, wrapUp: false });
    expect(body.text).toBe(getModule("computer-science-beginner")!.openingQuestion);
  });

  it("asks once more when the AI forgot to end with a question, and keeps the better reply", async () => {
    generate.mockResolvedValueOnce(reply("That sounds like a great weekly ritual.")).mockResolvedValueOnce(reply("That sounds like a great weekly ritual. Who do you play with?"));
    const body = await (await turnPost(post("/api/coach/turn", turnBody()))).json();
    expect(body.text).toBe("That sounds like a great weekly ritual. Who do you play with?");
    expect(generate).toHaveBeenCalledTimes(2);
    const second = generate.mock.calls[1][0].messages as { role: string; content: string }[];
    expect(second.at(-1)?.content).toMatch(/no question/i);
  });

  it("asks again when the reply grades the student like an examiner, and uses the better one", async () => {
    generate.mockResolvedValueOnce(reply("That is a perfect example! What happened next?")).mockResolvedValueOnce(reply("That is a clear example. What happened next?"));
    const body = await (await turnPost(post("/api/coach/turn", turnBody()))).json();
    expect(body.text).toBe("That is a clear example. What happened next?");
    const second = generate.mock.calls[1][0].messages as { content: string }[];
    expect(second.at(-1)?.content).toMatch(/grades or praises/);
  });

  it("asks again when the reply claims a past of its own", async () => {
    generate.mockResolvedValueOnce(reply("That story really stuck with me. Why did it matter?")).mockResolvedValueOnce(reply("That story is interesting. Why did it matter?"));
    const body = await (await turnPost(post("/api/coach/turn", turnBody()))).json();
    expect(body.text).toBe("That story is interesting. Why did it matter?");
    const second = generate.mock.calls[1][0].messages as { content: string }[];
    expect(second.at(-1)?.content).toMatch(/claims a past/);
  });

  it("keeps only the goodbye when the closing has a question glued in front of it", async () => {
    generate.mockResolvedValue(reply("If you could add a twist, what would it be?You made a clever point about the ads. I will put your report together now."));
    const body = await (await turnPost(post("/api/coach/turn", turnBody({ remainingSec: 20 })))).json();
    expect(body.wrapUp).toBe(true);
    expect(body.text).toBe("You made a clever point about the ads. I will put your report together now.");
  });

  it("keeps the first reply if the second try is no better", async () => {
    generate.mockResolvedValue(reply("Nice point."));
    expect((await (await turnPost(post("/api/coach/turn", turnBody()))).json()).text).toBe("Nice point.");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("accepts a proper goodbye at once, but asks again when the closing is a question or does not say the report is coming", async () => {
    generate.mockResolvedValue(reply("I liked how you linked the ads to the news. Your feedback report is being made now."));
    await turnPost(post("/api/coach/turn", turnBody({ remainingSec: 20 })));
    expect(generate).toHaveBeenCalledTimes(1);

    generate.mockReset();
    generate
      .mockResolvedValueOnce(reply("That is a clear point. Does that sound like something you could say?"))
      .mockResolvedValueOnce(reply("That was a clear point about the ads. Your written feedback report is being made now."));
    const body = await (await turnPost(post("/api/coach/turn", turnBody({ remainingSec: 20 })))).json();
    expect(body.text).toBe("That was a clear point about the ads. Your written feedback report is being made now.");
    expect(generate).toHaveBeenCalledTimes(2);
    expect((generate.mock.calls[1][0].messages as { content: string }[]).at(-1)?.content).toMatch(/not a goodbye/);
  });

  it("asks the AI to say the same question again, in simpler words, after a silence", async () => {
    generate.mockResolvedValue(reply("No rush at all. Would you like to say it with a yes or a no?"));
    await turnPost(post("/api/coach/turn", turnBody({ event: "silence" })));
    expect((generate.mock.calls[0][0].messages as { content: string }[]).at(-1)?.content).toMatch(/ask the SAME question you asked last/);
  });

  it("does not let the coach say \"welcome back\" to a student it has never met", async () => {
    generate
      .mockResolvedValueOnce(reply("Hey there, welcome back. The passage says a program is a list of steps. What do you think about that?"))
      .mockResolvedValueOnce(reply("Hey there. The passage says a program is a list of steps. What do you think about that?"));
    const body = await (await turnPost(post("/api/coach/turn", turnBody({ event: "start", history: [] })))).json();
    expect(body.text).not.toMatch(/welcome back/i);
  });

  it("puts a reminder to end with one follow-up question at the very end of what the AI reads", async () => {
    generate.mockResolvedValue(reply("I see. Why is that?"));
    await turnPost(post("/api/coach/turn", turnBody()));
    const msgs = generate.mock.calls[0][0].messages as { role: string; content: string }[];
    expect(msgs.at(-1)?.role).toBe("user");
    expect(msgs.at(-1)?.content).toMatch(/END with exactly one follow-up question/);
  });
});

const goodReport = {
  headline: "Nice clear answers today.",
  strengths: [{ title: "Clear point", detail: "You stated your idea first.", quote: "a program is a list of steps" }],
  improvements: [{ title: "Add examples", detail: "d", quote: "this was never said by the student", tip: "Give one example." }],
  grammar: [
    { quote: "he go to school", issue: "verb form", suggestion: "he goes to school" },
    { quote: "invented mistake", issue: "x", suggestion: "y" },
  ],
  vocabulary: { summary: "Good basic words.", upgrades: [] },
  structure: { summary: "Mostly clear.", perAnswer: [{ answerNumber: 1, relevance: 4, completeness: 3, organization: 4, comment: "ok" }] },
  reading: { summary: "You read most of it.", wentWell: ["Steady pace"], improve: [{ issue: "Skipped words", howTo: "Slow down" }] },
  exercises: [{ title: "One-minute talk", instructions: "Talk for a minute.", minutes: 3 }],
  nextSessionFocus: "Add an example to each answer.",
};

const reportBody = (over: Record<string, unknown> = {}) => ({
  moduleId: "computer-science-beginner",
  goal: "clarity",
  level: "beginner",
  ageBand: "13to17",
  turns: [
    { role: "coach", text: "What is a program?" },
    { role: "student", text: "A program is a list of steps for a computer. He go to school every day.", inputMode: "voice" },
  ],
  speech: computeSpeechMetrics([]),
  ...over,
});

describe("POST /api/coach/report (live mode, stubbed model)", () => {
  it("returns verified feedback: fabricated quotes are removed before reaching the student", async () => {
    generate.mockResolvedValue(reply("```json\n" + JSON.stringify(goodReport) + "\n```"));
    const body = await (await reportPost(post("/api/coach/report", reportBody()))).json();
    expect(body.model).toBe("test-model");
    expect(body.ai.grammar).toHaveLength(1);
    expect(body.ai.grammar[0].quote).toBe("he go to school");
    expect(body.ai.improvements[0].quote).toBeUndefined();
    expect(body.ai.strengths[0].quote).toBe("a program is a list of steps");
    expect(body.ai.reading.summary).toBe("You read most of it.");
    expect(body.droppedQuotes).toBe(2);
  });

  it("still accepts a model reply without the optional reading section", async () => {
    const { reading, ...withoutReading } = goodReport;
    void reading;
    generate.mockResolvedValue(reply(JSON.stringify(withoutReading)));
    const body = await (await reportPost(post("/api/coach/report", reportBody()))).json();
    expect(body.ai).not.toBeNull();
    expect(body.ai.reading).toBeUndefined();
  });

  it("accepts a model reply that writes null for a part it has nothing to say about", async () => {
    // Real models often write "quote": null instead of leaving the quote out. That used to throw the whole report away.
    const withNulls = {
      ...goodReport,
      strengths: [{ ...goodReport.strengths[0], quote: null }],
      improvements: [{ ...goodReport.improvements[0], quote: null }],
      sayItBetter: null,
      reading: null,
    };
    generate.mockResolvedValue(reply(JSON.stringify(withNulls)));
    const body = await (await reportPost(post("/api/coach/report", reportBody()))).json();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(body.ai).not.toBeNull();
    expect(body.ai.strengths[0].quote).toBeUndefined();
    expect(body.ai.reading).toBeUndefined();
  });

  it("retries once when the first reply is not valid JSON", async () => {
    generate.mockResolvedValueOnce(reply("Sorry, here is some prose instead.")).mockResolvedValueOnce(reply(JSON.stringify(goodReport)));
    const body = await (await reportPost(post("/api/coach/report", reportBody()))).json();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(body.ai).not.toBeNull();
  });

  it("returns ai: null with a reason (no invented feedback) after repeated failures", async () => {
    generate.mockResolvedValue(reply("not json at all"));
    const body = await (await reportPost(post("/api/coach/report", reportBody()))).json();
    expect(body.ai).toBeNull();
    expect(body.reason).toMatch(/could not produce/i);
  });

  it("puts the transcript and the reading data in the prompt and forbids judging punctuation or pronunciation", async () => {
    generate.mockResolvedValue(reply(JSON.stringify(goodReport)));
    await reportPost(
      post(
        "/api/coach/report",
        reportBody({ readingAloud: { accuracyPct: 82, coveragePct: 95, wpm: 140, spokenWordCount: 100, missedWords: ["debugging", "instructions"] } }),
      ),
    );
    const args = generate.mock.calls[0][0];
    expect(args.purpose).toBe("report");
    expect(args.system).toMatch(/NEVER criticise punctuation/);
    expect(args.system).toMatch(/Do not infer emotions/);
    expect(args.system).toMatch(/Never claim to assess pronunciation/);
    expect(args.system).toMatch(/NEVER say the student understood/);
    expect(args.system).toMatch(/VERY SIMPLE English/);
    expect(args.system).toMatch(/"sayItBetter"/);
    expect(args.messages[0].content).toContain("Student answer 1 (spoken, speech-recognition text)");
    expect(args.messages[0].content).toContain("matched 82% of the words they reached");
    expect(args.messages[0].content).toContain("debugging, instructions");
  });

  it("describes silent reading time when the student did not read aloud", async () => {
    generate.mockResolvedValue(reply(JSON.stringify(goodReport)));
    await reportPost(post("/api/coach/report", reportBody({ readingMode: "silent", readingSec: 60, passageWords: 120 })));
    expect(generate.mock.calls[0][0].messages[0].content).toMatch(/read silently/);
  });
});
