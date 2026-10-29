import { describe, expect, it } from "vitest";
import { fillName, firstNameOf, maskName } from "@/features/coach/name-token";

describe("the student's name stays on the device", () => {
  it("takes the first word as the first name", () => {
    expect(firstNameOf("  Asha Verma ")).toBe("Asha");
    expect(firstNameOf("")).toBe("");
  });

  it("puts the first name in place of {name}", () => {
    expect(fillName("Hey {name}, nice to meet you. {name}, what did you think?", "Asha Verma")).toBe("Hey Asha, nice to meet you. Asha, what did you think?");
  });

  it("drops the placeholder cleanly when there is no name", () => {
    expect(fillName("Hi {name}! What did you think?", "")).toBe("Hi! What did you think?");
    expect(fillName("That is a good point, {name}. Why?", "  ")).toBe("That is a good point. Why?");
  });

  it("turns the first name back into {name} before the coach's words are sent anywhere", () => {
    expect(maskName("Hey Asha, nice to meet you. Asha, what did you think?", "Asha Verma")).toBe("Hey {name}, nice to meet you. {name}, what did you think?");
    // Only the whole word, so a longer word is left alone.
    expect(maskName("Ashanti is a name.", "Asha")).toBe("Ashanti is a name.");
    expect(maskName("Hello there", "")).toBe("Hello there");
  });

  it("does not break on names with special characters", () => {
    expect(() => maskName("Hi A.B., ok", "A.B.")).not.toThrow();
  });
});
