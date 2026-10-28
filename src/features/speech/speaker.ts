// Browser-only. Speaks the coach's words with the Cartesia voice (via our /api/voice/tts proxy),
// and falls back to the browser's own voice if the cloud voice fails for any reason.
import { chunkSpeech, speak as speakBrowser, type SpeakHandle } from "./synthesis";

export interface SpeakOptions {
  rate: number;
  lang: string;
  /** Use the Cartesia voice. When false, the browser voice is used directly. */
  cloud: boolean;
  /** Called once if the cloud voice failed and the browser voice took over. `reason` says why, in plain words, when the server knew. */
  onFallback?: (reason?: string) => void;
}

const CLOUD_CHUNK_CHARS = 300;
/** The first piece is short, so the voice starts sooner: the rest is made while the first piece plays. */
const FIRST_CHUNK_CHARS = 110;
const FETCH_TIMEOUT_MS = 6_000;
/** After the cloud voice fails, the browser voice is used straight away (no waiting) for this long. */
const COOL_OFF_MS = 5 * 60_000;

let cloudDownUntil = 0;
let lastReason: string | undefined;

/** True while the studio voice is known to be failing, so the browser voice is used at once. */
export function cloudVoiceDown(): boolean {
  return Date.now() < cloudDownUntil;
}

export function lastVoiceProblem(): string | undefined {
  return lastReason;
}

class TtsError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

async function fetchAudio(text: string, speed: number, signal: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, speed }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { hint?: string } | null;
    throw new TtsError(`tts_${res.status}`, body?.hint);
  }
  const blob = await res.blob();
  if (blob.size < 200) throw new TtsError("tts_empty");
  return blob;
}

export function speakCoach(text: string, opts: SpeakOptions): SpeakHandle {
  if (!opts.cloud || cloudVoiceDown()) return speakBrowser(text, { rate: opts.rate, lang: opts.lang });

  const ctrl = new AbortController();
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  let settleCurrent: (() => void) | null = null;
  let fallback: SpeakHandle | null = null;
  const urls: string[] = [];

  const speed = Math.min(1.5, Math.max(0.6, opts.rate));
  const small = chunkSpeech(text, FIRST_CHUNK_CHARS);
  const chunks = small.length > 1 ? [small[0], ...chunkSpeech(small.slice(1).join(" "), CLOUD_CHUNK_CHARS)] : small;
  // Request every chunk up front so the next one is ready when the current one ends.
  const downloads = chunks.map((c) =>
    fetchAudio(c, speed, ctrl.signal).catch((err: unknown) => {
      if (!ctrl.signal.aborted) lastReason = err instanceof TtsError ? err.hint : "The voice service did not answer in time.";
      return null;
    }),
  );

  /** Resolves true when the clip played to the end, false if playback could not start. */
  const play = (blob: Blob) =>
    new Promise<boolean>((resolve) => {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const a = new Audio(url);
      audio = a;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settleCurrent = null;
        resolve(ok);
      };
      settleCurrent = () => finish(true);
      timer = setTimeout(() => finish(true), 60_000);
      a.onloadedmetadata = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(true), ((Number.isFinite(a.duration) ? a.duration : 30) + 3) * 1000);
      };
      a.onended = () => finish(true);
      a.onerror = () => finish(false);
      a.play().catch(() => finish(false));
    });

  const done = (async () => {
    for (let i = 0; i < chunks.length; i++) {
      if (cancelled) return;
      const blob = await downloads[i];
      if (cancelled) return;
      const ok = blob ? await play(blob) : false;
      if (cancelled) return;
      if (!ok) {
        // Do not leave the student in silence: say the rest with the browser voice, and keep using it for a while.
        cloudDownUntil = Date.now() + COOL_OFF_MS;
        opts.onFallback?.(lastReason);
        fallback = speakBrowser(chunks.slice(i).join(" "), { rate: opts.rate, lang: opts.lang });
        await fallback.done;
        return;
      }
    }
  })().finally(() => {
    for (const u of urls) URL.revokeObjectURL(u);
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      ctrl.abort();
      audio?.pause();
      fallback?.cancel();
      settleCurrent?.();
    },
  };
}
