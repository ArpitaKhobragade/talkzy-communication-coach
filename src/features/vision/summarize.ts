import type { VisionMetrics } from "../session/types";

/** One analysed camera frame. All values are observations of visible geometry only. */
export interface FrameSample {
  t: number; // ms
  face: boolean;
  /** Absolute head turn / tilt in degrees (from the face model's rotation). */
  yawDeg?: number;
  pitchDeg?: number;
  /** Present only when both shoulders are in view. */
  shoulders?: { tiltDeg: number; headOffset: number } | null;
  handsVisible?: boolean;
  /** Upper-body keypoint displacement since the previous frame, in shoulder-widths. */
  bodyMotion?: number;
  /** Mean absolute change in facial feature activations since the previous frame. */
  faceMotion?: number;
}

/** Heuristic limits (documented in docs/ARCHITECTURE.md). They describe geometry, not feelings. */
export const FACING_LIMIT_DEG = 25;
export const UPRIGHT_TILT_LIMIT_DEG = 8;
export const UPRIGHT_OFFSET_LIMIT = 0.4;
const BODY_MOTION_LEVELS: [number, number] = [0.02, 0.07];
const FACE_MOTION_LEVELS: [number, number] = [0.01, 0.03];

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (num: number, den: number) => (den ? round((num / den) * 100) : 0);

function level(value: number | null, [low, high]: [number, number]): "low" | "moderate" | "high" | null {
  if (value === null) return null;
  return value < low ? "low" : value < high ? "moderate" : "high";
}

/** Head rotation from MediaPipe's 4x4 column-major facial transformation matrix. */
export function headPoseFromMatrix(data: ArrayLike<number>): { yawDeg: number; pitchDeg: number } {
  // Rotation matrix R[row][col]; columns are normalised because the matrix may carry scale.
  const col = (c: number) => {
    const v = [data[c * 4], data[c * 4 + 1], data[c * 4 + 2]];
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return v.map((x) => x / len);
  };
  const [c0, c1, c2] = [col(0), col(1), col(2)];
  void c0;
  void c1;
  const r02 = c2[0];
  const r12 = c2[1];
  const r22 = c2[2];
  const yaw = Math.atan2(r02, r22);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r12)));
  return { yawDeg: Math.abs((yaw * 180) / Math.PI), pitchDeg: Math.abs((pitch * 180) / Math.PI) };
}

export function summarizeFrames(frames: FrameSample[]): VisionMetrics {
  const n = frames.length;
  const faceFrames = frames.filter((f) => f.face);
  const bodyFrames = frames.filter((f) => f.shoulders);
  const handFrames = frames.filter((f) => f.handsVisible !== undefined);

  const facing = faceFrames.filter(
    (f) => f.yawDeg !== undefined && f.pitchDeg !== undefined && f.yawDeg <= FACING_LIMIT_DEG && f.pitchDeg <= FACING_LIMIT_DEG,
  );
  const withPose = faceFrames.filter((f) => f.yawDeg !== undefined && f.pitchDeg !== undefined);

  const upright = bodyFrames.filter(
    (f) => f.shoulders!.tiltDeg <= UPRIGHT_TILT_LIMIT_DEG && Math.abs(f.shoulders!.headOffset) <= UPRIGHT_OFFSET_LIMIT,
  );

  const bodyMotion = mean(frames.map((f) => f.bodyMotion).filter((x): x is number => typeof x === "number"));
  const faceMotion = mean(frames.map((f) => f.faceMotion).filter((x): x is number => typeof x === "number"));
  const tilt = mean(bodyFrames.map((f) => f.shoulders!.tiltDeg));
  const yaw = mean(withPose.map((f) => f.yawDeg!));
  const pitch = mean(withPose.map((f) => f.pitchDeg!));

  const first = frames[0]?.t ?? 0;
  const last = frames[n - 1]?.t ?? 0;

  return {
    framesAnalyzed: n,
    durationSec: round((last - first) / 1000),
    facePresentPct: pct(faceFrames.length, n),
    cameraFacingPct: withPose.length ? pct(facing.length, withPose.length) : null,
    avgHeadYawDeg: yaw === null ? null : round(yaw),
    avgHeadPitchDeg: pitch === null ? null : round(pitch),
    shoulderTiltDeg: tilt === null ? null : round(tilt),
    uprightPct: bodyFrames.length ? pct(upright.length, bodyFrames.length) : null,
    bodyVisiblePct: pct(bodyFrames.length, n),
    handsVisiblePct: handFrames.length ? pct(handFrames.filter((f) => f.handsVisible).length, handFrames.length) : null,
    movementIndex: bodyMotion === null ? null : round(bodyMotion, 3),
    movementLevel: level(bodyMotion, BODY_MOTION_LEVELS),
    facialMovementIndex: faceMotion === null ? null : round(faceMotion, 3),
    facialMovementLevel: level(faceMotion, FACE_MOTION_LEVELS),
  };
}
