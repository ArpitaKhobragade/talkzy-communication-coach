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
  /** What the face looked like in this frame, already decided (used when no raw scores are given). */
  look?: FaceLook;
  /** The face model's expression scores for this frame. They are smoothed and adjusted for the person's resting face when the session is summarised. */
  scores?: FaceScores;
}

/** The expression scores the report uses, each 0 to 1 (left and right sides averaged). */
export interface FaceScores {
  smile: number;
  browDown: number;
  mouthFrown: number;
  mouthPress: number;
  browInnerUp: number;
  eyeWide: number;
  blink: number;
  /** How different the two eyes are, so a wink is high and a normal blink is low. */
  wink: number;
  cheekPuff: number;
  tongueOut: number;
  /** Eyes looking down. */
  lookDown: number;
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
export const LOOK_LIMITS = { smile: 0.35, browDown: 0.4, mouthFrown: 0.35, mouthPress: 0.5, browInnerUp: 0.4, eyeWide: 0.4, blink: 0.5, wink: 0.5, cheekPuff: 0.4, tongueOut: 0.3, lookDown: 0.4 };

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

/** Picks the scores the report uses out of the face model's named expression scores. */
export function faceScoresFrom(raw: Record<string, number>): FaceScores {
  const g = (name: string) => raw[name] ?? 0;
  const both = (name: string) => (g(`${name}Left`) + g(`${name}Right`)) / 2;
  return {
    smile: both("mouthSmile"),
    browDown: both("browDown"),
    mouthFrown: both("mouthFrown"),
    mouthPress: both("mouthPress"),
    browInnerUp: g("browInnerUp"),
    eyeWide: both("eyeWide"),
    blink: both("eyeBlink"),
    wink: Math.abs(g("eyeBlinkLeft") - g("eyeBlinkRight")),
    cheekPuff: g("cheekPuff"),
    tongueOut: g("tongueOut"),
    lookDown: both("eyeLookDown"),
  };
}

/** Middle value of each small window, so one odd frame does not count as a look. */
function median3(xs: number[]): number[] {
  return xs.map((_, i) => {
    const w = [xs[Math.max(0, i - 1)], xs[i], xs[Math.min(xs.length - 1, i + 1)]].sort((a, b) => a - b);
    return w[1];
  });
}

/**
 * Takes away the person's resting face. Some faces have slightly lowered brows or a slight smile all the
 * time, which is not an expression. The quietest fifth of the session is the resting level, and only a
 * limited amount is taken off so a person who really is tense all the way through is still noticed.
 */
function adjustForRestingFace(xs: number[], cap: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const resting = Math.min(sorted[Math.floor(sorted.length * 0.2)] ?? 0, cap);
  return xs.map((x) => Math.max(0, x - resting));
}

/** Decides, for each frame, how the face looked, using the whole session to smooth and to find the resting face. */
export function looksFromScores(scores: FaceScores[]): { looks: FaceLook[]; lookDown: boolean[] } {
  const L = LOOK_LIMITS;
  const series = (pick: (s: FaceScores) => number, cap: number) => adjustForRestingFace(median3(scores.map(pick)), cap);
  const smile = series((s) => s.smile, 0.15);
  const browDown = series((s) => s.browDown, 0.2);
  const mouthFrown = series((s) => s.mouthFrown, 0.2);
  const mouthPress = series((s) => s.mouthPress, 0.2);
  const browInnerUp = series((s) => s.browInnerUp, 0.2);
  const eyeWide = series((s) => s.eyeWide, 0.2);
  const lookDown = median3(scores.map((s) => s.lookDown));
  // A wink, puffed cheeks or a tongue out must last two frames in a row to count.
  const oddRaw = scores.map((s) => s.wink >= L.wink || s.cheekPuff >= L.cheekPuff || s.tongueOut >= L.tongueOut);
  return {
    looks: scores.map((s, i) => ({
      smile: smile[i] >= L.smile,
      tense: browDown[i] >= L.browDown || mouthFrown[i] >= L.mouthFrown || mouthPress[i] >= L.mouthPress,
      worried: browInnerUp[i] >= L.browInnerUp || eyeWide[i] >= L.eyeWide,
      blink: s.blink >= L.blink,
      odd: oddRaw[i] && (oddRaw[i - 1] || oddRaw[i + 1] || false),
    })),
    lookDown: lookDown.map((x) => x >= LOOK_LIMITS.lookDown),
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

  // Raw expression scores are smoothed and adjusted for the person's resting face. Frames with a ready-made look are used as they are.
  const scored = faceFrames.filter((f): f is FrameSample & { scores: FaceScores } => !!f.scores);
  const fromScores = scored.length >= 10 ? looksFromScores(scored.map((f) => f.scores)) : null;
  const looks: FaceLook[] = fromScores ? fromScores.looks : faceFrames.map((f) => f.look).filter((l): l is FaceLook => !!l);
  const lookPct = (key: keyof FaceLook) => (looks.length >= 10 ? pct(looks.filter((l) => l[key]).length, looks.length) : null);
  const lookingDownPct = fromScores ? pct(fromScores.lookDown.filter(Boolean).length, fromScores.lookDown.length) : null;

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
    lookingDownPct,
  };
}
