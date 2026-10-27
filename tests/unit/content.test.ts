import { describe, expect, it } from "vitest";
import { FIELDS, GOALS, LEVELS } from "@/features/content/fields";
import { MODULES, findModule, getModule, modulesFor } from "@/features/content/modules";
import { countWords } from "@/features/speech/metrics";

const WORDS: Record<string, [number, number]> = {
  beginner: [60, 160],
  intermediate: [90, 200],
  advanced: [120, 260],
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("module library", () => {
  it("has one module for every subject, level and goal", () => {
    expect(MODULES).toHaveLength(FIELDS.length * LEVELS.length * GOALS.length);
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives each goal its own passage, so no two modules share a passage", () => {
    const passages = MODULES.map((m) => m.passage);
    expect(new Set(passages).size).toBe(passages.length);
  });

  it("shows a student the modules for their subject and goal at every level", () => {
    for (const f of FIELDS)
      for (const g of GOALS) {
        const list = modulesFor(f.id, g.id);
        expect(list.map((m) => m.level).sort()).toEqual(["advanced", "beginner", "intermediate"]);
      }
  });

  it("still opens sessions saved with the old subject-and-level id", () => {
    const old = getModule("engineering-beginner");
    expect(old?.field).toBe("engineering");
    expect(old?.level).toBe("beginner");
    expect(old?.goal).toBe("clarity");
  });

  it("finds a module by subject, level and goal", () => {
    expect(findModule("science", "advanced", "interview")?.id).toBe("science-advanced-interview");
  });
});

for (const f of FIELDS) {
  describe(`content: ${f.id}`, () => {
    const list = MODULES.filter((m) => m.field === f.id);

    it("has 15 modules (3 levels x 5 goals)", () => {
      expect(list).toHaveLength(15);
    });

    for (const m of list) {
      describe(m.id, () => {
        it("has a matching id, a title and a short summary", () => {
          expect(m.id).toBe(`${m.field}-${m.level}-${m.goal}`);
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

        it("keeps the questions in plain English, with no dashes used as punctuation", () => {
          const all = [m.title, m.summary, m.passage, m.openingQuestion, ...m.followUpQuestions, ...m.keyTerms].join(" ");
          expect(all).not.toMatch(/[—–]/);
          expect(all).not.toMatch(/[^\x20-\x7E\n‘’“”]/);
        });
      });
    }
  });
}
