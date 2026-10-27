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
  /** `${field}-${level}` */
  id: string;
  field: FieldId;
  level: Level;
  title: string;
  /** One sentence shown on the library card. */
  summary: string;
  /** Paragraphs separated by a blank line. English only. */
  passage: string;
  /** 4-6 useful terms from the passage, shown as a vocabulary strip. */
  keyTerms: string[];
  /** First question the coach asks after the reading. */
  openingQuestion: string;
  /** 4-6 follow-up questions used by the development-mode coach and as hints. */
  followUpQuestions: string[];
}
