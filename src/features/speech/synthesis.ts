// Browser-only text-to-speech (Web Speech API). Runs locally in the browser.

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1200); // some browsers never fire the event
  });
}

/** Prefer a voice matching the chosen accent, then any English voice. */
export async function pickVoice(lang: string): Promise<SpeechSynthesisVoice | null> {
  if (!ttsSupported()) return null;
  const voices = await loadVoices();
  const exact = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase());
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = exact.length ? exact : english;
  // Prefer natural/online voices when the browser offers them.
  return pool.find((v) => /natural|neural|online|google/i.test(v.name)) ?? pool[0] ?? null;
}

/** Split into sentence-sized chunks; long utterances get cut off by some browsers. */
export function chunkSpeech(text: string, maxLen = 120): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const chunks: string[] = [];
  for (const p of parts) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + p.length < maxLen) chunks[chunks.length - 1] = `${last} ${p}`;
    else chunks.push(p);
  }
  return chunks;
}

// Keep a reference so the utterance is not garbage-collected before it ends (Chrome bug).
let activeUtterances: SpeechSynthesisUtterance[] = [];

export interface SpeakHandle {
  /** Resolves when speech has finished, been cancelled, or failed. Never rejects. */
  done: Promise<void>;
  cancel: () => void;
}

export function speak(text: string, opts: { rate: number; lang: string }): SpeakHandle {
  if (!ttsSupported()) return { done: Promise.resolve(), cancel: () => {} };

  const synth = window.speechSynthesis;
  synth.cancel();
  let cancelled = false;

  const done = (async () => {
    const voice = await pickVoice(opts.lang);
    for (const chunk of chunkSpeech(text)) {
      if (cancelled) return;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.rate = opts.rate;
        u.lang = voice?.lang ?? opts.lang;
        if (voice) u.voice = voice;
        activeUtterances.push(u);
        const finish = () => {
          clearTimeout(watchdog);
          activeUtterances = activeUtterances.filter((x) => x !== u);
          resolve();
        };
        // If the browser never reports the end, do not leave the conversation stuck.
        const watchdog = setTimeout(finish, 2500 + (chunk.length * 80) / Math.max(opts.rate, 0.5));
        u.onend = finish;
        u.onerror = finish;
        synth.speak(u);
      });
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      synth.cancel();
    },
  };
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}
