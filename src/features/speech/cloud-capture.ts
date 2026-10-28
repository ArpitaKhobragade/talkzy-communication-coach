// Browser-only. Captures ONE spoken answer with Silero VAD + Sarvam speech-to-text.
// The words must show up while the student is still speaking, so three things work together:
//  1. While speech is going on, the audio heard so far is sent to Sarvam about once a second and the words are shown at once ("partial" words).
//  2. A long stretch of speech is cut at a natural pause every few seconds and each piece is transcribed on its own, so the
//     partial words never have to cover a whole minute of audio.
//  3. When the browser has its own recogniser (Chrome, Edge), its words are shown too, and the longer text wins.
// What is saved and measured is always the accurate transcript from Sarvam, never the partial words.
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
/**
 * Failed segments in a row, counted across turns: a new capture starts for every question, so a count kept
 * inside one capture would start again at zero after each "say that again" and trouble would never be reported.
 */
let failureStreak = 0;

/** One audio frame from the voice detector is 512 samples (32 ms). */
const FRAME_SEC = 512 / STT_SAMPLE_RATE;
/** Frames kept from just before speech starts, so the first word is not cut off (about 0.45 s). */
const PREROLL_FRAMES = 14;
/**
 * The first partial words are sent once this much speech has been heard, and then this often. The speech service allows only
 * 60 requests a minute for the whole account on the entry plan, so this is kept gentle, and it backs off when a request fails.
 */
const PARTIAL_FIRST_SEC = 0.6;
const PARTIAL_EVERY_MS = 1000;
const PARTIAL_TIMEOUT_MS = 8_000;
const PARTIAL_BACKOFF_MS = 1500;
const PARTIAL_BACKOFF_MAX_MS = 12_000;
/** The browser's own live words are working when they changed this recently. Then partial words are not requested at all. */
const LIVE_FRESH_MS = 2500;
/** A stretch of speech this long is cut at its quietest moment and the first part is transcribed on its own. */
const CHUNK_AT_SEC = 8;
/** The cut is never made earlier than this into the stretch. */
const CHUNK_MIN_SEC = 3.5;
/** A frame this quiet (speech probability) is a good place to cut. Without one, the cut waits until the stretch is this long. */
const CHUNK_QUIET = 0.55;
const CHUNK_FORCE_SEC = 13;

const wordsIn = (t: string) => (t ? t.split(/\s+/).filter(Boolean).length : 0);
const noDots = (t: string) => t.replace(/\s*\.\.\.$/, "");

function join(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

async function transcribe(audio: Float32Array, moduleId: string, reply: boolean, verbatim: boolean): Promise<string> {
  const texts: string[] = [];
  for (const piece of splitForStt(audio)) {
    if (piece.length < MIN_PIECE_SAMPLES) continue;
    const res = await fetch(`/api/voice/stt?module=${encodeURIComponent(moduleId)}${reply ? "&reply=1" : ""}${verbatim ? "&answer=1" : ""}`, {
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

/** The words of audio that is still being spoken. Failing is fine: it only affects what is shown for a moment. */
async function transcribePartial(audio: Float32Array, moduleId: string, reply: boolean): Promise<string> {
  const res = await fetch(`/api/voice/stt?module=${encodeURIComponent(moduleId)}${reply ? "&reply=1" : ""}&interim=1`, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: encodeWav16(audio),
    signal: AbortSignal.timeout(PARTIAL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`stt_${res.status}`);
  return (((await res.json()) as { text?: string }).text ?? "").trim();
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
  /** Audio of the speech going on right now, not yet sent for its accurate transcript. */
  private frames: Float32Array[] = [];
  private probs: number[] = [];
  private preroll: Float32Array[] = [];
  /** Changes whenever the audio buffer is reset, so partial words for old audio are dropped when they arrive. */
  private bufferVersion = 0;
  private partial = "";
  private partialBusy = false;
  private lastPartialAt = 0;
  private partialFailures = 0;
  private partialPausedUntil = 0;
  /** When the browser's own live words last changed. */
  private liveAt = 0;
  /** Part of this stretch of speech has already been sent as its own piece. */
  private chunked = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** What is on the screen now. It does not get shorter while words are still arriving, so the text never jumps back. */
  private shown = "";
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
    // Failures are not reset here: if the speech service failed on the last turn, one more failure is enough to say so.
    // A successful transcription resets the count.
    this.fatalRaised = false;
    this.liveFinals = [];
    this.liveInterim = "";
    this.frames = [];
    this.probs = [];
    this.preroll = [];
    this.bufferVersion++;
    this.partial = "";
    this.partialBusy = false;
    this.partialFailures = 0;
    this.partialPausedUntil = 0;
    this.liveAt = 0;
    this.chunked = false;
    this.shown = "";
    this.active = true;
    this.turnStart = performance.now();
    this.lastActivity = this.turnStart;
    // The student may already be talking (they interrupted the coach), so their words are kept from the start.
    this.speaking = this.vad.isSpeaking;

    this.vad.setListener({
      onSpeechStart: () => this.handleStart(),
      onSegment: (seg) => this.handleSegment(seg),
      onLevel: (p) => this.opts.onLevel?.(p),
      onFrame: (frame, p) => this.handleFrame(frame, p),
    });
    this.vad.start().catch(() => {
      this.active = false;
      this.opts.onFatal("vad");
    });
    this.startLive();
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), 250);
  }

  /** Live words from the browser's own recogniser, when it has one. Any problem here is ignored: it only affects the display. */
  private startLive() {
    this.live?.abort();
    this.live = null;
    if (!recognitionSupported()) return;
    const rec = new SpeechRecognizer(this.opts.lang, {
      onInterim: (text) => {
        this.liveInterim = text;
        if (text) this.liveAt = performance.now();
        this.emitInterim();
      },
      onFinal: (text) => {
        if (text) {
          this.liveFinals.push(text);
          this.liveAt = performance.now();
        }
        this.liveInterim = "";
        this.emitInterim();
      },
      onFatal: () => {
        // The browser's recogniser is unavailable or blocked. The partial words from Sarvam carry on without it.
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
   * What the student sees, as quickly as possible: the accurate words so far, then the partial words of what is being said now.
   * If the browser's live words are longer, those are shown instead. The text is never shortened while words are still arriving.
   */
  private displayText(): string {
    const done = this.currentText();
    let text = [done, this.partial].filter(Boolean).join(" ");
    const live = this.liveText();
    if (live && wordsIn(live) > wordsIn(text)) text = live;
    if ((this.speaking || this.pending > 0) && !text) return "...";
    if (this.speaking && !this.partial && !live && text) return `${text} ...`;
    return text;
  }

  private emitInterim() {
    if (!this.active) return;
    let text = this.displayText();
    const arriving = this.speaking || this.pending > 0 || this.partialBusy;
    if (arriving && wordsIn(noDots(text)) < wordsIn(noDots(this.shown))) text = this.shown;
    this.shown = text;
    this.opts.onInterim(text);
  }

  private handleStart() {
    this.speaking = true;
    this.lastActivity = performance.now();
    // The audio of this stretch of speech starts a little before the detector noticed it.
    this.frames = this.preroll;
    this.probs = this.frames.map(() => 1);
    this.preroll = [];
    this.partial = "";
    this.chunked = false;
    this.bufferVersion++;
    this.lastPartialAt = performance.now();
    this.emitInterim();
  }

  private handleFrame(frame: Float32Array, probability: number) {
    if (!this.active) return;
    if (this.speaking) {
      this.frames.push(frame);
      this.probs.push(probability);
    } else {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
  }

  /** Every quarter of a second: cut a long stretch of speech into a piece, or send the audio heard so far for partial words. */
  private tick() {
    if (!this.active || !this.speaking) return;
    const sec = this.frames.length * FRAME_SEC;
    if (sec >= CHUNK_AT_SEC && this.cutChunk(sec)) return;
    const now = performance.now();
    // The browser's own live words are free and instant, so while they are flowing nothing is asked of the speech service.
    const liveFlowing = now - this.liveAt < LIVE_FRESH_MS;
    if (!this.partialBusy && !liveFlowing && sec >= PARTIAL_FIRST_SEC && now - this.lastPartialAt >= PARTIAL_EVERY_MS && now >= this.partialPausedUntil) this.requestPartial();
  }

  /** Sends the first part of a long stretch of speech, cut where the voice is quietest, as its own piece. */
  private cutChunk(sec: number): boolean {
    const from = Math.floor(CHUNK_MIN_SEC / FRAME_SEC);
    let cut = -1;
    let quietest = 2;
    for (let i = from; i < this.frames.length - 1; i++) {
      if (this.probs[i] < quietest) {
        quietest = this.probs[i];
        cut = i;
      }
    }
    if (cut < 0 || (quietest > CHUNK_QUIET && sec < CHUNK_FORCE_SEC)) return false;
    const audio = join(this.frames.slice(0, cut + 1));
    this.frames = this.frames.slice(cut + 1);
    this.probs = this.probs.slice(cut + 1);
    this.chunked = true;
    this.partial = "";
    this.bufferVersion++;
    this.startPart(audio);
    return true;
  }

  private requestPartial() {
    const audio = join(this.frames);
    if (audio.length < MIN_PIECE_SAMPLES) return;
    const version = this.bufferVersion;
    this.partialBusy = true;
    this.lastPartialAt = performance.now();
    transcribePartial(audio, this.moduleId, !!this.opts.reply)
      .then((text) => {
        this.partialFailures = 0;
        if (this.active && version === this.bufferVersion && text) {
          this.partial = text;
          this.emitInterim();
        }
      })
      .catch(() => {
        // Too many requests or a hiccup: wait longer before the next one, so the final transcripts are never starved.
        this.partialFailures++;
        this.partialPausedUntil = performance.now() + Math.min(PARTIAL_BACKOFF_MAX_MS, PARTIAL_BACKOFF_MS * 2 ** this.partialFailures);
      })
      .finally(() => {
        this.partialBusy = false;
      });
  }

  private handleSegment(seg: VadSegment) {
    this.speaking = false;
    this.lastActivity = performance.now();
    this.spans.push({ startMs: seg.startMs, endMs: seg.endMs });

    // If part of this stretch was already sent as its own piece, only what is left is sent now.
    const audio = this.chunked ? join(this.frames) : seg.audio;
    this.frames = [];
    this.probs = [];
    this.chunked = false;
    this.partial = "";
    this.bufferVersion++;
    this.startPart(audio);
    this.emitInterim();
  }

  /** Sends one piece of audio for its accurate transcript. The text is added in order, whenever it arrives. */
  private startPart(audio: Float32Array) {
    const index = this.parts.length;
    this.parts.push("");
    this.pending++;

    const run = async () => {
      try {
        return await transcribe(audio, this.moduleId, !!this.opts.reply, !!this.opts.verbatim);
      } catch {
        return await transcribe(audio, this.moduleId, !!this.opts.reply, !!this.opts.verbatim); // one retry for a transient failure
      }
    };
    run()
      .then((text) => {
        this.parts[index] = text;
        this.failures = 0;
        failureStreak = 0;
      })
      .catch(() => {
        this.failures++;
        failureStreak++;
        if (failureStreak >= MAX_CONSECUTIVE_FAILURES && !this.fatalRaised) {
          this.fatalRaised = true;
          failureStreak = 0;
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

  /** The best words available when the accurate transcript has nothing: the browser's live words, or the partial words. */
  private fallbackText(): string {
    const live = this.liveText();
    return wordsIn(live) >= wordsIn(this.partial) ? live : this.partial;
  }

  hasText(): boolean {
    return this.currentText().length > 0 || this.fallbackText().length > 0;
  }

  idleMs(): number {
    return this.speaking ? 0 : performance.now() - this.lastActivity;
  }

  isBusy(): boolean {
    return this.pending > 0;
  }

  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
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
    this.stopTicker();
    const deadline = performance.now() + END_WAIT_MS;
    while (this.pending > 0 && performance.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    this.active = false;
    const text = this.currentText() || this.fallbackText();
    this.stopLive();
    return { text, confidence: null, timing: timingFromSpans(this.spans, this.turnStart) };
  }

  private stopLive() {
    this.live?.abort();
    this.live = null;
  }

  dispose(): void {
    this.active = false;
    this.stopTicker();
    this.stopLive();
    this.vad.setListener(null);
    void this.vad.pause().catch(() => undefined);
  }
}
