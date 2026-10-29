import { describe, expect, it } from "vitest";
import { devCoachReply, openingMessage } from "@/features/coach/dev-coach";
import { coachSystemPrompt } from "@/features/coach/server/prompts";
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

  it("starts without a greeting or a name, because the app has already said hello", () => {
    const prompt = coachSystemPrompt(m, { ...request(m.id, 0), event: "start", history: [] }, false);
    expect(prompt).toMatch(/do NOT greet and do NOT use a name/);
    expect(prompt).toMatch(/ONE easy, open question/);
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
