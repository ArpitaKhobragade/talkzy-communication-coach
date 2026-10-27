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
  /** What the face looked like in this frame, from the face model's expression scores. */
  look?: FaceLook;
}

/** What one face looked like in one frame. These describe the face's shape, not a feeling. */
export interface FaceLook {
  smile: boolean;
  /** Eyebrows pulled down, mouth turned down or lips pressed hard: a tense, serious or angry-looking face. */
  tense: boolean;
  /** Eyebrows pulled up in the middle or eyes wide open: a worried look. */
  worried: boolean;
  /** Eyes closed in this frame (counted over many frames, so blinking a lot shows up). */
  blink: boolean;
  /** A wink, puffed cheeks or a tongue out. */
  odd: boolean;
}

/** Limits on the face model's 0 to 1 expression scores (documented in docs/ARCHITECTURE.md). */
export const LOOK_LIMITS = { smile: 0.35, browDown: 0.4, mouthFrown: 0.35, mouthPress: 0.5, browInnerUp: 0.4, eyeWide: 0.4, blink: 0.5, wink: 0.5, cheekPuff: 0.4, tongueOut: 0.3 };

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

/** Turns the face model's named expression scores (0 to 1) into a simple description of the face in one frame. */
export function faceLookFromScores(scores: Record<string, number>): FaceLook {
  const g = (name: string) => scores[name] ?? 0;
  const both = (name: string) => (g(`${name}Left`) + g(`${name}Right`)) / 2;
  const L = LOOK_LIMITS;
  return {
    smile: both("mouthSmile") >= L.smile,
    tense: both("browDown") >= L.browDown || both("mouthFrown") >= L.mouthFrown || both("mouthPress") >= L.mouthPress,
    worried: g("browInnerUp") >= L.browInnerUp || both("eyeWide") >= L.eyeWide,
    blink: both("eyeBlink") >= L.blink,
    odd: Math.abs(g("eyeBlinkLeft") - g("eyeBlinkRight")) >= L.wink || g("cheekPuff") >= L.cheekPuff || g("tongueOut") >= L.tongueOut,
  };
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

  const looks = faceFrames.map((f) => f.look).filter((l): l is FaceLook => !!l);
  const lookPct = (key: keyof FaceLook) => (looks.length >= 10 ? pct(looks.filter((l) => l[key]).length, looks.length) : null);

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
    smilePct: lookPct("smile"),
    tensePct: lookPct("tense"),
    worriedPct: lookPct("worried"),
    blinkPct: lookPct("blink"),
    oddFacePct: lookPct("odd"),
  };
}
