import { describe, expect, it } from "vitest";
import { devCoachReply, openingMessage } from "@/features/coach/dev-coach";
import { difficultyOfQuestion, questionNumberAfter } from "@/features/coach/ladder";
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

  it("tells the AI coach which question is next, and how difficult it must be", () => {
    const m = findModule("engineering", "intermediate", "interview", "13to17")!;
    const early = coachSystemPrompt(m, request(m.id, 1), false);
    const middle = coachSystemPrompt(m, request(m.id, 4), false);
    const late = coachSystemPrompt(m, request(m.id, 6), false);
    expect(early).toContain("question 2 of 7");
    expect(early).toContain("EASY:");
    expect(early).toContain(`The NEXT question in the plan: "${m.followUpQuestions[0]}"`);
    expect(middle).toContain("question 5 of 7");
    expect(middle).toContain("MEDIUM:");
    expect(late).toContain("question 7 of 7");
    expect(late).toContain("HARD:");
  });

  it("gives the AI coach all seven questions in order, and follows the place the app sends", () => {
    const m = findModule("engineering", "intermediate", "interview", "13to17")!;
    const prompt = coachSystemPrompt(m, request(m.id, 1), false);
    const plan = [m.openingQuestion, ...m.followUpQuestions];
    plan.forEach((q, i) => expect(prompt).toContain(`${i + 1}. ${q}`));
    // The app's own count wins over the number of answers: a skipped question moves the plan on without an answer.
    const skipped = coachSystemPrompt(m, { ...request(m.id, 1), ladderIndex: 3 }, false);
    expect(skipped).toContain(`The NEXT question in the plan: "${m.followUpQuestions[2]}"`);
  });

  it("finishes the plan and asks the coach for one new, harder question", () => {
    const m = findModule("engineering", "intermediate", "interview", "13to17")!;
    const prompt = coachSystemPrompt(m, { ...request(m.id, 6), ladderIndex: 7 }, false);
    expect(prompt).toMatch(/The plan is finished/);
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
