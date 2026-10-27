import { describe, expect, it } from "vitest";
import { devCoachReply, openingMessage } from "@/features/coach/dev-coach";
import { difficultyOfQuestion, questionNumberAfter } from "@/features/coach/ladder";
import { coachSystemPrompt } from "@/features/coach/server/prompts";
import { GOALS } from "@/features/content/fields";
import { findModule } from "@/features/content/modules";
import type { CoachTurnRequest } from "@/features/session/types";

function request(moduleId: string, answers: number): CoachTurnRequest {
  const m = findModule("engineering", "intermediate", "interview")!;
  const history: CoachTurnRequest["history"] = [{ role: "coach", text: m.openingQuestion }];
  for (let i = 0; i < answers; i++) {
    history.push({ role: "student", text: `This is my answer number ${i + 1}, and it has enough words to count as a real answer.` });
    history.push({ role: "coach", text: m.followUpQuestions[i] ?? "Another question" });
  }
  history.pop();
  return { moduleId, goal: m.goal, level: m.level, ageBand: "18plus", remainingSec: 900, event: "answer", history };
}

describe("questions go from easy to difficult", () => {
  it("makes questions 1 to 3 easy, 4 and 5 medium, and the rest hard", () => {
    expect([1, 2, 3].map(difficultyOfQuestion)).toEqual(["easy", "easy", "easy"]);
    expect([4, 5].map(difficultyOfQuestion)).toEqual(["medium", "medium"]);
    expect([6, 7, 12].map(difficultyOfQuestion)).toEqual(["hard", "hard", "hard"]);
  });

  it("counts the opening question as number 1", () => {
    expect(questionNumberAfter(0)).toBe(1);
    expect(questionNumberAfter(1)).toBe(2);
  });

  it("asks the module's questions in order in development mode", () => {
    const m = findModule("science", "beginner", "fluency")!;
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
    const m = findModule("science", "beginner", "fluency")!;
    const history: CoachTurnRequest["history"] = [];
    for (let i = 0; i <= m.followUpQuestions.length; i++) history.push({ role: "student", text: "I think this matters because it is part of everyday life." });
    const reply = devCoachReply({ moduleId: m.id, goal: m.goal, level: m.level, ageBand: "18plus", remainingSec: 900, event: "answer", history });
    expect(reply.wrapUp).toBe(true);
  });

  it("tells the AI coach which difficulty to ask next", () => {
    const m = findModule("engineering", "intermediate", "interview")!;
    const early = coachSystemPrompt(m, request(m.id, 1), false);
    const middle = coachSystemPrompt(m, request(m.id, 4), false);
    const late = coachSystemPrompt(m, request(m.id, 6), false);
    expect(early).toContain("question number 2");
    expect(early).toContain("must be EASY");
    expect(middle).toContain("question number 5");
    expect(middle).toContain("must be MEDIUM");
    expect(late).toContain("question number 7");
    expect(late).toContain("must be HARD");
  });

  it("gives the AI coach the module's easy, medium and hard questions", () => {
    const m = findModule("engineering", "intermediate", "interview")!;
    const prompt = coachSystemPrompt(m, request(m.id, 1), false);
    expect(prompt).toContain(`Easy: ${m.openingQuestion} | ${m.followUpQuestions[0]} | ${m.followUpQuestions[1]}`);
    expect(prompt).toContain(`Medium: ${m.followUpQuestions[2]} | ${m.followUpQuestions[3]}`);
    expect(prompt).toContain(`Hard: ${m.followUpQuestions[4]} | ${m.followUpQuestions[5]}`);
  });
});

describe("each goal has its own questions", () => {
  it("asks different questions for different goals in the same subject and level", () => {
    const sets = GOALS.map((g) => findModule("engineering", "intermediate", g.id)!.followUpQuestions.join("|"));
    expect(new Set(sets).size).toBe(GOALS.length);
  });

  it("tells the AI coach the goal of the module, not of the profile", () => {
    const m = findModule("engineering", "intermediate", "vocabulary")!;
    const prompt = coachSystemPrompt(m, { ...request(m.id, 1), goal: "fluency" }, false);
    expect(prompt).toContain("Use richer vocabulary");
  });
});
