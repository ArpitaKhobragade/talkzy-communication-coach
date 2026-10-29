import { describe, expect, it } from "vitest";
import { devCoachReply, openingMessage } from "@/features/coach/dev-coach";
import { buildChatMessages, coachSystemPrompt } from "@/features/coach/server/prompts";
import { GOALS } from "@/features/content/fields";
import { findModule } from "@/features/content/modules";
import type { CoachTurnRequest } from "@/features/session/types";

function request(moduleId: string, answers: number): CoachTurnRequest {
  const m = findModule("engineering", "intermediate", "interview", "13to17")!;
  const history: CoachTurnRequest["history"] = [{ role: "coach", text: m.openingQuestion }];
  for (let i = 0; i < answers; i++) {
    history.push({ role: "student", text: `This is my answer number ${i + 1}, and it has enough words to count as a real answer.` });
    history.push({ role: "coach", text: m.followUpQuestions[i] ?? "Another question" });
  }
  history.pop();
  return { moduleId, goal: m.goal, level: m.level, ageBand: "18plus", remainingSec: 900, event: "answer", history };
}

describe("the scripted coach (development mode and emergencies) asks the module's questions in order", () => {
  it("asks the module's questions in order", () => {
    const m = findModule("science", "beginner", "fluency", "13to17")!;
    expect(openingMessage(m.id, "Sam")).toContain(m.openingQuestion);
    for (let answers = 1; answers <= m.followUpQuestions.length; answers++) {
      const history: CoachTurnRequest["history"] = [{ role: "coach", text: m.openingQuestion }];
      for (let i = 0; i < answers; i++) {
        history.push({ role: "student", text: "I think this matters because it is part of everyday life for many people and I have seen it." });
        if (i < answers - 1) history.push({ role: "coach", text: m.followUpQuestions[i] });
      }
      const reply = devCoachReply({ moduleId: m.id, goal: m.goal, level: m.level, ageBand: "18plus", remainingSec: 900, event: "answer", history });
      expect(reply.wrapUp).toBe(false);
      expect(reply.text).toContain(m.followUpQuestions[answers - 1]);
    }
  });

  it("closes the conversation after the last question", () => {
    const m = findModule("science", "beginner", "fluency", "13to17")!;
    const history: CoachTurnRequest["history"] = [];
    for (let i = 0; i <= m.followUpQuestions.length; i++) history.push({ role: "student", text: "I think this matters because it is part of everyday life." });
    const reply = devCoachReply({ moduleId: m.id, goal: m.goal, level: m.level, ageBand: "18plus", remainingSec: 900, event: "answer", history });
    expect(reply.wrapUp).toBe(true);
  });
});

describe("the AI coach has a free conversation, with no fixed questions", () => {
  const m = findModule("engineering", "intermediate", "interview", "13to17")!;

  it("is never given the module's questions, whatever point the talk is at", () => {
    for (const answers of [0, 1, 4, 7, 12]) {
      const prompt = coachSystemPrompt(m, request(m.id, answers), false);
      for (const q of [m.openingQuestion, ...m.followUpQuestions]) expect(prompt).not.toContain(q);
    }
  });

  it("is told to listen, react to what was said, and ask one follow-up that grows from it", () => {
    const prompt = coachSystemPrompt(m, request(m.id, 2), false);
    expect(prompt).toMatch(/NOT a quiz or an examiner/);
    expect(prompt).toMatch(/react in a few words to what they actually said/);
    expect(prompt).toMatch(/ONE follow-up question that goes further into THEIR idea/);
    expect(prompt).toMatch(/Exactly ONE question per turn/);
    expect(prompt).toMatch(/Remember the whole talk/);
  });

  it("answers the student's own questions first and then asks a follow-up", () => {
    const prompt = coachSystemPrompt(m, { ...request(m.id, 2), event: "ask" }, false);
    expect(prompt).toMatch(/Answer ANYTHING they ask/);
    expect(prompt).toMatch(/THEN ask ONE natural follow-up question/);
    expect(prompt).toMatch(/Answer it properly first/);
  });

  it("greets the student itself, in its own words, with {name} where the first name goes", () => {
    const prompt = coachSystemPrompt(m, { ...request(m.id, 0), event: "start", history: [] }, false);
    expect(prompt).toMatch(/Greet the student the way a friendly person would/);
    expect(prompt).toContain("{name}");
    expect(prompt).toMatch(/ONE easy, open question/);
  });

  it("says a natural goodbye in its own words when the student ends the session, with no question", () => {
    const prompt = coachSystemPrompt(m, { ...request(m.id, 3), event: "end" }, true);
    expect(prompt).toMatch(/decided to end the session now/);
    expect(prompt).toMatch(/generating their report now/);
    expect(prompt).toMatch(/start with a short, natural/);
    expect(prompt).toMatch(/DO NOT ask a question/);
    expect(prompt).not.toMatch(/time is almost up/);
    // The AI is told what happened.
    const msgs = buildChatMessages({ ...request(m.id, 3), event: "end" }, true);
    expect(msgs.at(-1)?.content).toMatch(/asked to end the session now/);
    expect(msgs.at(-1)?.content).toMatch(/I'm generating your report now/);
    expect(msgs.at(-1)?.content).not.toMatch(/END with exactly one follow-up question/);
  });

  it("is told how its last turns began, so the next one starts differently", () => {
    const history: CoachTurnRequest["history"] = [
      { role: "coach", text: "Exactly, that makes sense to me. Why?" },
      { role: "student", text: "Because it is useful." },
      { role: "coach", text: "Right, and what then? Tell me." },
      { role: "student", text: "Then we try again." },
    ];
    const prompt = coachSystemPrompt(m, { ...request(m.id, 2), history }, false);
    expect(prompt).toContain("Exactly, that makes");
    expect(prompt).toContain("Right, and what");
    expect(prompt).toMatch(/Begin this one in a different way/);
  });

  it("takes its pace from the time left: easy at first, deeper in the middle, a last question near the end", () => {
    expect(coachSystemPrompt(m, { ...request(m.id, 0), remainingSec: 600 }, false)).toMatch(/only just begun/);
    expect(coachSystemPrompt(m, { ...request(m.id, 3), remainingSec: 500 }, false)).toMatch(/the middle/);
    expect(coachSystemPrompt(m, { ...request(m.id, 6), remainingSec: 200 }, false)).toMatch(/the later part/);
    expect(coachSystemPrompt(m, { ...request(m.id, 8), remainingSec: 90 }, false)).toMatch(/only about two minutes are left/);
  });

  it("speaks to the level of the student", () => {
    const beginner = coachSystemPrompt(m, { ...request(m.id, 1), level: "beginner" }, false);
    const advanced = coachSystemPrompt(m, { ...request(m.id, 1), level: "advanced" }, false);
    expect(beginner).toMatch(/very simple, common words/);
    expect(advanced).toMatch(/richer words, idioms and ideas/);
  });

  it("puts feelings first, asks for true facts, does not grade, and has no invented past", () => {
    const prompt = coachSystemPrompt(m, request(m.id, 2), false);
    expect(prompt).toMatch(/FEELINGS COME FIRST/);
    expect(prompt).toMatch(/respond to THAT before anything else/);
    expect(prompt).toMatch(/Never guess a feeling from a short answer/);
    expect(prompt).toMatch(/BE ACCURATE/);
    expect(prompt).toMatch(/myth/);
    expect(prompt).toMatch(/Never make up an explanation/);
    expect(prompt).toMatch(/Do NOT grade or mark/);
    expect(prompt).toMatch(/You have no past/);
    expect(prompt).toMatch(/stuck with me/);
    // The three rules that matter most are repeated at the very end of what the coach reads.
    const last = buildChatMessages(request(m.id, 2)).at(-1)!.content;
    expect(last).toMatch(/said they have a worry or a feeling, respond to that first/);
    expect(last).toMatch(/only with facts you are sure of/);
    expect(last).toMatch(/Do not grade their answer, and do not claim a past of your own/);
  });

  it("closes warmly, naming one real thing, with no new question", () => {
    const prompt = coachSystemPrompt(m, request(m.id, 5), true);
    expect(prompt).toMatch(/time is almost up/);
    expect(prompt).toMatch(/DO NOT ask another question/);
  });
});

describe("each goal has its own questions", () => {
  it("asks different questions for different goals in the same subject and level", () => {
    const sets = GOALS.map((g) => findModule("engineering", "intermediate", g.id, "13to17")!.followUpQuestions.join("|"));
    expect(new Set(sets).size).toBe(GOALS.length);
  });

  it("tells the AI coach the goal of the module, not of the profile", () => {
    const m = findModule("engineering", "intermediate", "vocabulary", "13to17")!;
    const prompt = coachSystemPrompt(m, { ...request(m.id, 1), goal: "fluency" }, false);
    expect(prompt).toContain("Use richer vocabulary");
  });
});
