/*
 * The coach's questions go from easy to difficult. Question 1 is the opening question the module
 * gives; every question after that comes after one more answer from the student.
 */

export type Difficulty = "easy" | "medium" | "hard";

/** Questions 1 to 3 are easy, 4 and 5 are medium, and from question 6 they are hard. */
export function difficultyOfQuestion(questionNumber: number): Difficulty {
  if (questionNumber <= 3) return "easy";
  if (questionNumber <= 5) return "medium";
  return "hard";
}

/** The question the coach asks after `answers` answers from the student (the opening question is number 1). */
export function questionNumberAfter(answers: number): number {
  return answers + 1;
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Warm-up question",
  medium: "Think-it-through question",
  hard: "Challenge question",
};

/** What each difficulty means, written for the AI coach. */
export const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  easy: "EASY: a simple what, which or describe question the student can answer in one or two sentences, straight from the reading or their own life.",
  medium: "MEDIUM: a why or how question, or a request for an example from the student's own life, that needs a few connected sentences.",
  hard: "HARD: an opinion, a comparison, a trade-off, a what-if or a request to judge something, that needs a longer answer with a reason and an example.",
};
