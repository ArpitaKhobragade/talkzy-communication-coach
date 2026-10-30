import { describe, expect, it } from "vitest";
import { commandIntent, confirmIntent, endIntent, endsUnfinished, holdIntent, isContinuation, looksLikeQuestion, nextCommand, stripNextCommand } from "@/features/practice/intents";

describe("endIntent: the student asks to end the session", () => {
  it.each([
    "End the session",
    "I want to end the session.",
    "please end this session now",
    "Stop the session",
    "I want to stop",
    "let's finish the practice",
    "that's enough for today",
    "I'm done for today",
    "I am done with the session",
    "Give me my report",
    "show me my feedback",
    "I want to see my report",
    "quit the session",
    "end it",
  ])("%s", (text) => expect(endIntent(text)).toBe(true));

  it.each([
    "I think the session of the school was good",
    "In the end I liked the story because it was fun",
    "I want to end the day with a cricket match and then go home to read my favourite book for a while because it is calm",
    "yes",
    "",
    "The Sun warms the sea and the vapour rises",
  ])("is not an end request: %s", (text) => expect(endIntent(text)).toBe(false));
});

describe("confirmIntent: the reply to 'Are you done?' or 'Should we move to the next question?'", () => {
  it.each(["yes", "Yeah", "yes please", "sure", "okay", "I'm done", "that's all", "that is it", "next", "move on", "go ahead", "no problem, next question", "yes I am done"])("moves on: %s", (text) =>
    expect(confirmIntent(text)).toBe("yes"),
  );

  it.each(["no", "No, I want to say more", "not yet", "wait", "hold on", "I want to add something", "let me add one more thing", "one more thing", "yes I want to say more", "I have more"])(
    "wants to say more: %s",
    (text) => expect(confirmIntent(text)).toBe("more"),
  );

  it("an end request wins over everything", () => {
    expect(confirmIntent("I want to end the session")).toBe("end");
    expect(confirmIntent("no, end the session")).toBe("end");
  });

  it("a long reply is more of the answer", () => {
    const text = "because the water cycle starts when the sun warms the sea and the vapour rises";
    expect(confirmIntent(text)).toBe("other");
    expect(isContinuation(text)).toBe(true);
  });

  it("a short unclear reply is neither", () => {
    expect(confirmIntent("hmm")).toBe("other");
    expect(isContinuation("hmm")).toBe(false);
  });
});

describe("nextCommand: the student says 'next question' at the end of an answer", () => {
  it.each([
    "next question",
    "Next question please",
    "A brand is a promise and people trust it. Next question.",
    "I think that is all, move on",
    "that's all",
    "I am done",
    "I'm done speaking",
    "that is it",
    "go to the next question",
    "skip this question",
    "nothing more to say",
  ])("%s", (text) => expect(nextCommand(text)).toBe(true));

  it.each([
    "I want to tell you what happens next in the story because it matters",
    "The next question is hard for many people because it has many parts",
    "we are done with homework every day by six",
    "",
    "Brands matter because people trust them",
  ])("is not a command: %s", (text) => expect(nextCommand(text)).toBe(false));

  it("takes the command off the end and keeps the answer", () => {
    expect(stripNextCommand("A brand is a promise and people trust it. Next question.")).toBe("A brand is a promise and people trust it");
    expect(stripNextCommand("I like the bakery, that's all, move on")).toBe("I like the bakery");
    expect(stripNextCommand("next question")).toBe("");
    expect(stripNextCommand("Brands matter because people trust them")).toBe("Brands matter because people trust them");
  });
});

describe("commandIntent: asking the coach to repeat or give a hint", () => {
  it.each([["Can you repeat the question", "repeat"], ["say that again", "repeat"], ["pardon", "repeat"], ["repeat that please", "repeat"], ["give me a hint", "hint"], ["I need a hint", "hint"]] as const)("%s", (text, kind) =>
    expect(commandIntent(text)).toBe(kind),
  );
  it("does not treat an answer as a command", () => {
    expect(commandIntent("A brand is the promise a company makes again and again to its customers over time")).toBeNull();
    expect(commandIntent("I think it is a good idea")).toBeNull();
  });
});

describe("looksLikeQuestion: the student asks the coach something", () => {
  it.each([
    "What does value mean?",
    "what does the word value mean",
    "Why is the sky blue?",
    "Can you explain that again",
    "How do I say this word correctly",
    "Who invented the telephone",
    "I did not understand the question",
    "tell me what a brand is",
    "is it okay if I answer in a different way",
    "Do you like cricket?",
  ])("%s", (text) => expect(looksLikeQuestion(text)).toBe(true));

  it.each([
    "A brand is the promise a company makes to its customers every day",
    "Because it is cheaper and people trust it more than other shops",
    "I think what matters is that people can trust the shop",
    "",
  ])("is an answer: %s", (text) => expect(looksLikeQuestion(text)).toBe(false));
});

describe("holdIntent: the student asks for time", () => {
  it.each(["wait", "Hold on", "wait a minute", "let me think", "one second please", "give me a moment", "sorry wait", "just a minute", "Wait, let me think.", "hold on let me think about it"])("%s", (text) => {
    expect(holdIntent(text)).toBe(true);
    expect(commandIntent(text)).toBe("hold");
  });
  it("is not an answer or a longer sentence", () => {
    expect(holdIntent("I will wait for the bus every morning because it is cheaper")).toBe(false);
    expect(holdIntent("a brand is a promise")).toBe(false);
  });
});

describe("endsUnfinished: the student is still in the middle of a sentence", () => {
  it.each(["I like it because", "it is the most important and", "so basically the umm", "we went to the", "and then"])("%s", (text) => expect(endsUnfinished(text)).toBe(true));
  it.each(["I like it a lot.", "That is how it works", "It helps people trust shops", ""])("%s", (text) => expect(endsUnfinished(text)).toBe(false));
});

describe("more ways to ask for the question again", () => {
  it.each(["sorry what", "what was the question", "I did not hear", "how do I start"])("%s", (text) => expect(commandIntent(text)).not.toBeNull());
});
