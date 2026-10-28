// Browser-only. Browser-engine capture of ONE spoken answer: the browser's SpeechRecognition plus
// energy-based voice-activity timing. Used when cloud speech-to-text is not configured, or as an
// automatic fallback. Half-duplex: call begin() only after the coach has finished speaking.
import { AudioMeter } from "./audio-meter";
import type { CaptureResult, TurnCaptureLike, TurnCaptureOptions } from "./capture";
import { SpeechRecognizer } from "./recognition";
import { VoiceTimingTracker } from "./voice-timing";

export type { CaptureResult } from "./capture";

export interface BrowserCaptureOptions extends TurnCaptureOptions {
  stream: MediaStream;
}

const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean).length;

export class TurnCapture implements TurnCaptureLike {
  private meter: AudioMeter;
  private tracker = new VoiceTimingTracker(50);
  private recognizer: SpeechRecognizer | null = null;
  private finals: { text: string; confidence: number }[] = [];
  private interim = "";
  private lastTextAt = 0;
  private active = false;

  constructor(private readonly opts: BrowserCaptureOptions) {
    this.meter = new AudioMeter(opts.stream, 50);
  }

  begin(): void {
    this.finals = [];
    this.interim = "";
    this.active = true;
    const now = performance.now();
    this.lastTextAt = now;
    this.tracker.reset(now);

    this.meter.start((t, rms) => {
      this.tracker.push(t, rms);
      this.opts.onLevel?.(Math.min(1, rms * 8));
    });

    this.recognizer?.abort();
    this.recognizer = new SpeechRecognizer(this.opts.lang, {
      onInterim: (text) => {
        this.interim = text;
        if (text) this.lastTextAt = performance.now();
        this.opts.onInterim(this.currentText());
      },
      onFinal: (text, confidence) => {
        if (!text) return;
        this.finals.push({ text, confidence });
        this.interim = "";
        this.lastTextAt = performance.now();
        this.opts.onInterim(this.currentText());
      },
      onFatal: (reason) => this.opts.onFatal(reason),
    });
    this.recognizer.start();
  }

  /** Text heard so far in this answer (final + in-progress). */
  currentText(): string {
    return [...this.finals.map((f) => f.text), this.interim].filter(Boolean).join(" ").trim();
  }

  hasText(): boolean {
    return this.currentText().length > 0;
  }

  /** Milliseconds since the student last made a sound or the recogniser last produced text. */
  idleMs(): number {
    const now = performance.now();
    return Math.min(this.tracker.msSinceActivity(now), now - this.lastTextAt);
  }

  isBusy(): boolean {
    return false;
  }

  /** Stop listening and return the answer. Waits briefly for the recogniser's last result. */
  async end(): Promise<CaptureResult> {
    this.recognizer?.stop();
    // The recogniser may deliver a final result shortly after stop().
    const deadline = performance.now() + 1200;
    let lastLen = this.currentText().length;
    let stableSince = performance.now();
    while (performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const len = this.currentText().length;
      if (len !== lastLen) {
        lastLen = len;
        stableSince = performance.now();
      } else if (performance.now() - stableSince > 400) break;
    }
    this.active = false;
    this.meter.stop();
    this.recognizer?.abort();
    this.recognizer = null;

    const text = this.currentText();
    const totalWords = this.finals.reduce((n, f) => n + wordsOf(f.text), 0);
    const confidence = totalWords ? this.finals.reduce((s, f) => s + f.confidence * wordsOf(f.text), 0) / totalWords : null;
    return { text, confidence, timing: this.tracker.summary() };
  }

  get isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.active = false;
    this.recognizer?.abort();
    this.recognizer = null;
    this.meter.close();
  }
}
