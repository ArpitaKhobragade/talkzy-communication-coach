import { describe, expect, it } from "vitest";
import { buildBodyLanguageCoaching, nervousSigns } from "@/features/coach/body-language";
import type { VisionMetrics } from "@/features/session/types";
import { faceLookFromScores, summarizeFrames, type FaceLook, type FrameSample } from "@/features/vision/summarize";

const calm: VisionMetrics = {
  framesAnalyzed: 200, durationSec: 50, facePresentPct: 95, cameraFacingPct: 85, avgHeadYawDeg: 6, avgHeadPitchDeg: 5, shoulderTiltDeg: 2,
  uprightPct: 85, bodyVisiblePct: 90, handsVisiblePct: 30, movementIndex: 0.04, movementLevel: "moderate", facialMovementIndex: 0.02, facialMovementLevel: "moderate",
  smilePct: 5, tensePct: 5, worriedPct: 5, blinkPct: 6, oddFacePct: 0,
};
const vision = (over: Partial<VisionMetrics> = {}): VisionMetrics => ({ ...calm, ...over });
const topics = (v: VisionMetrics) => buildBodyLanguageCoaching(v).map((i) => i.topic);
const find = (v: VisionMetrics, topic: string) => buildBodyLanguageCoaching(v).find((i) => i.topic === topic);

describe("faceLookFromScores", () => {
  it("sees a smile, a tense face, a worried look, a blink and an odd face", () => {
    expect(faceLookFromScores({ mouthSmileLeft: 0.6, mouthSmileRight: 0.7 }).smile).toBe(true);
    expect(faceLookFromScores({ mouthSmileLeft: 0.1, mouthSmileRight: 0.1 }).smile).toBe(false);
    expect(faceLookFromScores({ browDownLeft: 0.6, browDownRight: 0.5 }).tense).toBe(true);
    expect(faceLookFromScores({ mouthFrownLeft: 0.5, mouthFrownRight: 0.5 }).tense).toBe(true);
    expect(faceLookFromScores({ mouthPressLeft: 0.7, mouthPressRight: 0.7 }).tense).toBe(true);
    expect(faceLookFromScores({ browInnerUp: 0.6 }).worried).toBe(true);
    expect(faceLookFromScores({ eyeWideLeft: 0.6, eyeWideRight: 0.6 }).worried).toBe(true);
    expect(faceLookFromScores({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.9 }).blink).toBe(true);
    expect(faceLookFromScores({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1 }).odd).toBe(true); // a wink
    expect(faceLookFromScores({ cheekPuff: 0.7 }).odd).toBe(true);
    expect(faceLookFromScores({ tongueOut: 0.6 }).odd).toBe(true);
  });

  it("calls a neutral face none of these", () => {
    const look = faceLookFromScores({ _neutral: 0.9, browDownLeft: 0.05, mouthSmileLeft: 0.05, eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1 });
    expect(Object.values(look)).toEqual([false, false, false, false, false]);
  });
});

describe("summarizeFrames: how the face looked", () => {
  const frame = (t: number, look: Partial<FaceLook>): FrameSample => ({
    t,
    face: true,
    yawDeg: 5,
    pitchDeg: 5,
    look: { smile: false, tense: false, worried: false, blink: false, odd: false, ...look },
  });

  it("gives the share of the time the face looked each way", () => {
    const frames = Array.from({ length: 40 }, (_, i) => frame(i * 250, { tense: i < 20, smile: i >= 30 }));
    const v = summarizeFrames(frames);
    expect(v.tensePct).toBe(50);
    expect(v.smilePct).toBe(25);
    expect(v.worriedPct).toBe(0);
  });

  it("gives nothing for the look when there are too few frames with a face", () => {
    const v = summarizeFrames(Array.from({ length: 6 }, (_, i) => frame(i * 250, { tense: true })));
    expect(v.tensePct).toBeNull();
  });

  it("gives nothing for the look when the model gave no expression scores", () => {
    const v = summarizeFrames(Array.from({ length: 30 }, (_, i): FrameSample => ({ t: i * 250, face: true, yawDeg: 5, pitchDeg: 5 })));
    expect(v.smilePct).toBeNull();
  });
});

describe("buildBodyLanguageCoaching: how you looked", () => {
  it("says the student looked nervous, why that matters and how to look calmer", () => {
    const v = vision({ worriedPct: 40, blinkPct: 20, movementLevel: "high" });
    expect(nervousSigns(v)).toHaveLength(3);
    const item = find(v, "You looked nervous")!;
    expect(item.kind).toBe("improve");
    expect(item.observation).toMatch(/looked a little nervous/);
    expect(item.observation).toMatch(/eyebrows were raised in a worried way/);
    expect(item.observation).toMatch(/blinked a lot/);
    expect(item.howTo).toMatch(/breathe in slowly/i);
    expect(item.why).toBeTruthy();
  });

  it("needs at least two signs, or a very worried face, before saying nervous", () => {
    expect(topics(vision({ blinkPct: 20 }))).not.toContain("You looked nervous");
    expect(topics(vision({ blinkPct: 20, worriedPct: 30 }))).toContain("You looked nervous");
    expect(topics(vision({ worriedPct: 50 }))).toContain("You looked nervous");
  });

  it("says the face looked tense or angry when the brows are down or the lips pressed a lot", () => {
    const item = find(vision({ tensePct: 55 }), "Your face looked tense")!;
    expect(item.observation).toMatch(/serious or angry/);
    expect(item.howTo).toMatch(/Relax your forehead/);
    expect(topics(vision({ tensePct: 10 }))).not.toContain("Your face looked tense");
  });

  it("says when the student made unusual faces", () => {
    const item = find(vision({ oddFacePct: 9 }), "Unusual faces")!;
    expect(item.observation).toMatch(/wink|tongue/);
    expect(item.howTo).toBeTruthy();
  });

  it("praises a relaxed, friendly look", () => {
    const item = find(vision({ smilePct: 35 }), "How you looked")!;
    expect(item.kind).toBe("good");
    expect(item.observation).toMatch(/relaxed and friendly/);
  });

  it("praises a calm look, and asks for more expression when the face stayed very still", () => {
    expect(find(vision(), "How you looked")?.observation).toMatch(/calm and steady/);
    const flat = find(vision({ facialMovementLevel: "low" }), "Your face showed little expression")!;
    expect(flat.kind).toBe("improve");
    expect(flat.howTo).toMatch(/Smile/);
  });

  it("is not told twice: a nervous face gets no 'calm' praise", () => {
    const t = topics(vision({ worriedPct: 50, smilePct: 5 }));
    expect(t).toContain("You looked nervous");
    expect(t).not.toContain("How you looked");
  });

  it("still praises a smile when the face also looked tense", () => {
    const items = buildBodyLanguageCoaching(vision({ tensePct: 50, smilePct: 25 }));
    expect(items.some((i) => i.topic === "Your smile")).toBe(true);
  });

  it("every fix says how to fix it, in plain words with no numbers", () => {
    const items = buildBodyLanguageCoaching(vision({ worriedPct: 50, blinkPct: 20, tensePct: 60, oddFacePct: 10, facePresentPct: 50, cameraFacingPct: 40, uprightPct: 30, movementLevel: "high" }));
    for (const i of items.filter((x) => x.kind === "improve")) expect((i.howTo ?? "").length).toBeGreaterThan(15);
    expect(items.map((i) => `${i.observation} ${i.why ?? ""} ${i.howTo ?? ""}`).join(" ")).not.toMatch(/\d/);
  });

  it("puts how you looked before where your head was", () => {
    const t = topics(vision({ worriedPct: 50 }));
    expect(t.indexOf("You looked nervous")).toBeLessThan(t.indexOf("Your face in the picture"));
  });
});
