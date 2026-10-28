// SERVER ONLY. Sarvam (speech-to-text) and Cartesia (text-to-speech) configuration and calls.
// Keys stay on the server; the browser only ever calls this app's own /api/voice/* routes.

const has = (name: string) => Boolean(process.env[name]?.trim());

export function sttConfigured(): boolean {
  return has("SARVAM_API_KEY");
}

/** Cartesia needs both a key and the voice ID the owner chose. */
export function cartesiaConfigured(): boolean {
  return has("CARTESIA_API_KEY") && has("CARTESIA_VOICE_ID");
}

/** A clear coach voice is available: Cartesia, or Sarvam's own voice when the Sarvam key is set. */
export function ttsConfigured(): boolean {
  return cartesiaConfigured() || sttConfigured();
}

const sarvamBase = () => (process.env.SARVAM_BASE_URL?.trim() || "https://api.sarvam.ai").replace(/\/$/, "");
const cartesiaBase = () => (process.env.CARTESIA_BASE_URL?.trim() || "https://api.cartesia.ai").replace(/\/$/, "");

export class VoiceUpstreamError extends Error {
  constructor(
    readonly service: "sarvam" | "cartesia",
    readonly status: number,
    /** What the service said, shortened (never contains the key). */
    readonly detail = "",
  ) {
    super(`${service}_http_${status}`);
  }
}

/** A plain sentence about why the voice service refused, for the owner. It never includes the key. */
export function voiceFailureHint(status: number, detail = ""): string {
  // Cartesia says how many credits are left: "requires approximately 148 credits but you have 19 remaining".
  const credits = /requires approximately (\d+) credits but you have (\d+) remaining/.exec(detail);
  if (credits) return `The voice credit is used up: ${credits[2]} credits are left, and one coach message needs about ${credits[1]}. Add credit or upgrade the Cartesia plan. The browser voice is used until then.`;
  if (status === 401 || status === 403) return "The voice service did not accept the API key. Check CARTESIA_API_KEY in the Vercel settings.";
  if (status === 402 || status === 429) return "The voice service has run out of credit, or is too busy. Check the Cartesia plan and usage.";
  if (status === 400 || status === 404 || status === 422) return "The voice service did not accept the voice or the model. Check CARTESIA_VOICE_ID and CARTESIA_MODEL.";
  if (status >= 500) return "The voice service had a problem on its side. Try again later.";
  return "The voice service did not answer in time.";
}

/**
 * Transcribe one speech segment (WAV, 16 kHz mono, under ~30 s) with Sarvam.
 * `keyterms` (domain words from the reading) help recognition; if Sarvam rejects the optional
 * field we retry once without it.
 */
export async function transcribeSegment(wav: ArrayBuffer, keyterms: string[], opts: { verbatim?: boolean; partial?: boolean } = {}): Promise<string> {
  // Word-for-word mode (saaras:v3) writes Indian-accented English in Hindi letters and spells "umm" as "U M M", so it is OFF.
  // The owner can turn it on with SARVAM_VERBATIM=on. Even then, if the text comes back in Hindi letters, the normal text is used.
  const verbatimOn = opts.verbatim === true && process.env.SARVAM_VERBATIM?.trim().toLowerCase() === "on";
  const language = process.env.SARVAM_LANGUAGE?.trim() || "en-IN";
  const call = async (withKeyterms: boolean, mode?: "verbatim" | "translit") => {
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
    form.append("language_code", language);
    if (mode) {
      form.append("model", "saaras:v3");
      form.append("mode", mode);
    } else {
      const model = process.env.SARVAM_STT_MODEL?.trim();
      if (model) form.append("model", model);
      if (withKeyterms && keyterms.length) form.append("keyterms", JSON.stringify(keyterms.slice(0, 50).map((t) => t.slice(0, 64))));
    }
    return fetch(`${sarvamBase()}/speech-to-text`, {
      method: "POST",
      // The note about the purpose is ignored by Sarvam. It lets the test stand-in tell words shown while speaking from the final text.
      headers: { "api-subscription-key": process.env.SARVAM_API_KEY ?? "", ...(opts.partial ? { "x-talkzy-purpose": "partial" } : {}) },
      body: form,
      signal: AbortSignal.timeout(opts.partial ? 8_000 : 20_000),
    });
  };
  const textOf = async (res: Response) => ((await res.json()) as { transcript?: string }).transcript?.trim() ?? "";

  let res = await call(true, verbatimOn ? "verbatim" : undefined);
  // "Too many requests": a real transcript waits a moment and asks once more. Live words are not worth waiting for.
  if (res.status === 429 && !opts.partial) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await call(true, verbatimOn ? "verbatim" : undefined);
  }
  if (verbatimOn && !res.ok) res = await call(true);
  if ((res.status === 400 || res.status === 422) && keyterms.length) res = await call(false);
  if (!res.ok) throw new VoiceUpstreamError("sarvam", res.status);
  let text = await textOf(res);

  // The student speaks English, so the words must be in English letters. If they came back in Hindi letters, ask again for
  // Roman letters; if that is not possible, return nothing rather than text the app cannot read.
  if (hasIndicScript(text)) {
    const again = await call(true, "translit").catch(() => null);
    text = again?.ok ? await textOf(again) : "";
    if (hasIndicScript(text)) text = "";
  }
  return text;
}

/** True when the text has letters from an Indian script (Devanagari and others), not English letters. */
export function hasIndicScript(text: string): boolean {
  return /[ऀ-෿]/.test(text);
}

/**
 * Speak `text` with Sarvam (bulbul). Used when Cartesia is not set up or has failed (no credit, too slow), so the coach still
 * has a clear voice. Returns MP3 bytes.
 */
export async function synthesizeSarvam(text: string, speed: number): Promise<ArrayBuffer> {
  const res = await fetch(`${sarvamBase()}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": process.env.SARVAM_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, 1200),
      language_code: "en-IN",
      model: "bulbul:v3",
      speaker: process.env.SARVAM_TTS_SPEAKER?.trim() || "priya",
      pace: Math.min(1.5, Math.max(0.6, speed)),
      output_audio_codec: "mp3",
      speech_sample_rate: 24000,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().then((t) => t.replace(/\s+/g, " ").slice(0, 200)).catch(() => "");
    console.error(`[voice/tts] sarvam answered ${res.status}: ${detail}`);
    throw new VoiceUpstreamError("sarvam", res.status, detail);
  }
  const data = (await res.json()) as { audios?: string[] };
  const b64 = data.audios?.[0];
  if (!b64) throw new VoiceUpstreamError("sarvam", 502, "empty audio");
  const bytes = Buffer.from(b64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Speak `text` with Cartesia. Returns the upstream response (MP3 audio stream). */
export async function synthesizeSpeech(text: string, speed: number): Promise<Response> {
  const res = await fetch(`${cartesiaBase()}/tts/bytes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
      "cartesia-version": process.env.CARTESIA_VERSION?.trim() || "2026-08-14",
    },
    body: JSON.stringify({
      model_id: process.env.CARTESIA_MODEL?.trim() || "sonic-3.6",
      transcript: text,
      voice: { id: process.env.CARTESIA_VOICE_ID },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
      generation_config: { speed, volume: 1 },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok || !res.body) {
    // Keep a short piece of the answer in the server log (never the key) so the reason can be found in Vercel.
    const detail = await res.text().then((t) => t.replace(/\s+/g, " ").slice(0, 200)).catch(() => "");
    console.error(`[voice/tts] cartesia answered ${res.status}: ${detail}`);
    throw new VoiceUpstreamError("cartesia", res.status, detail);
  }
  return res;
}

/**
 * When Cartesia has just failed (no credit, a wrong key, too slow), it is not asked again for a while, so each coach message
 * goes straight to the other voice and nothing waits for a service that is known to be down.
 */
let cartesiaDownUntil = 0;
const COOL_OFF_MS = 5 * 60_000;
const SHORT_COOL_OFF_MS = 45_000;

/** Forget that Cartesia failed (used by tests). */
export function resetVoiceCoolOff(): void {
  cartesiaDownUntil = 0;
}

/** Speaks the text with the best voice that works: Cartesia first, then Sarvam's own voice. Returns audio and the voice used. */
export async function speakWithBestVoice(
  text: string,
  speed: number,
  opts: { ignoreCoolOff?: boolean } = {},
): Promise<{ body: BodyInit; via: "cartesia" | "sarvam" }> {
  let lastError: unknown = null;
  if (cartesiaConfigured() && (opts.ignoreCoolOff || Date.now() >= cartesiaDownUntil)) {
    try {
      const upstream = await synthesizeSpeech(text, speed);
      return { body: upstream.body as ReadableStream, via: "cartesia" };
    } catch (err) {
      lastError = err;
      const status = err instanceof VoiceUpstreamError ? err.status : 0;
      cartesiaDownUntil = Date.now() + (status === 401 || status === 402 || status === 403 || status === 429 ? COOL_OFF_MS : SHORT_COOL_OFF_MS);
    }
  }
  if (sttConfigured()) {
    try {
      return { body: await synthesizeSarvam(text, speed), via: "sarvam" };
    } catch (err) {
      lastError ??= err;
    }
  }
  throw lastError ?? new VoiceUpstreamError("cartesia", 0);
}
