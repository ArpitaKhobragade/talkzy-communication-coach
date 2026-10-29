import { describe, expect, it } from "vitest";
import { cleanName, stripName } from "@/features/session/name";
import { ProfileSchema } from "@/features/session/types";

const base = {
  ageBand: "18plus",
  field: "science",
  level: "beginner",
  goal: "clarity",
  consent: { acceptedAt: 1, guardianConfirmed: false },
};

describe("names", () => {
  it("keeps ordinary names as they are", () => {
    expect(cleanName("Arpita")).toBe("Arpita");
    expect(cleanName("Mary Ann")).toBe("Mary Ann");
    expect(cleanName("O'Brien")).toBe("O'Brien");
    expect(cleanName("Anne-Marie")).toBe("Anne-Marie");
    expect(cleanName("Ravi_22")).toBe("Ravi_22");
    expect(cleanName("Zoë")).toBe("Zoë");
  });

  it("removes emojis wherever they are", () => {
    expect(cleanName("Arpita 😀")).toBe("Arpita");
    expect(cleanName("😀Arpita")).toBe("Arpita");
    expect(cleanName("Ar😀pi🔥ta")).toBe("Arpita");
    expect(cleanName("Riya ❤️")).toBe("Riya");
    expect(cleanName("Sam 👍🏽")).toBe("Sam");
    expect(cleanName("Lee 👨‍👩‍👧")).toBe("Lee");
    expect(cleanName("Kim 🇮🇳")).toBe("Kim");
    expect(cleanName("Ann 1️⃣")).toBe("Ann");
  });

  it("removes other symbols and returns an empty name when nothing is left", () => {
    expect(cleanName("Arpita <3 ★ @#")).toBe("Arpita 3");
    expect(cleanName("😀😀😀")).toBe("");
    expect(cleanName("   ")).toBe("");
  });

  it("keeps a trailing space while typing so a second name can follow", () => {
    expect(stripName("Mary ")).toBe("Mary ");
    expect(stripName("  Mary   Ann")).toBe("Mary Ann");
  });

  it("limits the name to 40 characters", () => {
    expect(cleanName("a".repeat(60))).toHaveLength(40);
  });

  it("cleans a saved profile when it is loaded, and rejects a name that is only emojis", () => {
    const ok = ProfileSchema.safeParse({ ...base, displayName: "Arpita 😀" });
    expect(ok.success && ok.data.displayName).toBe("Arpita");
    expect(ProfileSchema.safeParse({ ...base, displayName: "😀😀" }).success).toBe(false);
  });
});
