// Browser-only wrapper around the Web Speech API's SpeechRecognition (Chrome, Edge, Safari).
// NOTE: in Chrome/Edge the audio may be sent to the browser vendor's speech service. The app
// tells students this before first use (see /privacy).

interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface RecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionInstance;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return getCtor() !== null;
}

export type RecognitionFatal = "not-allowed" | "no-device" | "network" | "unsupported" | "unknown";

export interface RecognizerHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string, confidence: number) => void;
  onFatal: (reason: RecognitionFatal) => void;
}

export class SpeechRecognizer {
  private rec: RecognitionInstance | null = null;
  private wantListening = false;
  private networkErrors = 0;

  constructor(
    private readonly lang: string,
    private readonly handlers: RecognizerHandlers,
  ) {}

  start(): void {
    const Ctor = getCtor();
    if (!Ctor) {
      this.handlers.onFatal("unsupported");
      return;
    }
    this.wantListening = true;
    this.networkErrors = 0;
    this.spawn(Ctor);
  }

  private spawn(Ctor: RecognitionCtor): void {
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alt = r[0];
        if (!alt) continue;
        if (r.isFinal) {
          this.networkErrors = 0;
          this.handlers.onFinal(alt.transcript.trim(), typeof alt.confidence === "number" ? alt.confidence : 1);
        } else {
          interim += alt.transcript;
        }
      }
      this.handlers.onInterim(interim.trim());
    };

    rec.onerror = (e) => {
      switch (e.error) {
        case "not-allowed":
        case "service-not-allowed":
          this.wantListening = false;
          this.handlers.onFatal("not-allowed");
          break;
        case "audio-capture":
          this.wantListening = false;
          this.handlers.onFatal("no-device");
          break;
        case "network":
          // The browser's speech service drops now and then. Retry several times before giving up.
          if (++this.networkErrors >= 5) {
            this.wantListening = false;
            this.handlers.onFatal("network");
          }
          break;
        default:
          // "no-speech" and "aborted" are normal; the end handler restarts if we still want to listen.
          break;
      }
    };

    rec.onend = () => {
      if (this.rec !== rec) return;
      if (this.wantListening) {
        // Back off a little after repeated network errors so a flaky connection can recover.
        const delay = 150 + this.networkErrors * 400;
        setTimeout(() => {
          if (this.wantListening && this.rec === rec) this.spawn(Ctor);
        }, delay);
      }
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      // Already started; ignore.
    }
  }

  /** Stop listening. Pending final results may still arrive shortly afterwards. */
  stop(): void {
    this.wantListening = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }

  abort(): void {
    this.wantListening = false;
    const r = this.rec;
    this.rec = null;
    try {
      r?.abort();
    } catch {
      /* ignore */
    }
  }
}
