// Browser-only. Silero voice-activity detection (ONNX, WebAssembly) running on this device.
// It finds when the student starts and stops speaking; each speech segment can then be sent to
// speech-to-text. Audio is processed in memory only and is never saved.
import type { MicVAD } from "@ricky0123/vad-web";

/** Silence this long ends a speech segment, so gaps between segments are the app's "pauses". */
export const REDEMPTION_MS = 1000;
const CREATE_TIMEOUT_MS = 25_000;

const VAD_FILES = ["silero_vad_v5.onnx", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs", "vad.worklet.bundle.min.js"];
let prefetched = false;

/** Downloads the voice detector's files while the student is still on the set-up screen, so starting is quick. */
export function prefetchVadAssets(): void {
  if (prefetched || typeof window === "undefined") return;
  prefetched = true;
  for (const f of VAD_FILES) void fetch(`/vad/${f}`).catch(() => undefined);
}

export interface VadSegment {
  /** 16 kHz mono samples between -1 and 1. */
  audio: Float32Array;
  startMs: number;
  /** When speech actually stopped (performance.now() ms). */
  endMs: number;
}

export interface VadListener {
  onSpeechStart: () => void;
  onSegment: (segment: VadSegment) => void;
  /** 0-1 probability that the current audio frame is speech. */
  onLevel: (speechProbability: number) => void;
  /** Every audio frame (16 kHz mono, a copy that is safe to keep) with its speech probability. Used to show words while the student is still speaking. */
  onFrame?: (frame: Float32Array, speechProbability: number) => void;
  /** A sound that was too short to count as speech (under about 0.3 s) ended. It may still be a short word such as "yes". */
  onMisfire?: () => void;
}

export class VadUnavailableError extends Error {}

export class VadSession {
  private listener: VadListener | null = null;
  private speechStartedAt: number | null = null;
  private flushing = false;
  private running = false;

  private constructor(private readonly vad: MicVAD) {}

  /** Loads the model from /vad. Throws VadUnavailableError if it cannot start in time. */
  static async create(stream: MediaStream): Promise<VadSession> {
    const holder: { session?: VadSession } = {};
    let timedOut = false;

    const load = (async () => {
      const { MicVAD } = await import("@ricky0123/vad-web");
      const vad = await MicVAD.new({
        model: "v5",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        // Use the microphone stream the app already opened; never let the library stop its tracks.
        getStream: async () => stream,
        pauseStream: async () => undefined,
        resumeStream: async (s: MediaStream) => s,
        startOnLoad: false,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        redemptionMs: REDEMPTION_MS,
        preSpeechPadMs: 400,
        minSpeechMs: 300,
        submitUserSpeechOnPause: true,
        onSpeechStart: () => holder.session?.handleStart(),
        onSpeechEnd: (audio: Float32Array) => holder.session?.handleEnd(audio),
        onVADMisfire: () => holder.session?.handleMisfire(),
        onFrameProcessed: (probs: { isSpeech: number }, frame: Float32Array) => {
          const l = holder.session?.listener;
          if (!l) return;
          l.onLevel(probs.isSpeech);
          l.onFrame?.(frame.slice(), probs.isSpeech);
        },
      });
      if (timedOut) {
        void vad.destroy();
        throw new VadUnavailableError("Voice detection loaded too late");
      }
      const session = new VadSession(vad);
      holder.session = session;
      return session;
    })();

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => {
        timedOut = true;
        reject(new VadUnavailableError("Voice detection took too long to load"));
      }, CREATE_TIMEOUT_MS),
    );

    try {
      return await Promise.race([load, timeout]);
    } catch (err) {
      load.catch(() => undefined);
      throw err instanceof VadUnavailableError ? err : new VadUnavailableError(err instanceof Error ? err.message : "Voice detection failed");
    }
  }

  setListener(listener: VadListener | null): void {
    this.listener = listener;
  }

  /** Starts listening. If it is already listening (for example to hear an interruption), speech in progress is kept. */
  async start(): Promise<void> {
    this.flushing = false;
    if (this.running) return;
    this.speechStartedAt = null;
    this.running = true;
    await this.vad.start();
  }

  /** True while the student is speaking right now. */
  get isSpeaking(): boolean {
    return this.speechStartedAt !== null;
  }

  /** Stop listening. Speech in progress is flushed as a final segment first. */
  async pause(): Promise<void> {
    this.flushing = true;
    this.running = false;
    await this.vad.pause();
  }

  async destroy(): Promise<void> {
    this.listener = null;
    try {
      await this.vad.destroy();
    } catch {
      /* ignore */
    }
  }

  private handleStart() {
    this.speechStartedAt = performance.now();
    this.listener?.onSpeechStart();
  }

  private handleMisfire() {
    this.speechStartedAt = null;
    this.listener?.onMisfire?.();
  }

  private handleEnd(audio: Float32Array) {
    const now = performance.now();
    // The end event arrives REDEMPTION_MS after the last speech, unless we forced it by pausing.
    const endMs = this.flushing ? now : now - REDEMPTION_MS;
    const startMs = this.speechStartedAt ?? endMs - (audio.length / 16000) * 1000;
    this.speechStartedAt = null;
    this.listener?.onSegment({ audio, startMs, endMs: Math.max(startMs, endMs) });
  }
}
