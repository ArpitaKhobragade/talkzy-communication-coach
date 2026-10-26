import { describe, expect, it } from "vitest";
import { devCoachReply } from "@/features/coach/dev-coach";
import { GOALS, GOAL_QUESTIONS } from "@/features/content/fields";
import { MODULES } from "@/features/content/modules";

describe("questions follow the student's goal", () => {
  it("has questions for every goal", () => {
    for (const g of GOALS) expect(GOAL_QUESTIONS[g.id].length).toBeGreaterThanOrEqual(2);
  });

  it("asks a goal question after the first passage question", () => {
    const m = MODULES[0];
    const ask = (goal: "fluency" | "interview") =>
      devCoachReply({
        moduleId: m.id,
        goal,
        level: m.level,
        ageBand: "18plus",
        remainingSec: 600,
        event: "answer",
        history: [
          { role: "coach", text: "Opening question" },
          { role: "student", text: "I think this topic matters because it affects many people in daily life, for example at school." },
          { role: "coach", text: m.followUpQuestions[0] },
          { role: "student", text: "It is important because people learn faster when the examples are close to their own life." },
        ],
      }).text;
    expect(ask("fluency")).toContain(GOAL_QUESTIONS.fluency[0]);
    expect(ask("interview")).toContain(GOAL_QUESTIONS.interview[0]);
  });
});
