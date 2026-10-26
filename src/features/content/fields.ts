import type { FieldId, FieldInfo, Goal, Level } from "./types";

export const FIELDS: FieldInfo[] = [
  {
    id: "computer-science",
    name: "Computer Science & Technology",
    description: "Software, data, AI, networks and the technology around us.",
    examples: ["Computer Science", "IT", "Data Science", "Cybersecurity"],
  },
  {
    id: "business-marketing",
    name: "Business & Marketing",
    description: "Brands, customers, startups, money and teamwork.",
    examples: ["Marketing", "Management", "Finance", "Entrepreneurship"],
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

/** Extra questions that match what the student wants to improve. They are mixed in with the passage questions. */
export const GOAL_QUESTIONS: Record<Goal, string[]> = {
  fluency: [
    "Tell me about this topic for one minute without stopping. What comes to your mind first?",
    "Explain the main idea once more, this time without long pauses, in your own words.",
  ],
  clarity: [
    "Explain the main idea in three short parts: your point, one reason and one example.",
    "How would you explain this to a friend who has never heard of it?",
  ],
  vocabulary: [
    "Which key words from the passage could you use to describe this idea? Try to use two of them.",
    "Can you say your last point again using a more exact word?",
  ],
  confidence: [
    "What is your own opinion about this topic, and why? There are no wrong answers.",
    "Which part of this topic do you feel most sure about? Tell me about it.",
  ],
  interview: [
    "Imagine an interviewer asks you about this topic. Give a short, clear answer with one example.",
    "What is one strength you could show an interviewer through this topic?",
  ],
};

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
