/*
 * Hearing the student speak over the coach, without the accurate voice detector. It listens to how loud the
 * microphone is. The coach's own voice from the speakers is learned first (the loudest it is in the first moments),
 * and only a clearly louder sound that lasts counts as the student speaking.
 */

export interface InterruptOptions {
  intervalMs: number;
  /** How long the coach's own sound is measured before anything can count as an interruption. */
  learnMs: number;
  /** Quieter than this is never speech. */
  minLevel: number;
  /** How many times louder than the coach's own sound the student must be. */
  factor: number;
  /** How long the louder sound must last. */
  holdMs: number;
}

export const INTERRUPT_DEFAULTS: InterruptOptions = { intervalMs: 50, learnMs: 1000, minLevel: 0.06, factor: 2.2, holdMs: 600 };

/** Takes the microphone level every `intervalMs`, and says when someone is clearly speaking. */
export class InterruptDetector {
  private baseline = 0;
  private seen = 0;
  private loud = 0;

  constructor(private readonly opts: InterruptOptions = INTERRUPT_DEFAULTS) {}

  push(level: number): boolean {
    this.seen += 1;
    if (this.seen * this.opts.intervalMs <= this.opts.learnMs) {
      this.baseline = Math.max(this.baseline, level);
      return false;
    }
    const limit = Math.max(this.opts.minLevel, this.baseline * this.opts.factor);
    this.loud = level > limit ? this.loud + 1 : 0;
    return this.loud * this.opts.intervalMs >= this.opts.holdMs;
  }
}

/** Starts watching the microphone. Returns a function that stops it. */
export function watchForInterruption(stream: MediaStream, onInterrupt: () => void, opts: InterruptOptions = INTERRUPT_DEFAULTS): () => void {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
  };
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return stop;
    ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const detector = new InterruptDetector(opts);
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      if (detector.push(Math.sqrt(sum / data.length))) {
        stop();
        onInterrupt();
      }
    }, opts.intervalMs);
  } catch {
    stop();
  }
  return stop;
}
