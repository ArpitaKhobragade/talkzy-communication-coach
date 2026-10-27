// Browser-only. Captures ONE spoken answer with Silero VAD + Sarvam speech-to-text.
// Sarvam is the accurate transcript but it only answers after a pause in speaking, so while the
// student is talking the words are shown live by the browser's own recogniser (when it has one).
// The live words are for display only: what is saved and measured always comes from Sarvam.
// Half-duplex: call begin() only after the coach has finished speaking.
import type { CaptureResult, TurnCaptureLike, TurnCaptureOptions } from "./capture";
import { SpeechRecognizer, recognitionSupported } from "./recognition";
import { encodeWav16, splitForStt, STT_SAMPLE_RATE, timingFromSpans, type SpeechSpan } from "./segments";
import type { VadSegment, VadSession } from "./vad-session";

const MIN_PIECE_SAMPLES = Math.round(0.3 * STT_SAMPLE_RATE);
const STT_TIMEOUT_MS = 20_000;
/** Give up on the flushed final segment after this long when ending an answer. */
const END_WAIT_MS = 15_000;
/** Two failed segments in a row means cloud recognition is not working right now. */
const MAX_CONSECUTIVE_FAILURES = 2;

async function transcribe(audio: Float32Array, moduleId: string): Promise<string> {
  const texts: string[] = [];
  for (const piece of splitForStt(audio)) {
    if (piece.length < MIN_PIECE_SAMPLES) continue;
    const res = await fetch(`/api/voice/stt?module=${encodeURIComponent(moduleId)}`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: encodeWav16(piece),
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`stt_${res.status}`);
    const data = (await res.json()) as { text?: string };
    if (data.text) texts.push(data.text.trim());
  }
  return texts.join(" ").trim();
}

export class CloudTurnCapture implements TurnCaptureLike {
  private spans: SpeechSpan[] = [];
  private parts: string[] = [];
  private pending = 0;
  private speaking = false;
  private lastActivity = 0;
  private turnStart = 0;
  private failures = 0;
  private fatalRaised = false;
  private live: SpeechRecognizer | null = null;
  private liveFinals: string[] = [];
  private liveInterim = "";
  active = false;

  constructor(
    private readonly vad: VadSession,
    private readonly moduleId: string,
    private readonly opts: TurnCaptureOptions,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  begin(): void {
    this.spans = [];
    this.parts = [];
    this.pending = 0;
    this.speaking = false;
    this.failures = 0;
    this.fatalRaised = false;
    this.liveFinals = [];
    this.liveInterim = "";
    this.active = true;
    this.turnStart = performance.now();
    this.lastActivity = this.turnStart;

    this.vad.setListener({
      onSpeechStart: () => {
        this.speaking = true;
        this.lastActivity = performance.now();
        this.emitInterim();
      },
      onSegment: (seg) => this.handleSegment(seg),
      onLevel: (p) => this.opts.onLevel?.(p),
    });
    this.vad.start().catch(() => {
      this.active = false;
      this.opts.onFatal("vad");
    });
    this.startLive();
  }

  /** Live words while the student is still speaking. Any problem here is ignored: it only affects the display. */
  private startLive() {
    this.live?.abort();
    this.live = null;
    if (!recognitionSupported()) return;
    const rec = new SpeechRecognizer(this.opts.lang, {
      onInterim: (text) => {
        this.liveInterim = text;
        this.emitInterim();
      },
      onFinal: (text) => {
        if (text) this.liveFinals.push(text);
        this.liveInterim = "";
        this.emitInterim();
      },
      onFatal: () => {
        // The browser's recogniser is unavailable or blocked. Cloud transcription carries on without live words.
        if (this.live === rec) this.live = null;
      },
    });
    this.live = rec;
    rec.start();
  }

  /** Everything the browser's recogniser has heard in this answer so far. */
  private liveText(): string {
    return [...this.liveFinals, this.liveInterim].filter(Boolean).join(" ").trim();
  }

  /**
   * What the student sees. While they are speaking, or while a part is still being transcribed, it is
   * the live words. Once the transcript is ready it is Sarvam's text.
   */
  private displayText(): string {
    const confirmed = this.currentText();
    const live = this.liveText();
    const talking = this.speaking || this.pending > 0;
    if (talking && live) return live;
    if (talking) return `${confirmed} ...`.trim(); // heard, not transcribed yet
    return confirmed || live;
  }

  private emitInterim() {
    if (!this.active) return;
    this.opts.onInterim(this.displayText());
  }

  private handleSegment(seg: VadSegment) {
    this.speaking = false;
    this.lastActivity = performance.now();
    this.spans.push({ startMs: seg.startMs, endMs: seg.endMs });

    const index = this.parts.length;
    this.parts.push("");
    this.pending++;
    this.emitInterim();

    const run = async () => {
      try {
        return await transcribe(seg.audio, this.moduleId);
      } catch {
        return await transcribe(seg.audio, this.moduleId); // one retry for a transient failure
      }
    };
    run()
      .then((text) => {
        this.parts[index] = text;
        this.failures = 0;
      })
      .catch(() => {
        this.failures++;
        if (this.failures >= MAX_CONSECUTIVE_FAILURES && !this.fatalRaised) {
          this.fatalRaised = true;
          this.opts.onFatal("cloud-stt");
        }
      })
      .finally(() => {
        this.pending--;
        this.lastActivity = performance.now();
        this.emitInterim();
      });
  }

  currentText(): string {
    return this.parts.filter(Boolean).join(" ").trim();
  }

  hasText(): boolean {
    if (this.currentText().length > 0) return true;
    // Cloud transcription failed for this answer, but the browser heard it.
    return this.failures > 0 && this.liveText().length > 0;
  }

  idleMs(): number {
    return this.speaking ? 0 : performance.now() - this.lastActivity;
  }

  isBusy(): boolean {
    return this.pending > 0;
  }

  async end(): Promise<CaptureResult> {
    try {
      await this.vad.pause(); // flushes speech that is still in progress
    } catch {
      /* ignore */
    }
    // The flushed segment can arrive just after pause() resolves, so keep listening briefly.
    await new Promise((r) => setTimeout(r, 200));
    this.vad.setListener(null);
    const deadline = performance.now() + END_WAIT_MS;
    while (this.pending > 0 && performance.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    this.active = false;
    this.stopLive();
    return { text: this.currentText() || (this.failures > 0 ? this.liveText() : ""), confidence: null, timing: timingFromSpans(this.spans, this.turnStart) };
  }

  private stopLive() {
    this.live?.abort();
    this.live = null;
  }

  dispose(): void {
    this.active = false;
    this.stopLive();
    this.vad.setListener(null);
    void this.vad.pause().catch(() => undefined);
  }
}
