/*
 * Practice sessions made up for testing. Each one has mistakes put in ON PURPOSE, and we write down
 * exactly what those mistakes are. Then we check whether the app's feedback finds them.
 * The last session has no mistakes at all, to see whether the feedback invents problems.
 */
import { getModule } from "../src/features/content/modules";
import type { LearningModule } from "../src/features/content/types";
import { analyzeReadingAloud, type ReadingAloudAnalysis } from "../src/features/speech/reading";
import { computeSpeechMetrics, countWords, tokenize } from "../src/features/speech/metrics";
import type { ReportRequest, Turn } from "../src/features/session/types";

export type IssueKind = "filler" | "grammar" | "short-answer" | "off-topic" | "no-reason" | "vocab-repeat" | "reading-incomplete" | "misread";

export interface PlantedIssue {
  id: string;
  kind: IssueKind;
  /** What was done wrong, in plain words (the judge sees this). */
  what: string;
  /** Exact wrong phrases we typed in (grammar issues only). A good correction must not keep them. */
  wrong?: string[];
}

export interface Scenario {
  id: string;
  title: string;
  moduleId: string;
  /** The student's answers, in order. */
  answers: string[];
  /** Words per minute the student "spoke" at, and pauses per answer. Used to make the timing numbers. */
  wpm: number;
  pausesPerAnswer: number;
  /** How much of the passage the student read aloud (0 to 1), and how many words they got wrong. */
  readShare: number;
  readErrors: number;
  planted: PlantedIssue[];
  /** True when the student made no mistakes. The feedback should then be mostly positive. */
  control?: boolean;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    title: "Filler words and very short answers",
    moduleId: "computer-science-beginner-fluency",
    wpm: 95,
    pausesPerAnswer: 3,
    readShare: 1,
    readErrors: 6,
    answers: [
      "Um, yes, I send messages to my, uh, friends. Like, mostly my best friend, you know.",
      "Uh, it goes, like, to the tower. Um, basically that is it.",
      "Um, it goes under the, uh, ground. And, you know, the sea. Yeah.",
      "Uh, I sent a message, um, to my mother. Basically I said, like, I will be late.",
      "Um, I use my phone, uh, for, you know, games. And, um, videos. That is all.",
    ],
    planted: [
      { id: "S1-fillers", kind: "filler", what: "Every answer is full of the filler words um, uh, you know and basically (and the word like used as a filler)." },
      { id: "S1-short", kind: "short-answer", what: "All the answers are very short, about 10 to 14 words, with no detail or example." },
      { id: "S1-misread", kind: "misread", what: "While reading aloud, the student skipped or changed 6 words of the passage." },
    ],
  },
  {
    id: "S2",
    title: "Grammar mistakes and the same word again and again",
    moduleId: "business-marketing-intermediate-clarity",
    wpm: 125,
    pausesPerAnswer: 1,
    readShare: 1,
    readErrors: 1,
    answers: [
      "Many startups begin with a idea. The founders think it is very good idea, and I am agree with them because it is very good.",
      "Minimum viable product is the first version of the product. It have only the most important features. The people can see it quick and the cost is not much.",
      "Pivot mean change the plan. The founder don't need to stop, they only change. This is very good because he learn many informations from customers.",
      "Asking real customers is more better than trust the founder opinion. Customers is the people who pay money, so their opinion is very very important.",
      "I tried one app which was feeling unfinished. I am not liking it and I left the app yesterday. It was very bad and very bad design.",
    ],
    planted: [
      {
        id: "S2-grammar",
        kind: "grammar",
        what: "Many clear grammar mistakes: 'a idea', 'I am agree', 'It have', 'Pivot mean', 'founder don't', 'he learn', 'many informations', 'more better', 'Customers is', 'was feeling', 'I am not liking'.",
        wrong: ["a idea", "i am agree", "it have", "pivot mean", "founder don't", "he learn", "many informations", "more better", "than trust", "customers is", "was feeling", "i am not liking"],
      },
      { id: "S2-repeat", kind: "vocab-repeat", what: "The words 'very' and 'good' are used again and again ('very very important', 'very bad and very bad design')." },
    ],
  },
  {
    id: "S3",
    title: "Off the topic, no reasons and no opinion",
    moduleId: "science-advanced-confidence",
    wpm: 110,
    pausesPerAnswer: 2,
    readShare: 0.55,
    readErrors: 0,
    answers: [
      "I don't know, maybe it is good. I don't know much about this.",
      "Hmm, I think maybe it's okay. Actually yesterday I watched a cricket match and Virat Kohli scored a century, it was amazing.",
      "I don't know. Maybe yes, maybe no.",
      "My cousin got a new phone and it has a really nice camera. I like phones a lot.",
      "I am not sure. Whatever you think is right, I guess. I can't really say.",
    ],
    planted: [
      { id: "S3-offtopic", kind: "off-topic", what: "Answers 2 and 4 are about a cricket match and a new phone, not about gene editing." },
      { id: "S3-noreason", kind: "no-reason", what: "The student never gives an opinion or a reason. Four of the five answers say 'I don't know', 'maybe' or 'I am not sure'." },
      { id: "S3-short", kind: "short-answer", what: "Answers are short, about 10 to 20 words, with no example or detail." },
      { id: "S3-reading", kind: "reading-incomplete", what: "The student stopped reading aloud about halfway through the passage (only about 55% was read)." },
    ],
  },
  {
    id: "S4",
    title: "Control: a strong session with no mistakes",
    moduleId: "computer-science-intermediate-clarity",
    wpm: 135,
    pausesPerAnswer: 1,
    readShare: 1,
    readErrors: 1,
    control: true,
    answers: [
      "I use a password for my email account. It keeps my private messages safe from other people.",
      "A long password made of several random words is stronger, because a computer needs much more time to guess it, and it is still easy for me to remember.",
      "If I used the same password everywhere, one hacked website could open all my accounts. For example, a thief who steals it from a game site could try it on my email.",
      "I think two-step verification is worth the extra effort. It takes about ten seconds, but it stops a thief who knows my password. My brother lost his account once because he skipped it.",
      "I would tell a younger student to use a password manager, so they only remember one strong phrase. It is safer than writing passwords in a notebook, and much easier than inventing many different ones.",
    ],
    planted: [],
  },
];

/** The text a student would say while reading aloud, with some words skipped or changed on purpose. */
export function spokenReading(m: LearningModule, readShare: number, errors: number): { spoken: string; planted: string[] } {
  const words = m.passage.split(/\s+/);
  const keep = Math.max(5, Math.round(words.length * readShare));
  const used = words.slice(0, keep);
  const counts = new Map<string, number>();
  for (const w of tokenize(m.passage)) counts.set(w, (counts.get(w) ?? 0) + 1);
  // Candidates: words of 5+ letters that appear only once in the passage, so a miss cannot be hidden by a repeat.
  const idx: number[] = [];
  used.forEach((w, i) => {
    const t = tokenize(w)[0];
    if (t && t.length >= 5 && counts.get(t) === 1 && i > 3 && i < used.length - 3) idx.push(i);
  });
  const step = errors > 0 ? Math.max(1, Math.floor(idx.length / errors)) : 1;
  const chosen = errors > 0 ? idx.filter((_, k) => k % step === 0).slice(0, errors) : [];
  const planted: string[] = [];
  const out = used.map((w, i) => {
    if (!chosen.includes(i)) return w;
    planted.push(tokenize(w)[0]);
    return chosen.indexOf(i) % 2 === 0 ? "" : "thing"; // skip it, or say a wrong word
  });
  return { spoken: out.filter(Boolean).join(" "), planted };
}

export interface BuiltScenario {
  scenario: Scenario;
  module: LearningModule;
  turns: Turn[];
  reading: ReadingAloudAnalysis | null;
  plantedMisreads: string[];
  request: ReportRequest;
}

/** Turns a scenario into exactly what the app would send to the report service. */
export function buildScenario(s: Scenario, questions: string[]): BuiltScenario {
  const lesson = getModule(s.moduleId);
  if (!lesson) throw new Error(`unknown module ${s.moduleId}`);

  const turns: Turn[] = [];
  let at = 1_700_000_000_000;
  s.answers.forEach((text, i) => {
    turns.push({ id: `c${i}`, role: "coach", text: questions[i] ?? lesson.openingQuestion, at: (at += 5000) });
    const words = countWords(text);
    const speakingSec = Math.round(((words / s.wpm) * 60 + s.pausesPerAnswer * 1.4) * 10) / 10;
    turns.push({
      id: `s${i}`,
      role: "student",
      text,
      inputMode: "voice",
      at: (at += speakingSec * 1000),
      speakingSec,
      pauseCount: s.pausesPerAnswer,
      longestPauseSec: s.pausesPerAnswer ? 1.8 : 0,
      latencySec: 1.2,
    });
  });

  const { spoken, planted } = spokenReading(lesson, s.readShare, s.readErrors);
  const readingSec = Math.round((countWords(spoken) / 130) * 60);
  const reading = analyzeReadingAloud(lesson.passage, spoken, readingSec);
  const speech = computeSpeechMetrics(turns);

  const request: ReportRequest = {
    moduleId: lesson.id,
    goal: lesson.goal,
    level: lesson.level,
    ageBand: "13to17",
    turns: turns.map((t) => ({ role: t.role, text: t.text, inputMode: t.inputMode })),
    speech,
    readingAloud: reading ?? undefined,
    readingMode: "aloud",
    readingSec,
    passageWords: countWords(lesson.passage),
  };
  return { scenario: s, module: lesson, turns, reading, plantedMisreads: planted, request };
}

/** The questions the coach would have asked, in order: the module's own ladder. */
export function ladderQuestions(m: LearningModule): string[] {
  return [m.openingQuestion, ...m.followUpQuestions];
}
