// Shared shape for "capture one spoken answer", with two engines behind it:
//  - cloud:   Silero VAD finds speech segments, each sent to Sarvam speech-to-text (CloudTurnCapture)
//  - browser: the browser's own SpeechRecognition (TurnCapture), used when Sarvam is not configured
//            or as an automatic fallback.
import type { RecognitionFatal } from "./recognition";
import type { TimingSummary } from "./voice-timing";

export interface CaptureResult {
  text: string;
  /** Word-weighted recogniser confidence 0-1, or null when the engine gives none. */
  confidence: number | null;
  timing: TimingSummary;
}

export type CaptureFatal = RecognitionFatal | "cloud-stt" | "vad";

export interface TurnCaptureOptions {
  lang: string;
  onInterim: (text: string) => void;
  onFatal: (reason: CaptureFatal) => void;
  /** Optional 0-1 loudness or speech probability for a level indicator. */
  onLevel?: (level: number) => void;
  /** A short reply to "Are you done?" (yes, no, say more, end), not a part of the lesson. */
  reply?: boolean;
  /** An answer to a lesson question: the speech service keeps filler words ("umm", "haa") in the text, so they can be counted. */
  verbatim?: boolean;
}

export interface TurnCaptureLike {
  begin(): void;
  /** Text heard so far in this answer. */
  currentText(): string;
  hasText(): boolean;
  /** Milliseconds since the student last made a sound (or text last arrived). */
  idleMs(): number;
  /** True while a speech segment is still being transcribed. */
  isBusy(): boolean;
  end(): Promise<CaptureResult>;
  dispose(): void;
  readonly isActive: boolean;
}
