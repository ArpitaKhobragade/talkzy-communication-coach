// Browser-only. Measures microphone loudness; nothing is recorded or stored.
export class AudioMeter {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buffer: Float32Array<ArrayBuffer>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(stream: MediaStream, private readonly frameMs = 50) {
    const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  /** Calls `onFrame(timeMs, rms)` every `frameMs` until `stop()`. */
  start(onFrame: (t: number, rms: number) => void): void {
    void this.ctx.resume();
    this.stop();
    this.timer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(this.buffer);
      let sum = 0;
      for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
      onFrame(performance.now(), Math.sqrt(sum / this.buffer.length));
    }, this.frameMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close(): void {
    this.stop();
    this.source.disconnect();
    void this.ctx.close();
  }
}
