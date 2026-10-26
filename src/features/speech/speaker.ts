// Browser-only. Speaks the coach's words with the Cartesia voice (via our /api/voice/tts proxy),
// and falls back to the browser's own voice if the cloud voice fails for any reason.
import { chunkSpeech, speak as speakBrowser, type SpeakHandle } from "./synthesis";

export interface SpeakOptions {
  rate: number;
  lang: string;
  /** Use the Cartesia voice. When false, the browser voice is used directly. */
  cloud: boolean;
  /** Called once if the cloud voice failed and the browser voice took over. */
  onFallback?: () => void;
}

const CLOUD_CHUNK_CHARS = 300;
const FETCH_TIMEOUT_MS = 15_000;

async function fetchAudio(text: string, speed: number, signal: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, speed }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`tts_${res.status}`);
  const blob = await res.blob();
  if (blob.size < 200) throw new Error("tts_empty");
  return blob;
}

export function speakCoach(text: string, opts: SpeakOptions): SpeakHandle {
  if (!opts.cloud) return speakBrowser(text, { rate: opts.rate, lang: opts.lang });

  const ctrl = new AbortController();
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  let settleCurrent: (() => void) | null = null;
  let fallback: SpeakHandle | null = null;
  const urls: string[] = [];

  const speed = Math.min(1.5, Math.max(0.6, opts.rate));
  const chunks = chunkSpeech(text, CLOUD_CHUNK_CHARS);
  // Request every chunk up front so the next one is ready when the current one ends.
  const downloads = chunks.map((c) => fetchAudio(c, speed, ctrl.signal).catch(() => null));

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
        // Do not leave the student in silence: say the rest with the browser voice.
        opts.onFallback?.();
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
