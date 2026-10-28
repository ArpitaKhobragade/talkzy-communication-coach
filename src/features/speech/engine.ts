// Browser-only. Chooses which speech-to-text engine captures an answer.
import type { TurnCaptureLike, TurnCaptureOptions } from "./capture";
import { CloudTurnCapture } from "./cloud-capture";
import { recognitionSupported } from "./recognition";
import { TurnCapture } from "./turn-capture";
import type { VadSession } from "./vad-session";

export type EngineKind = "cloud" | "browser" | "none";

export interface VoiceInputs {
  /** The open microphone stream, or null when the mic is off. */
  stream: MediaStream | null;
  /** Silero VAD (loaded only when cloud speech-to-text is configured). */
  vad: VadSession | null;
}

/** Cloud (Sarvam) when it is ready, otherwise the browser's recogniser, otherwise none (typing only). */
export function pickEngine(inputs: VoiceInputs): EngineKind {
  if (inputs.stream && inputs.vad) return "cloud";
  if (inputs.stream && recognitionSupported()) return "browser";
  return "none";
}

/** The next-best engine after `kind` failed, or "none". */
export function fallbackEngine(kind: EngineKind, inputs: VoiceInputs): EngineKind {
  if (kind === "cloud" && inputs.stream && recognitionSupported()) return "browser";
  return "none";
}

export function createCapture(kind: EngineKind, inputs: VoiceInputs, moduleId: string, opts: TurnCaptureOptions): TurnCaptureLike | null {
  if (kind === "cloud" && inputs.vad) return new CloudTurnCapture(inputs.vad, moduleId, opts);
  if (kind === "browser" && inputs.stream) return new TurnCapture({ ...opts, stream: inputs.stream });
  return null;
}
