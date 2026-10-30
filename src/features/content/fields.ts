import type { FieldId, FieldInfo, Goal, Level } from "./types";

export const FIELDS: FieldInfo[] = [
  {
    id: "computer-science",
    name: "Technology & BCA overview",
    description: "A light look at software, data, AI and the technology every manager meets.",
    examples: ["BCA", "IT basics", "Data and AI", "Cybersecurity"],
  },
  {
    id: "business-marketing",
    name: "Marketing & Sales",
    description: "Brands, customers, pricing, selling and growing a business.",
    examples: ["Marketing", "Sales", "Branding", "Entrepreneurship"],
  },
  {
    id: "management-leadership",
    name: "Leadership & Strategy",
    description: "Leading teams, making decisions, strategy and change.",
    examples: ["General Management","Strategy","Leadership","Business Policy"],
  },
  {
    id: "management-hr",
    name: "HR & People Management",
    description: "Hiring, motivation, feedback, culture and teamwork.",
    examples: ["Human Resources","Organisational Behaviour","Talent","Training"],
  },
  {
    id: "management-finance",
    name: "Finance & Accounting",
    description: "Budgets, costs, profit, investment and reading numbers.",
    examples: ["Finance","Accounting","Banking","Investment"],
  },
  {
    id: "management-operations",
    name: "Operations & Supply Chain",
    description: "Planning, quality, logistics, projects and getting work done.",
    examples: ["Operations","Supply Chain","Logistics","Project Management"],
  },
  {
    id: "science",
    name: "Science",
    description: "Physics, chemistry, biology and how the natural world works.",
    examples: ["Physics", "Chemistry", "Biology", "Environmental Science"],
  },
  {
    id: "engineering",
    name: "Engineering",
    description: "Designing and building machines, structures and systems.",
    examples: ["Mechanical", "Civil", "Electrical", "Electronics"],
  },
  {
    id: "health-medicine",
    name: "Health & Medicine",
    description: "Caring for people, healthy habits and how the body works.",
    examples: ["Nursing", "Medicine", "Pharmacy", "Public Health"],
  },
  {
    id: "humanities-social",
    name: "Humanities & Social Sciences",
    description: "History, society, psychology, law and ideas.",
    examples: ["History", "Psychology", "Law", "Political Science"],
  },
  {
    id: "arts-design",
    name: "Arts, Media & Design",
    description: "Creative work, storytelling, design and communication.",
    examples: ["Design", "Film & Media", "Journalism", "Fine Arts"],
  },
  {
    id: "school-general",
    name: "School & Everyday Topics",
    description: "Friendly topics for school students: hobbies, community and learning.",
    examples: ["Grades 5-12", "General interest", "Undecided"],
  },
];

/**
 * The subjects a student sees. Talkzy is for management colleges, so the management specializations come first and
 * technology is a light overview. The other subjects still exist in the library but are not offered.
 */
export const STUDENT_FIELDS: FieldId[] = [
  "management-leadership",
  "business-marketing",
  "management-hr",
  "management-finance",
  "management-operations",
  "computer-science",
];

/** The subjects written only for adults (every student now is treated as an adult learner). */
export const ADULT_ONLY_FIELDS: FieldId[] = ["management-leadership", "management-hr", "management-finance", "management-operations"];

export const LEVELS: { id: Level; name: string; description: string }[] = [
  { id: "beginner", name: "Beginner", description: "Short, simple passages and easy questions." },
  { id: "intermediate", name: "Intermediate", description: "Longer passages and questions that ask for reasons." },
  { id: "advanced", name: "Advanced", description: "Complex ideas, opinions and examples." },
];

export const GOALS: { id: Goal; name: string; description: string; coachFocus: string }[] = [
  {
    id: "fluency",
    name: "Speak more fluently",
    description: "Fewer pauses and fillers, smoother delivery.",
    coachFocus: "Encourage longer, uninterrupted answers. Gently notice filler words and long pauses.",
  },
  {
    id: "clarity",
    name: "Explain ideas clearly",
    description: "Organise your thoughts with a clear point and example.",
    coachFocus: "Ask the student to state a main point, give a reason, then an example (point, reason, example).",
  },
  {
    id: "vocabulary",
    name: "Use richer vocabulary",
    description: "Use precise words from your field.",
    coachFocus: "Invite use of key terms from the passage and ask for more precise words.",
  },
  {
    id: "confidence",
    name: "Speak with confidence",
    description: "Practise giving opinions and speaking up.",
    coachFocus: "Ask for opinions and decisions. Celebrate effort and keep a warm, low-pressure tone.",
  },
  {
    id: "interview",
    name: "Prepare for interviews",
    description: "Answer common questions concisely and professionally.",
    coachFocus: "Use interview-style questions linked to the topic; encourage concise answers with a concrete example.",
  },
];

export function getField(id: FieldId): FieldInfo {
  const f = FIELDS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown field: ${id}`);
  return f;
}

export function getGoal(id: Goal) {
  const g = GOALS.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown goal: ${id}`);
  return g;
}

/** What the profile shows when the student has not chosen yet. */
export const NOT_SURE_NAME = "Not sure yet";

export function fieldChoiceName(id: FieldId | "unsure"): string {
  return id === "unsure" ? NOT_SURE_NAME : getField(id).name;
}

export function levelChoiceName(id: Level | "unsure"): string {
  return id === "unsure" ? NOT_SURE_NAME : (LEVELS.find((l) => l.id === id)?.name ?? id);
}

export function goalChoiceName(id: Goal | "unsure"): string {
  return id === "unsure" ? NOT_SURE_NAME : getGoal(id).name;
}
