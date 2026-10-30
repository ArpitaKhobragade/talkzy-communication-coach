import { describe, expect, it } from "vitest";
import { answerHintsFor, ALL_ANSWER_HINTS } from "@/features/content/hints";
import { ADULT_ONLY_FIELDS, FIELDS, GOALS, LEVELS } from "@/features/content/fields";
import { MODULES, findModule, getModule, modulesFor } from "@/features/content/modules";
import type { AgeGroup } from "@/features/content/types";
import { countWords } from "@/features/speech/metrics";

const AGES: AgeGroup[] = ["under13", "13to17", "18plus"];
/** The management subjects are written for adults only; every other subject has all three age groups. */
const agesOf = (field: string): AgeGroup[] => (ADULT_ONLY_FIELDS.includes(field as never) ? ["18plus"] : AGES);

const WORDS: Record<string, [number, number]> = {
  beginner: [60, 160],
  intermediate: [90, 200],
  advanced: [120, 260],
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** First names the old story-style modules used for made-up people. The new modules have no named characters. */
const CHARACTER_NAMES = /\b(Imran|Sunil|Riya|Asha|Rohan|Meera|Arjun|Priya|Kabir|Anita|Ravi|Neha|Karan|Divya|Aman|Sana|Farhan|Isha|Nikhil|Pooja|Rahul|Ananya|Vikram|Tara|Zoya|Dev|Maya|Kiran|Ritu|Sameer|Mira|Ali|Omar|Leela|Gopal|Hari|Lata|Raj|Sita|Amit|Anil|Bhavna|Deepak|Esha|Gauri|Harsh|Jaya|Kavya|Lakshmi|Manoj|Nandini|Om|Pankaj|Radha|Seema|Tanvi|Uma|Varun|Yash)\b/;

describe("module library", () => {
  it("has one module for every subject, level, goal and age group", () => {
    expect(MODULES).toHaveLength(FIELDS.reduce((n, f) => n + LEVELS.length * GOALS.length * agesOf(f.id).length, 0));
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has hints only for modules that exist, and one set for every module", () => {
    expect(Object.keys(ALL_ANSWER_HINTS).sort()).toEqual(MODULES.map((m) => m.id).sort());
  });

  it("gives each module its own passage, so no two modules share a passage", () => {
    const passages = MODULES.map((m) => m.passage);
    expect(new Set(passages).size).toBe(passages.length);
  });

  it("shows a student the modules for their subject, goal and age group at every level", () => {
    for (const f of FIELDS)
      for (const g of GOALS)
        for (const a of agesOf(f.id)) {
          const list = modulesFor(f.id, g.id, a);
          expect(list.map((m) => m.level).sort(), `${f.id} ${g.id} ${a}`).toEqual(["advanced", "beginner", "intermediate"]);
          expect(list.every((m) => m.age === a)).toBe(true);
        }
  });

  it("gives a different set of modules to each age group", () => {
    const kids = modulesFor("science", "clarity", "under13").map((m) => m.title);
    const teens = modulesFor("science", "clarity", "13to17").map((m) => m.title);
    const adults = modulesFor("science", "clarity", "18plus").map((m) => m.title);
    expect(new Set([...kids, ...teens, ...adults]).size).toBe(9);
  });

  it("still opens sessions saved with the old ids (subject and level, or subject, level and goal)", () => {
    const old = getModule("engineering-beginner");
    expect(old?.field).toBe("engineering");
    expect(old?.level).toBe("beginner");
    expect(old?.goal).toBe("clarity");
    expect(old?.age).toBe("13to17");
    expect(getModule("science-advanced-interview")?.id).toBe("science-advanced-interview-13to17");
  });

  it("finds a module by subject, level, goal and age group", () => {
    expect(findModule("science", "advanced", "interview", "18plus")?.id).toBe("science-advanced-interview-18plus");
    expect(findModule("science", "advanced", "interview", "under13")?.id).toBe("science-advanced-interview-under13");
  });
});

for (const f of FIELDS) {
  describe(`content: ${f.id}`, () => {
    const list = MODULES.filter((m) => m.field === f.id);

    it("has a module for every age group, level and goal", () => {
      expect(list).toHaveLength(agesOf(f.id).length * 15);
    });

    for (const m of list) {
      describe(m.id, () => {
        it("has a matching id, a title and a short summary", () => {
          expect(m.id).toBe(`${m.field}-${m.level}-${m.goal}-${m.age}`);
          expect(words(m.title)).toBeGreaterThanOrEqual(2);
          expect(words(m.title)).toBeLessThanOrEqual(9);
          expect(words(m.summary)).toBeGreaterThanOrEqual(6);
          expect(words(m.summary)).toBeLessThanOrEqual(24);
        });

        it("has a passage of the right length for its level", () => {
          const n = countWords(m.passage);
          const [min, max] = WORDS[m.level];
          expect(n, `${m.id} has ${n} words`).toBeGreaterThanOrEqual(min);
          expect(n, `${m.id} has ${n} words`).toBeLessThanOrEqual(max);
          expect(m.passage.split(/\n\n+/).length).toBeLessThanOrEqual(3);
        });

        it("lists 5 or 6 key terms that really appear in the passage", () => {
          expect(m.keyTerms.length).toBeGreaterThanOrEqual(5);
          expect(m.keyTerms.length).toBeLessThanOrEqual(6);
          const text = m.passage.toLowerCase();
          for (const t of m.keyTerms) expect(text, `"${t}" is not in ${m.id}`).toContain(t.toLowerCase());
        });

        it("asks an opening question and exactly 6 follow-ups, with no repeats", () => {
          expect(m.openingQuestion.trim().length).toBeGreaterThan(15);
          expect(m.followUpQuestions).toHaveLength(6);
          const all = [m.openingQuestion, ...m.followUpQuestions].map((q) => q.trim().toLowerCase());
          expect(new Set(all).size).toBe(all.length);
          for (const q of all) {
            expect(words(q)).toBeLessThanOrEqual(34);
            expect(q).toMatch(/[?.]$/);
          }
        });

        it("has no named characters and seven answer hints, one for each question", () => {
          expect(m.passage + m.title, "a made-up character in the passage").not.toMatch(CHARACTER_NAMES);
          const hints = answerHintsFor(m.id);
          expect(hints, "answerHints").toHaveLength(7);
          for (const h of hints ?? []) {
            expect(words(h), `hint length: ${h}`).toBeGreaterThanOrEqual(8);
            expect(words(h), `hint length: ${h}`).toBeLessThanOrEqual(40);
          }
        });

        it("keeps the questions in plain English, with no dashes used as punctuation", () => {
          const all = [m.title, m.summary, m.passage, m.openingQuestion, ...m.followUpQuestions, ...m.keyTerms].join(" ");
          expect(all).not.toMatch(/[—–]/);
          expect(all).not.toMatch(/[^\x20-\x7E\n‘’“”]/);
        });
      });
    }
  });
}
