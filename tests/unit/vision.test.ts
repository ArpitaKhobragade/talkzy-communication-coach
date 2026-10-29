import { describe, expect, it } from "vitest";
import { headPoseFromMatrix, summarizeFrames, type FrameSample } from "@/features/vision/summarize";

/** Column-major 4x4 for a rotation of `yaw` about Y then `pitch` about X (degrees). */
function matrix(yawDeg: number, pitchDeg: number, scale = 1): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const Ry = [
    [Math.cos(y), 0, Math.sin(y)],
    [0, 1, 0],
    [-Math.sin(y), 0, Math.cos(y)],
  ];
  const Rx = [
    [1, 0, 0],
    [0, Math.cos(p), -Math.sin(p)],
    [0, Math.sin(p), Math.cos(p)],
  ];
  const R = Ry.map((row, i) => [0, 1, 2].map((j) => row.reduce((s, _, k) => s + Ry[i][k] * Rx[k][j], 0)));
  const out = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = R[r][c] * scale;
  out[15] = 1;
  return out;
}

describe("headPoseFromMatrix", () => {
  it("recovers yaw and pitch magnitudes, ignoring scale", () => {
    const a = headPoseFromMatrix(matrix(20, 10, 3));
    expect(a.yawDeg).toBeCloseTo(20, 0);
    expect(a.pitchDeg).toBeCloseTo(10, 0);
  });
  it("reports ~0 for a face looking straight ahead", () => {
    const a = headPoseFromMatrix(matrix(0, 0));
    expect(a.yawDeg).toBeCloseTo(0, 1);
    expect(a.pitchDeg).toBeCloseTo(0, 1);
  });
  it("is symmetric for left and right turns (absolute values)", () => {
    expect(headPoseFromMatrix(matrix(-30, 0)).yawDeg).toBeCloseTo(30, 0);
  });
});

const frame = (i: number, over: Partial<FrameSample> = {}): FrameSample => ({ t: i * 250, face: true, yawDeg: 5, pitchDeg: 5, ...over });

describe("summarizeFrames", () => {
  it("computes face presence, facing and posture percentages", () => {
    const frames: FrameSample[] = [
      ...Array.from({ length: 6 }, (_, i) => frame(i, { shoulders: { tiltDeg: 3, headOffset: 0.1 }, handsVisible: false })),
      ...Array.from({ length: 2 }, (_, i) => frame(6 + i, { yawDeg: 45, shoulders: { tiltDeg: 15, headOffset: 0.1 }, handsVisible: true })),
      ...Array.from({ length: 2 }, (_, i) => frame(8 + i, { face: false, yawDeg: undefined, pitchDeg: undefined })),
    ];
    const m = summarizeFrames(frames);
    expect(m.framesAnalyzed).toBe(10);
    expect(m.facePresentPct).toBe(80);
    expect(m.cameraFacingPct).toBe(75); // 6 of the 8 frames with a face are within 25 degrees
    expect(m.uprightPct).toBe(75); // 6 of 8 body frames have level shoulders
    expect(m.bodyVisiblePct).toBe(80);
    expect(m.handsVisiblePct).toBe(25); // hand data only exists for the 8 body frames
    expect(m.durationSec).toBe(2.3);
  });

  it("returns null for measures it could not observe instead of inventing numbers", () => {
    const m = summarizeFrames(Array.from({ length: 12 }, (_, i) => frame(i, { yawDeg: undefined, pitchDeg: undefined })));
    expect(m.cameraFacingPct).toBeNull();
    expect(m.uprightPct).toBeNull();
    expect(m.handsVisiblePct).toBeNull();
    expect(m.movementLevel).toBeNull();
    expect(m.facialMovementLevel).toBeNull();
  });

  it("classifies movement levels from the mean displacement", () => {
    const mk = (motion: number) => summarizeFrames(Array.from({ length: 12 }, (_, i) => frame(i, { bodyMotion: motion, faceMotion: motion })));
    expect(mk(0.005).movementLevel).toBe("low");
    expect(mk(0.04).movementLevel).toBe("moderate");
    expect(mk(0.2).movementLevel).toBe("high");
    expect(mk(0.005).facialMovementLevel).toBe("low");
    expect(mk(0.02).facialMovementLevel).toBe("moderate");
  });
});
