import { describe, expect, it } from "vitest";
import { pronunciationHelp, syllabify } from "@/features/speech/pronounce";

describe("syllabify", () => {
  it("splits common words into parts to say one at a time", () => {
    const cases: Record<string, string> = {
      password: "pass-word",
      explanation: "ex-pla-na-tion",
      instructions: "in-struc-tions",
      computer: "com-pu-ter",
      planet: "pla-net",
      water: "wa-ter",
      vapour: "va-pour",
      cloud: "cloud",
      make: "make",
      walked: "walked",
      important: "im-por-tant",
      customer: "cus-to-mer",
      whisper: "whis-per",
      master: "mas-ter",
    };
    for (const [word, parts] of Object.entries(cases)) expect(syllabify(word).join("-"), word).toBe(parts);
  });

  it("keeps short words whole and ignores punctuation", () => {
    expect(syllabify("sun")).toEqual(["sun"]);
    expect(syllabify("Rain,")).toEqual(["rain"]);
    expect(syllabify("")).toEqual([]);
  });
});

describe("pronunciationHelp", () => {
  it("says to sound the ending when the end of the word was dropped", () => {
    const h = pronunciationHelp("plants", "plant");
    expect(h.tip).toMatch(/ending "s"/);
    expect(pronunciationHelp("walked", "walk").tip).toMatch(/ending "ed"/);
  });

  it("gives the word in parts when it sounded like another word", () => {
    const h = pronunciationHelp("vapour", "paper");
    expect(h.parts).toBe("va-pour");
    expect(h.tip).toMatch(/each part slowly/);
  });

  it("always gives a part list and a tip", () => {
    for (const w of ["sun", "temperature", "environment", "photosynthesis"]) {
      const h = pronunciationHelp(w, "xyz");
      expect(h.parts.length).toBeGreaterThan(0);
      expect(h.tip.length).toBeGreaterThan(10);
    }
  });
});
