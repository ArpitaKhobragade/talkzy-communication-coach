import { describe, expect, it } from "vitest";
import { applyWordFixes, findWordMistakes } from "@/features/speech/word-mistakes";

const fix = (text: string) => findWordMistakes(text).map((m) => `${m.said} -> ${m.better}`);

describe("findWordMistakes: wrong words and forms", () => {
  it.each([
    ["I am agree with you", "I am agree -> I agree"],
    ["He don't like it", "He don't -> He doesn't"],
    ["it is more better than before", "more better -> better"],
    ["we discuss about the plan", "discuss about -> discuss"],
    ["please explain me the answer", "explain me -> explain to me"],
    ["I will revert back tomorrow", "revert back -> revert"],
    ["my cousin brother lives there", "cousin brother -> cousin"],
    ["I am having a doubt", "I am having a doubt -> I have a doubt"],
    ["I live here since 5 years", "since 5 years -> for 5 years"],
    ["she didn't went to school", "didn't went -> didn't go"],
    ["I am knowing him well", "I am knowing -> I know"],
    ["he go to school daily", "he go -> he goes"],
    ["she study at night", "she study -> she studies"],
    ["Myself Ravi, from Pune", "Myself Ravi -> My name is Ravi"],
    ["he is good in maths", "good in maths -> good at maths"],
    ["we need more informations", "informations -> information"],
    ["I have two years experience", "years experience -> years of experience"],
    ["you should to practise", "should to practise -> should practise"],
    ["I will give exam tomorrow", "I will give exam -> I will take exam"],
    ["I got a apple", "a apple -> an apple"],
  ])("%s", (text, expected) => expect(fix(text)).toContain(expected));

  it.each([
    "Does he have a pen",
    "What did she want to say",
    "I have a doubt about the question",
    "He goes to school every day",
    "I have lived here for five years",
    "a university has a library",
    "a few water bottles are on the table",
    "I got a umm good idea",
    "They are married to each other",
    "Why would he go there",
    "It does not matter",
    "I know the answer and I like it",
  ])("does not flag a correct sentence: %s", (text) => expect(findWordMistakes(text)).toEqual([]));

  it("gives a short reason for each mistake and no repeats", () => {
    const found = findWordMistakes("I am agree. I am agree. He don't know.");
    expect(found.map((f) => f.said)).toEqual(["I am agree", "He don't"]);
    for (const f of found) expect(f.why.length).toBeGreaterThan(10);
  });

  it("stops at the limit", () => {
    expect(findWordMistakes("I am agree. He don't know. peoples informations advices equipments furnitures homeworks", 3)).toHaveLength(3);
  });
});

describe("applyWordFixes", () => {
  it("puts every wrong word right and leaves the rest alone", () => {
    expect(applyWordFixes("I am agree that he don't know and it is more better")).toBe("I agree that he doesn't know and it is better");
    expect(applyWordFixes("This sentence is already fine.")).toBe("This sentence is already fine.");
  });
});
