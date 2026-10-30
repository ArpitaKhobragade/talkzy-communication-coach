import { PAUSE_THRESHOLD_SEC } from "./metrics";

export interface TimingSummary {
  /** Seconds from the first to the last detected speech (pauses inside it included). */
  speakingSec: number;
  pauseCount: number;
  longestPauseSec: number;
  /** Seconds from `reset()` to the first detected speech. Null if none was heard. */
  latencySec: number | null;
  heardSpeech: boolean;
}

const NOISE_WINDOW = 200; // frames kept for the noise-floor estimate (~10 s at 50 ms)
const MIN_THRESHOLD = 0.02;
const MAX_THRESHOLD = 0.1;

/**
 * Turns a stream of microphone loudness (RMS) samples into speech timing for one answer.
 * Voice activity is a simple energy gate over an adaptive noise floor, so results are
 * approximate: loud background noise can look like speech, very quiet speech can be missed.
 */
export class VoiceTimingTracker {
  private startT = 0;
  private firstT: number | null = null;
  private lastT: number | null = null;
  private streak = 0;
  private pauseCount = 0;
  private longestPauseMs = 0;
  private recent: number[] = [];

  constructor(private readonly frameMs = 50) {}

  /** Start timing a new answer at time `t` (ms). The noise-floor history is kept. */
  reset(t: number): void {
    this.startT = t;
    this.firstT = null;
    this.lastT = null;
    this.streak = 0;
    this.pauseCount = 0;
    this.longestPauseMs = 0;
  }

  threshold(): number {
    // Until enough quiet frames have been heard, use a fixed gate.
    if (this.recent.length < 20) return 0.03;
    const sorted = [...this.recent].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.5)];
    return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, floor * 3));
  }

  /** Feed one loudness sample. Returns whether the frame counted as speech. */
  push(t: number, rms: number): boolean {
    const voiced = rms > this.threshold();

    if (!voiced) {
      // Learn the noise floor only from non-speech frames, so speech never raises its own gate.
      this.recent.push(rms);
      if (this.recent.length > NOISE_WINDOW) this.recent.shift();
      this.streak = 0;
      return false;
    }
    this.streak++;
    if (this.streak < 2) return false; // ignore single-frame clicks

    if (this.firstT === null) {
      this.firstT = t - this.frameMs;
    } else if (this.lastT !== null) {
      const gap = t - this.lastT - this.frameMs;
      if (gap >= PAUSE_THRESHOLD_SEC * 1000) {
        this.pauseCount++;
        this.longestPauseMs = Math.max(this.longestPauseMs, gap);
      }
    }
    this.lastT = t;
    return true;
  }

  /** Milliseconds since speech was last detected (or since reset if none yet). */
  msSinceActivity(t: number): number {
    return t - (this.lastT ?? this.startT);
  }

  summary(): TimingSummary {
    if (this.firstT === null || this.lastT === null) {
      return { speakingSec: 0, pauseCount: 0, longestPauseSec: 0, latencySec: null, heardSpeech: false };
    }
    return {
      speakingSec: Math.round(((this.lastT - this.firstT) / 1000) * 10) / 10,
      pauseCount: this.pauseCount,
      longestPauseSec: Math.round((this.longestPauseMs / 1000) * 10) / 10,
      latencySec: Math.round(((this.firstT - this.startT) / 1000) * 10) / 10,
      heardSpeech: true,
    };
  }
}
