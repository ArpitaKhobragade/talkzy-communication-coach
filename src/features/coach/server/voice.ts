// SERVER ONLY. Sarvam (speech-to-text) and Cartesia (text-to-speech) configuration and calls.
// Keys stay on the server; the browser only ever calls this app's own /api/voice/* routes.

const has = (name: string) => Boolean(process.env[name]?.trim());

export function sttConfigured(): boolean {
  return has("SARVAM_API_KEY");
}

/** Cartesia needs both a key and the voice ID the owner chose. */
export function ttsConfigured(): boolean {
  return has("CARTESIA_API_KEY") && has("CARTESIA_VOICE_ID");
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
export async function transcribeSegment(wav: ArrayBuffer, keyterms: string[], opts: { verbatim?: boolean } = {}): Promise<string> {
  // Word-for-word text (with "umm" and "haa") is only offered by the saaras:v3 model in verbatim mode, which has no key terms.
  // SARVAM_VERBATIM=off turns it off. If the service refuses it, the normal text is used instead.
  const verbatimOn = opts.verbatim === true && process.env.SARVAM_VERBATIM?.trim().toLowerCase() !== "off";
  const call = async (withKeyterms: boolean, verbatim = false) => {
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
    form.append("language_code", process.env.SARVAM_LANGUAGE?.trim() || "en-IN");
    if (verbatim) {
      form.append("model", "saaras:v3");
      form.append("mode", "verbatim");
    } else {
      const model = process.env.SARVAM_STT_MODEL?.trim();
      if (model) form.append("model", model);
      if (withKeyterms && keyterms.length) form.append("keyterms", JSON.stringify(keyterms.slice(0, 50).map((t) => t.slice(0, 64))));
    }
    return fetch(`${sarvamBase()}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": process.env.SARVAM_API_KEY ?? "" },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  };

  let res = await call(true, verbatimOn);
  if (verbatimOn && !res.ok) res = await call(true, false);
  if ((res.status === 400 || res.status === 422) && keyterms.length) res = await call(false);
  if (!res.ok) throw new VoiceUpstreamError("sarvam", res.status);
  const data = (await res.json()) as { transcript?: string };
  return (data.transcript ?? "").trim();
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
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !res.body) {
    // Keep a short piece of the answer in the server log (never the key) so the reason can be found in Vercel.
    const detail = await res.text().then((t) => t.replace(/\s+/g, " ").slice(0, 200)).catch(() => "");
    console.error(`[voice/tts] cartesia answered ${res.status}: ${detail}`);
    throw new VoiceUpstreamError("cartesia", res.status, detail);
  }
  return res;
}
