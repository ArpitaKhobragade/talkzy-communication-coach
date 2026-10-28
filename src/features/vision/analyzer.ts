// Browser-only. Runs MediaPipe face + pose models ON THIS DEVICE. Video frames are never
// uploaded, recorded or stored; only numeric summaries survive (see summarize.ts).
import type { FaceLandmarker, PoseLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { VisionMetrics } from "../session/types";
import { faceScoresFrom, headPoseFromMatrix, summarizeFrames, type FrameSample } from "./summarize";

const WASM_PATH = "/mediapipe/wasm";
const FACE_MODEL = "/models/face_landmarker.task";
const POSE_MODEL = "/models/pose_landmarker_lite.task";
const FRAME_INTERVAL_MS = 250; // ~4 analysed frames per second keeps CPU use modest
const MIN_VIS = 0.5;
const LOAD_TIMEOUT_MS = 30_000;

export interface VisionStatus {
  faceVisible: boolean;
  bodyVisible: boolean;
}

export class VisionUnavailableError extends Error {}

const inFrame = (p: NormalizedLandmark | undefined) =>
  !!p && (p.visibility ?? 1) >= MIN_VIS && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export class VisionAnalyzer {
  private frames: FrameSample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTs = 0;
  private prevBody: { x: number; y: number }[] | null = null;
  private prevBlend: number[] | null = null;

  private constructor(
    private readonly face: FaceLandmarker,
    private readonly pose: PoseLandmarker,
  ) {}

  /**
   * Loads the models. Throws VisionUnavailableError if assets or WebAssembly are unavailable, or
   * if loading takes too long, so a slow or odd device can never block the practice session.
   * The CPU delegate is used on purpose: at ~4 frames/second it is fast enough, and GPU delegate
   * creation can stall instead of failing on some machines.
   */
  static async create(): Promise<VisionAnalyzer> {
    let timedOut = false;
    const load = (async () => {
      const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      // Both models load at the same time, which is much quicker than one after the other.
      const [face, pose] = await Promise.all([
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        }),
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate: "CPU" },
          runningMode: "VIDEO",
          numPoses: 1,
        }),
      ]);
      const analyzer = new VisionAnalyzer(face, pose);
      if (timedOut) {
        analyzer.dispose(); // finished after we gave up: do not leak it
        throw new VisionUnavailableError("Vision models loaded too late");
      }
      return analyzer;
    })();

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => {
        timedOut = true;
        reject(new VisionUnavailableError("Vision models took too long to load"));
      }, LOAD_TIMEOUT_MS),
    );

    try {
      return await Promise.race([load, timeout]);
    } catch (err) {
      load.catch(() => undefined); // a late failure after the timeout is expected and harmless
      throw err instanceof VisionUnavailableError
        ? err
        : new VisionUnavailableError(err instanceof Error ? err.message : "Vision models could not be loaded");
    }
  }

  private static pending: Promise<VisionAnalyzer> | null = null;

  /** Starts loading the models early (when the student ticks the camera box), so they are ready when the session starts. */
  static preload(): void {
    if (this.pending) return;
    const p = this.create();
    this.pending = p;
    p.catch(() => {
      if (this.pending === p) this.pending = null;
    });
  }

  /** Uses the models loaded by preload() if there are any, otherwise loads them now. */
  static take(): Promise<VisionAnalyzer> {
    const p = this.pending;
    this.pending = null;
    return p ?? this.create();
  }

  /** Throws away models that were loaded early but never used (the student left or unticked the camera). */
  static discardPreload(): void {
    const p = this.pending;
    this.pending = null;
    p?.then((a) => a.dispose()).catch(() => undefined);
  }

  /** Start sampling frames from a playing <video>. `onStatus` drives the small live hint. */
  start(getVideo: () => HTMLVideoElement | null, onStatus?: (s: VisionStatus) => void): void {
    this.stop();
    this.timer = setInterval(() => {
      const video = getVideo();
      if (!video || document.hidden || video.readyState < 2 || video.videoWidth === 0) return;
      try {
        const sample = this.analyze(video);
        if (!sample) return;
        this.frames.push(sample);
        onStatus?.({ faceVisible: sample.face, bodyVisible: !!sample.shoulders });
      } catch {
        // A failed frame is skipped; analysis must never interrupt the conversation.
      }
    }, FRAME_INTERVAL_MS);
  }

  private analyze(video: HTMLVideoElement): FrameSample | null {
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const w = video.videoWidth;
    const h = video.videoHeight;

    const f = this.face.detectForVideo(video, ts);
    const p = this.pose.detectForVideo(video, ts);

    const sample: FrameSample = { t: ts, face: f.faceLandmarks.length > 0 };

    if (sample.face) {
      const matrix = f.facialTransformationMatrixes?.[0]?.data;
      if (matrix) {
        const pose = headPoseFromMatrix(matrix);
        sample.yawDeg = pose.yawDeg;
        sample.pitchDeg = pose.pitchDeg;
      }
      const blend = f.faceBlendshapes?.[0]?.categories;
      if (blend) {
        sample.scores = faceScoresFrom(Object.fromEntries(blend.map((c) => [c.categoryName, c.score])));
        // Ignore blinks and eye gaze; mouth opening is dominated by speaking but is kept in the average.
        const values = blend.filter((c) => !/^eye(Blink|Look)/.test(c.categoryName)).map((c) => c.score);
        if (this.prevBlend && this.prevBlend.length === values.length) {
          sample.faceMotion = values.reduce((s, v, i) => s + Math.abs(v - this.prevBlend![i]), 0) / values.length;
        }
        this.prevBlend = values;
      }
    } else {
      this.prevBlend = null;
    }

    const lm = p.landmarks[0];
    if (lm) {
      const nose = lm[0];
      const ls = lm[11];
      const rs = lm[12];
      const lw = lm[15];
      const rw = lm[16];
      sample.handsVisible = inFrame(lw) || inFrame(rw);

      if (inFrame(ls) && inFrame(rs)) {
        const dx = (ls.x - rs.x) * w;
        const dy = (ls.y - rs.y) * h;
        const width = Math.hypot(dx, dy) || 1;
        const tiltDeg = Math.abs((Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI);
        const midX = ((ls.x + rs.x) / 2) * w;
        const headOffset = inFrame(nose) ? (nose.x * w - midX) / width : 0;
        sample.shoulders = { tiltDeg, headOffset };

        const pts = [nose, ls, rs, lw, rw].map((q) => (inFrame(q) ? { x: q.x * w, y: q.y * h } : null));
        if (this.prevBody) {
          const diffs: number[] = [];
          pts.forEach((q, i) => {
            const prev = this.prevBody![i];
            if (q && prev) diffs.push(Math.hypot(q.x - prev.x, q.y - prev.y) / width);
          });
          if (diffs.length >= 3) sample.bodyMotion = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        }
        this.prevBody = pts.map((q) => q ?? { x: NaN, y: NaN });
      } else {
        this.prevBody = null;
      }
    } else {
      this.prevBody = null;
    }
    return sample;
  }

  /** Stop sampling and return numeric summaries, or null if too few frames were analysed. */
  stop(): VisionMetrics | null {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.frames.length >= 10 ? summarizeFrames(this.frames) : null;
  }

  dispose(): void {
    this.stop();
    this.frames = [];
    try {
      this.face.close();
      this.pose.close();
    } catch {
      /* ignore */
    }
  }
}
