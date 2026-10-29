import { describe, expect, it } from "vitest";
import { VoiceTimingTracker } from "@/features/speech/voice-timing";
import { chunkSpeech } from "@/features/speech/synthesis";

const FRAME = 50;
/** Feed `seconds` of audio at the given loudness, starting at time `t`. Returns the new time. */
function feed(tr: VoiceTimingTracker, t: number, seconds: number, rms: number): number {
  const n = Math.round((seconds * 1000) / FRAME);
  for (let i = 0; i < n; i++) {
    t += FRAME;
    tr.push(t, rms);
  }
  return t;
}

describe("VoiceTimingTracker", () => {
  it("measures speaking span, latency and a long pause", () => {
    const tr = new VoiceTimingTracker(FRAME);
    let t = feed(tr, 0, 2, 0.004); // ambient noise: also trains the noise floor
    tr.reset(t);
    t = feed(tr, t, 1.5, 0.004); // student thinks for 1.5 s
    t = feed(tr, t, 3, 0.15); // speaks 3 s
    t = feed(tr, t, 1.5, 0.004); // pauses 1.5 s
    t = feed(tr, t, 2, 0.15); // speaks 2 s
    const s = tr.summary();
    expect(s.heardSpeech).toBe(true);
    expect(s.latencySec).toBeGreaterThan(1.3);
    expect(s.latencySec).toBeLessThan(1.8);
    expect(s.pauseCount).toBe(1);
    expect(s.longestPauseSec).toBeGreaterThan(1.3);
    expect(s.speakingSec).toBeGreaterThan(6);
    expect(s.speakingSec).toBeLessThan(7.2);
  });

  it("does not count short gaps as pauses", () => {
    const tr = new VoiceTimingTracker(FRAME);
    let t = feed(tr, 0, 2, 0.004);
    tr.reset(t);
    t = feed(tr, t, 2, 0.15);
    t = feed(tr, t, 0.4, 0.004);
    t = feed(tr, t, 2, 0.15);
    expect(tr.summary().pauseCount).toBe(0);
  });

  it("reports no speech for a silent answer", () => {
    const tr = new VoiceTimingTracker(FRAME);
    let t = feed(tr, 0, 1, 0.004);
    tr.reset(t);
    t = feed(tr, t, 5, 0.004);
    expect(tr.summary()).toMatchObject({ heardSpeech: false, speakingSec: 0, latencySec: null });
    expect(tr.msSinceActivity(t)).toBeGreaterThan(4500);
  });

  it("still hears a student who starts speaking immediately (speech must not raise its own gate)", () => {
    const tr = new VoiceTimingTracker(FRAME);
    tr.reset(0);
    const t = feed(tr, 0, 4, 0.12);
    const s = tr.summary();
    expect(s.heardSpeech).toBe(true);
    expect(s.speakingSec).toBeGreaterThan(3.5);
    expect(tr.threshold()).toBe(0.03);
    expect(tr.msSinceActivity(t)).toBeLessThan(200);
  });

  it("ignores a single-frame click", () => {
    const tr = new VoiceTimingTracker(FRAME);
    let t = feed(tr, 0, 1.5, 0.004);
    tr.reset(t);
    t = feed(tr, t, 0.05, 0.3);
    t = feed(tr, t, 2, 0.004);
    expect(tr.summary().heardSpeech).toBe(false);
  });
});

describe("chunkSpeech", () => {
  it("splits into sentence groups and keeps all text", () => {
    const text =
      "Hello there. This is the first idea we want to talk about today in some detail. Here is a second idea that is a little longer than the first one was. And a final short one!";
    const chunks = chunkSpeech(text);
    expect(chunks.join(" ")).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunkSpeech("Hi. Yes.")).toEqual(["Hi. Yes."]);
  });
});
