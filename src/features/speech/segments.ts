import { PAUSE_THRESHOLD_SEC } from "./metrics";
import type { TimingSummary } from "./voice-timing";

/** A stretch of continuous speech found by voice-activity detection. Times are performance.now() ms. */
export interface SpeechSpan {
  startMs: number;
  endMs: number;
}

/**
 * Speech timing for one answer from VAD spans. Silero merges gaps shorter than its "redemption"
 * time into one span, so any gap between two spans is at least that long (1 s here), which matches
 * the app's definition of a pause.
 */
export function timingFromSpans(spans: SpeechSpan[], turnStartMs: number): TimingSummary {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return { speakingSec: 0, pauseCount: 0, longestPauseSec: 0, latencySec: null, heardSpeech: false };

  let pauseCount = 0;
  let longest = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].startMs - sorted[i - 1].endMs) / 1000;
    if (gap >= PAUSE_THRESHOLD_SEC) {
      pauseCount++;
      longest = Math.max(longest, gap);
    }
  }
  const first = sorted[0].startMs;
  const last = sorted[sorted.length - 1].endMs;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    speakingSec: round(Math.max(0, (last - first) / 1000)),
    pauseCount,
    longestPauseSec: round(longest),
    latencySec: round(Math.max(0, (first - turnStartMs) / 1000)),
    heardSpeech: true,
  };
}

export const STT_SAMPLE_RATE = 16_000;
/** Sarvam's REST endpoint is meant for audio under 30 s; stay safely below it. */
export const MAX_STT_SECONDS = 25;

/** Split long audio into pieces of at most MAX_STT_SECONDS so each request is accepted. */
export function splitForStt(samples: Float32Array): Float32Array[] {
  const size = MAX_STT_SECONDS * STT_SAMPLE_RATE;
  if (samples.length <= size) return [samples];
  const out: Float32Array[] = [];
  for (let i = 0; i < samples.length; i += size) out.push(samples.subarray(i, Math.min(i + size, samples.length)));
  return out;
}

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav16(samples: Float32Array, sampleRate = STT_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
