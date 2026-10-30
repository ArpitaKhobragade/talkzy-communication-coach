// Browser-only. Speaks the coach's words with the Cartesia voice (via our /api/voice/tts proxy). That is the only voice:
// if it fails, the coach stays silent (the words are on the screen) and the student is told why. No second voice takes over.
// The browser's own voice is used only when no cloud voice is set up at all (`cloud` is false).
import { chunkSpeech, speak as speakBrowser, type SpeakHandle } from "./synthesis";

export interface SpeakOptions {
  rate: number;
  lang: string;
  /** Use the Cartesia voice. When false (no cloud voice is set up), the browser voice is used. */
  cloud: boolean;
  /** Called once if the cloud voice failed and the coach is silent. `reason` says why, in plain words, when the server knew. */
  onFallback?: (reason?: string) => void;
}

/** The later pieces are short too, so each one is made quickly while the one before it plays. */
const CLOUD_CHUNK_CHARS = 170;
/** The first piece is short (a few words), so the voice starts sooner: the rest is made while the first piece plays. */
const FIRST_CHUNK_CHARS = 70;
/** A longer first sentence is cut at a comma, so the first piece stays short. */
const FIRST_MAX_CHARS = 95;
/** Audio fetched ahead of time (the coach's opening, the goodbye, "Are you done?") is kept this long. */
const PREFETCH_TTL_MS = 30 * 60_000;
/** The server waits up to 8 s for Cartesia. */
const FETCH_TIMEOUT_MS = 10_000;
/** After the cloud voice fails, it is not asked again (the coach stays silent, with no waiting) for this long. */
const COOL_OFF_MS = 5 * 60_000;

let cloudDownUntil = 0;
let lastReason: string | undefined;

/** True while the coach's voice is known to be failing, so nothing waits for it. */
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

/** The pieces a message is spoken in: a short first piece (so the voice starts fast), then a few short ones. */
function planChunks(text: string): string[] {
  const small = chunkSpeech(text, FIRST_CHUNK_CHARS);
  let first = small[0] ?? "";
  let rest = small.slice(1).join(" ");
  if (first.length > FIRST_MAX_CHARS) {
    const cut = first.lastIndexOf(", ", FIRST_MAX_CHARS);
    if (cut > 25) {
      rest = `${first.slice(cut + 1).trim()} ${rest}`.trim();
      first = first.slice(0, cut + 1).trim();
    }
  }
  return [first, ...(rest ? chunkSpeech(rest, CLOUD_CHUNK_CHARS) : [])].filter(Boolean);
}

/** Starts making the audio for every piece at once, so the next piece is ready when the one before it ends. */
function startDownloads(chunks: string[], speed: number, signal: AbortSignal): Promise<Blob | null>[] {
  return chunks.map((c) =>
    fetchAudio(c, speed, signal).catch((err: unknown) => {
      if (!signal.aborted) lastReason = err instanceof TtsError ? err.hint : "The voice service did not answer in time.";
      return null;
    }),
  );
}

const speedOf = (rate: number) => Math.min(1.5, Math.max(0.6, rate));
const prefetched = new Map<string, { at: number; chunks: string[]; downloads: Promise<Blob | null>[] }>();

/**
 * Makes the audio for a message before it is needed (the coach's opening, while the student is still reading), so that it
 * starts the moment the conversation does. `speakCoach` with the same text uses it.
 */
export function prefetchSpeech(text: string, opts: { rate: number; cloud: boolean }): void {
  if (!opts.cloud || cloudVoiceDown() || typeof window === "undefined") return;
  const speed = speedOf(opts.rate);
  const key = `${speed}|${text}`;
  const old = prefetched.get(key);
  if (old && Date.now() - old.at < PREFETCH_TTL_MS) return;
  const chunks = planChunks(text);
  const downloads = startDownloads(chunks, speed, new AbortController().signal);
  prefetched.set(key, { at: Date.now(), chunks, downloads });
  // A piece that could not be made is not kept: it would be read with another voice. It is asked for again when it is needed.
  void Promise.all(downloads).then((done) => {
    if (done.some((b) => !b) && prefetched.get(key)?.downloads === downloads) prefetched.delete(key);
  });
}

export function speakCoach(text: string, opts: SpeakOptions): SpeakHandle {
  if (!opts.cloud) return speakBrowser(text, { rate: opts.rate, lang: opts.lang });
  // The coach's voice is known to be down: stay silent at once, no other voice takes over.
  if (cloudVoiceDown()) return { done: Promise.resolve(), cancel: () => undefined };

  const ctrl = new AbortController();
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  let settleCurrent: (() => void) | null = null;
  const urls: string[] = [];

  const speed = speedOf(opts.rate);
  const key = `${speed}|${text}`;
  const ready = prefetched.get(key);
  prefetched.delete(key);
  const fresh = ready && Date.now() - ready.at < PREFETCH_TTL_MS ? ready : null;
  const chunks = fresh?.chunks ?? planChunks(text);
  // Every piece is requested up front (or was, ahead of time), so the next one is ready when the current one ends.
  const downloads = fresh?.downloads ?? startDownloads(chunks, speed, ctrl.signal);

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
      let blob = await downloads[i];
      // A piece made ahead of time that failed is asked for once more, so the voice does not change for one line.
      if (!blob && fresh && !cancelled) blob = await fetchAudio(chunks[i], speed, ctrl.signal).catch(() => null);
      if (cancelled) return;
      const ok = blob ? await play(blob) : false;
      if (cancelled) return;
      if (!ok) {
        // The coach's voice did not work: say so once, and stay silent (no other voice) for a while. The words are on the screen.
        cloudDownUntil = Date.now() + COOL_OFF_MS;
        opts.onFallback?.(lastReason);
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
      settleCurrent?.();
    },
  };
}
