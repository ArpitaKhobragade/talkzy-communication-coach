export type FieldId =
  | "computer-science"
  | "business-marketing"
  | "science"
  | "engineering"
  | "health-medicine"
  | "humanities-social"
  | "arts-design"
  | "school-general";

export type Level = "beginner" | "intermediate" | "advanced";

export type Goal = "fluency" | "clarity" | "vocabulary" | "confidence" | "interview";

export interface FieldInfo {
  id: FieldId;
  name: string;
  description: string;
  /** Example majors / interests shown in the profile screen. */
  examples: string[];
}

export interface LearningModule {
  /** `${field}-${level}-${goal}` */
  id: string;
  field: FieldId;
  level: Level;
  /** What the student wants to improve. Each goal has its own passage, questions and activity. */
  goal: Goal;
  title: string;
  /** One sentence shown on the library card. */
  summary: string;
  /** Paragraphs separated by a blank line. English only. */
  passage: string;
  /** 5-6 useful terms that appear in the passage, shown as a vocabulary strip. */
  keyTerms: string[];
  /** First question the coach asks after the reading. The easiest one. */
  openingQuestion: string;
  /**
   * Exactly 6 follow-up questions ordered from easy to difficult: two easy, two medium, two hard.
   * Used by the development-mode coach and as the question ladder for the AI coach.
   */
  followUpQuestions: string[];
}
