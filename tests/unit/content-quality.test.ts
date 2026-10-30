import { describe, expect, it } from "vitest";
import { readability } from "../../evals/text-metrics";
import { ADULT_ONLY_FIELDS, FIELDS, GOALS } from "@/features/content/fields";
import { MODULES } from "@/features/content/modules";
import type { AgeGroup, Level } from "@/features/content/types";

/*
 * The quality rules for the module content. The same rules are written in plain words in
 * docs/CONTENT-GUIDE.md. They check what a computer can check (reading level, question shape, what each
 * goal needs). Whether the facts are true and the topics are good still needs a teacher to read them.
 */

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const paragraphs = (s: string) => s.split(/\n\n+/).filter(Boolean);

/** Flesch-Kincaid grade of the passage, by level. The three levels must also be clearly different from each other. */
const GRADE: Record<Level, [number, number]> = { beginner: [2, 6.5], intermediate: [6, 9.5], advanced: [9, 13.5] };
/** Average words per sentence in the passage. */
const SENTENCE: Record<Level, [number, number]> = { beginner: [6, 13], intermediate: [11, 18], advanced: [13, 24] };
/** The longest single sentence a student has to read out loud. */
const LONGEST: Record<Level, number> = { beginner: 20, intermediate: 27, advanced: 34 };

const REASON = /\b(why|how|would|imagine|compare|explain|convince|think|defend|teach|describe|agree|disagree|persuade|argue|should|opinion|choose|decide|best|story|whole|a time|what could|what might|difference|if you)\b/i;
const MEDIUM = /\b(why|how|tell me|example|describe|explain|what do you think|do you think|which|in your own words|in a sentence|use the word|mean|means|difference|compare|imagine|opinion|reason|what would|what could|keep going)\b/i;
const YES_NO_START = /^(do|does|did|is|are|was|were|can|could|will|would|have|has|should)\b/i;
const ASKS_FOR_REASON = /\b(why|because|explain|reason|reasons|example|how|give|tell|describe|imagine|convince|persuade)\b/i;

/** Topics and places that do not suit a school or college app, or that assume a Western setting. */
const NOT_SUITABLE = /\b(kill|killed|suicide|murder|rape|porn|sex|sexual|drunk|alcohol|cigarette|cigarettes|weapon|weapons|religion|religious|caste|election|elections|thanksgiving|fahrenheit|mph|prom)\b|\$/i;

const text = (m: (typeof MODULES)[number]) => [m.title, m.summary, m.passage, m.openingQuestion, ...m.followUpQuestions, ...m.keyTerms].join(" ");

const AGES: AgeGroup[] = ["under13", "13to17", "18plus"];
/** The management subjects are written for adults only; every other subject has all three age groups. */
const agesOf = (field: string): AgeGroup[] => (ADULT_ONLY_FIELDS.includes(field as never) ? ["18plus"] : AGES);
const ALL_AGE_FIELDS = FIELDS.filter((f) => !ADULT_ONLY_FIELDS.includes(f.id));

describe("content quality: the three levels are really different", () => {
  for (const f of FIELDS)
    for (const g of GOALS)
      for (const age of agesOf(f.id)) {
      it(`${f.id} / ${g.id} / ${age}: reading level and length go up from beginner to advanced`, () => {
        const [b, i, a] = (["beginner", "intermediate", "advanced"] as Level[]).map((l) => {
          const m = MODULES.find((x) => x.field === f.id && x.goal === g.id && x.level === l && x.age === age)!;
          return { ...readability(m.passage), n: words(m.passage) };
        });
        expect(b.grade, "beginner is easier than intermediate").toBeLessThan(i.grade);
        expect(i.grade, "intermediate is easier than advanced").toBeLessThan(a.grade);
        expect(b.n, "advanced is longer than beginner").toBeLessThan(a.n);
      });
    }
});

for (const m of MODULES) {
  describe(`content quality: ${m.id}`, () => {
    const r = readability(m.passage);

    it("reads at the right level for its difficulty", () => {
      const [gMin, gMax] = GRADE[m.level];
      expect(r.grade, `${m.id} reading grade ${r.grade}`).toBeGreaterThanOrEqual(gMin);
      expect(r.grade, `${m.id} reading grade ${r.grade}`).toBeLessThanOrEqual(gMax);
      const [sMin, sMax] = SENTENCE[m.level];
      expect(r.avgSentenceWords, `${m.id} average sentence ${r.avgSentenceWords} words`).toBeGreaterThanOrEqual(sMin);
      expect(r.avgSentenceWords, `${m.id} average sentence ${r.avgSentenceWords} words`).toBeLessThanOrEqual(sMax);
      expect(r.longestSentenceWords, `${m.id} longest sentence ${r.longestSentenceWords} words`).toBeLessThanOrEqual(LONGEST[m.level]);
    });

    it("has at least two paragraphs and a title that is not a copy of another", () => {
      expect(paragraphs(m.passage).length).toBeGreaterThanOrEqual(2);
      expect(MODULES.filter((x) => x.title === m.title)).toHaveLength(1);
    });

    it("suits Indian school and college students (no unsuitable topics, no Western-only details)", () => {
      expect(text(m)).not.toMatch(NOT_SUITABLE);
    });

    it("has a short opening question, then follow-ups that go from easy to hard", () => {
      const q = m.followUpQuestions;
      expect(words(m.openingQuestion), "opening question").toBeLessThanOrEqual(18);
      for (const x of [m.openingQuestion, ...q]) {
        expect(x.match(/\?/g)?.length ?? 0, `more than one question in: ${x}`).toBeLessThanOrEqual(1);
        expect(words(x), `too long: ${x}`).toBeLessThanOrEqual(30);
        expect(x[0], `starts with a capital: ${x}`).toBe(x[0].toUpperCase());
      }
      // Two easy, two medium, two hard.
      for (const x of q.slice(0, 2)) expect(words(x), `easy question too long: ${x}`).toBeLessThanOrEqual(22);
      for (const x of q.slice(2, 4)) expect(MEDIUM.test(x), `medium question should ask why, how or for an example: ${x}`).toBe(true);
      for (const x of q.slice(4)) {
        expect(REASON.test(x), `hard question should ask for a reason, a choice or an explanation: ${x}`).toBe(true);
        expect(words(x), `hard question is too short: ${x}`).toBeGreaterThanOrEqual(8);
      }
    });

    it("never asks a yes-or-no question without asking for a reason", () => {
      for (const x of [m.openingQuestion, ...m.followUpQuestions].slice(3)) {
        if (YES_NO_START.test(x)) expect(ASKS_FOR_REASON.test(x.replace(/^\w+/, "")), `yes/no question: ${x}`).toBe(true);
      }
    });

    it("does not start two follow-up questions in the same way", () => {
      const starts = m.followUpQuestions.map((x) => x.split(/\s+/).slice(0, 2).join(" ").toLowerCase());
      expect(new Set(starts).size, `repeated starts: ${starts.join(" | ")}`).toBe(starts.length);
    });
  });
}

/** What each goal needs from its questions, so the five goals really practise different things. */
describe("content quality: each goal practises something different", () => {
  const all = (m: (typeof MODULES)[number]) => [m.openingQuestion, ...m.followUpQuestions];
  const count = (m: (typeof MODULES)[number], re: RegExp) => all(m).filter((q) => re.test(q)).length;

  for (const m of MODULES) {
    it(`${m.id} fits the goal "${m.goal}"`, () => {
      switch (m.goal) {
        case "fluency":
          // Retelling in order: the student talks for longer, in a sequence.
          expect(count(m, /\b(tell me|retell|describe|story|what happens|from start|in order|step by step|first|then|keep going|whole)\b/i)).toBeGreaterThanOrEqual(3);
          break;
        case "clarity":
          // Point, reason, example.
          expect(count(m, /\b(explain|steps?|reasons?|example|because|in simple words|teach)\b/i)).toBeGreaterThanOrEqual(3);
          break;
        case "vocabulary": {
          // The key words are used, explained and compared, not just read.
          const withTerm = all(m).filter((q) => m.keyTerms.some((t) => q.toLowerCase().includes(t.toLowerCase()))).length;
          expect(withTerm, "questions that use a key word").toBeGreaterThanOrEqual(4);
          expect(count(m, /\b(in a sentence|mean|means|meaning|in your own words|use the word|use it|use these|new word)\b/i)).toBeGreaterThanOrEqual(2);
          break;
        }
        case "confidence":
          // Choose a side, give reasons, and answer someone who disagrees.
          expect(count(m, /\b(would you|do you agree|your opinion|which side|choose|defend|convince|persuade|should)\b/i)).toBeGreaterThanOrEqual(2);
          expect(count(m, /\b(disagree|disagrees|other side|someone who|friend|classmate|but what if|answer)\b/i)).toBeGreaterThanOrEqual(1);
          break;
        case "interview":
          // Real interview questions, said to "you".
          expect(count(m, /\b(you|your)\b/i)).toBeGreaterThanOrEqual(4);
          expect(count(m, /\b(yourself|strength|strengths|why should|why do you want|hire|choose you|a time when|how would you handle|what would you do|goals?)\b/i)).toBeGreaterThanOrEqual(2);
          break;
      }
    });
  }
});

/** Topics that are fine for older students but not for children under 13. */
const NOT_FOR_CHILDREN = /\b(salary|salaries|loan|loans|debt|credit card|mortgage|rent|boyfriend|girlfriend|dating|diet|calories|depressed|depression|anxiety|anxious|gamble|gambling|betting|tax|taxes|invest|investment|stocks?|shares?|unemployed|layoff|fired)\b/i;

describe("content quality: each age group has its own modules", () => {
  const bag = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  const similarity = (a: string, b: string) => {
    const x = bag(a);
    const y = bag(b);
    let both = 0;
    for (const w of x) if (y.has(w)) both++;
    return both / Math.max(1, x.size + y.size - both);
  };

  for (const f of ALL_AGE_FIELDS)
    for (const g of GOALS)
      for (const l of ["beginner", "intermediate", "advanced"] as Level[]) {
        it(`${f.id} / ${g.id} / ${l}: the three age groups are three different modules`, () => {
          const [kids, teens, adults] = AGES.map((a) => MODULES.find((m) => m.field === f.id && m.goal === g.id && m.level === l && m.age === a)!);
          for (const [a, b] of [[kids, teens], [teens, adults], [kids, adults]]) {
            expect(a.title, `${a.id} and ${b.id} share a title`).not.toBe(b.title);
            expect(a.openingQuestion).not.toBe(b.openingQuestion);
            expect(similarity(a.passage, b.passage), `${a.id} and ${b.id} are too alike`).toBeLessThan(0.4);
            const shared = a.followUpQuestions.filter((q) => b.followUpQuestions.includes(q));
            expect(shared, `${a.id} and ${b.id} share questions`).toEqual([]);
          }
        });
      }

  for (const m of MODULES.filter((x) => x.age === "under13"))
    it(`${m.id} suits children under 13`, () => {
      expect(text(m)).not.toMatch(NOT_FOR_CHILDREN);
    });
});
