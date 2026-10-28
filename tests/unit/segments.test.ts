import { describe, expect, it } from "vitest";
import { encodeWav16, MAX_STT_SECONDS, splitForStt, STT_SAMPLE_RATE, timingFromSpans } from "@/features/speech/segments";
import { chunkSpeech } from "@/features/speech/synthesis";

describe("timingFromSpans", () => {
  it("measures speaking span, latency, and only gaps of 1 s or more as pauses", () => {
    const t = timingFromSpans(
      [
        { startMs: 3000, endMs: 8000 },
        { startMs: 9500, endMs: 14_000 }, // 1.5 s gap = a pause
        { startMs: 14_400, endMs: 20_000 }, // 0.4 s gap = not a pause
      ],
      1000,
    );
    expect(t.heardSpeech).toBe(true);
    expect(t.latencySec).toBe(2);
    expect(t.speakingSec).toBe(17);
    expect(t.pauseCount).toBe(1);
    expect(t.longestPauseSec).toBe(1.5);
  });

  it("is empty when nothing was heard", () => {
    expect(timingFromSpans([], 0)).toEqual({ speakingSec: 0, pauseCount: 0, longestPauseSec: 0, latencySec: null, heardSpeech: false });
  });

  it("does not depend on span order", () => {
    const a = timingFromSpans([{ startMs: 5000, endMs: 6000 }, { startMs: 1000, endMs: 2000 }], 0);
    expect(a.latencySec).toBe(1);
    expect(a.pauseCount).toBe(1);
  });
});

describe("encodeWav16", () => {
  it("writes a valid 16 kHz mono PCM header and clamps samples", () => {
    const wav = encodeWav16(new Float32Array([0, 0.5, -0.5, 2, -2]));
    const v = new DataView(wav);
    const ascii = (o: number, n: number) => String.fromCharCode(...new Uint8Array(wav, o, n));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(36, 4)).toBe("data");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(STT_SAMPLE_RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(10);
    expect(wav.byteLength).toBe(44 + 10);
    expect(v.getInt16(44 + 6, true)).toBe(32767); // clamped from 2
    expect(v.getInt16(44 + 8, true)).toBe(-32768); // clamped from -2
  });
});

describe("splitForStt", () => {
  it("keeps short audio whole and splits long audio under the 30 s limit", () => {
    expect(splitForStt(new Float32Array(10 * STT_SAMPLE_RATE))).toHaveLength(1);
    const pieces = splitForStt(new Float32Array(60 * STT_SAMPLE_RATE));
    expect(pieces).toHaveLength(3);
    for (const p of pieces) expect(p.length / STT_SAMPLE_RATE).toBeLessThanOrEqual(MAX_STT_SECONDS);
    expect(pieces.reduce((n, p) => n + p.length, 0)).toBe(60 * STT_SAMPLE_RATE);
  });
});

describe("chunkSpeech max length", () => {
  it("allows larger chunks for the cloud voice", () => {
    const text = "This is a sentence that is fairly long. ".repeat(5).trim();
    expect(chunkSpeech(text, 120).length).toBeGreaterThan(chunkSpeech(text, 400).length);
    expect(chunkSpeech(text, 400)).toHaveLength(1);
  });
});
