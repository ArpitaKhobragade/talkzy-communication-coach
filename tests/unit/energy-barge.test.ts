import { describe, expect, it } from "vitest";
import { InterruptDetector } from "@/features/speech/energy-barge";

const feed = (d: InterruptDetector, levels: number[]) => levels.map((l) => d.push(l));

describe("InterruptDetector: the student speaking over the coach", () => {
  const quietCoach = Array<number>(20).fill(0.02); // the first second: the coach's own voice reaching the microphone

  it("does not trigger on the coach's own voice", () => {
    const d = new InterruptDetector();
    expect(feed(d, [...quietCoach, ...Array<number>(60).fill(0.03)]).some(Boolean)).toBe(false);
  });

  it("does not trigger on a short click or cough", () => {
    const d = new InterruptDetector();
    expect(feed(d, [...quietCoach, 0.4, 0.4, 0.4, 0.02, 0.02, 0.02, 0.4, 0.02]).some(Boolean)).toBe(false);
  });

  it("triggers when the student speaks clearly for about half a second", () => {
    const d = new InterruptDetector();
    const out = feed(d, [...quietCoach, ...Array<number>(14).fill(0.2)]);
    expect(out.some(Boolean)).toBe(true);
    expect(out.indexOf(true)).toBeGreaterThanOrEqual(20 + 11);
  });

  it("learns a loud room: a loud coach needs a much louder student", () => {
    const d = new InterruptDetector();
    expect(feed(d, [...Array<number>(20).fill(0.15), ...Array<number>(30).fill(0.2)]).some(Boolean)).toBe(false);
    expect(feed(d, Array<number>(20).fill(0.5)).some(Boolean)).toBe(true);
  });

  it("never triggers in the first moments", () => {
    const d = new InterruptDetector();
    expect(feed(d, Array<number>(20).fill(0.9)).some(Boolean)).toBe(false);
  });
});
