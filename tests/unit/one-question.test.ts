import { describe, expect, it } from "vitest";
import { cleanClosing, keepOneQuestion } from "@/features/coach/one-question";

describe("keepOneQuestion", () => {
  it("keeps a reply with a single question as it is", () => {
    const t = "Nice answer about the tower. What happens after the message reaches it?";
    expect(keepOneQuestion(t)).toBe(t);
  });

  it("drops a second question", () => {
    expect(keepOneQuestion("Good point! Why do critics worry about embryos? And what would you do?")).toBe("Good point! Why do critics worry about embryos?");
  });

  it("keeps a closing sentence that is not a question", () => {
    const t = "Why is that important? Take your time.";
    expect(keepOneQuestion(t)).toBe(t);
  });

  it("leaves replies without a question alone and tidies spaces", () => {
    expect(keepOneQuestion("  Well done today.\n Your report is next.  ")).toBe("Well done today. Your report is next.");
  });
});

describe("keepOneQuestion: stray quote marks", () => {
  it("removes a closing quote at the start of the reply", () => {
    expect(keepOneQuestion("” Why do you think she chose a short reply?")).toBe("Why do you think she chose a short reply?");
  });
});

describe("cleanClosing", () => {
  it("leaves a goodbye without a question as it is", () => {
    expect(cleanClosing("  Okay, sure.   I will put your report together now. ")).toBe("Okay, sure. I will put your report together now.");
  });
  it("keeps only what comes after a question that was glued in front", () => {
    expect(cleanClosing("What would you add?Nice talking with you today. Your report is next.")).toBe("Nice talking with you today. Your report is next.");
  });
  it("keeps the text when nothing useful would be left after the question mark", () => {
    expect(cleanClosing("Thanks for the chat. Anything else?")).toBe("Thanks for the chat. Anything else?");
  });
});
