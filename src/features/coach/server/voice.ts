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
  ) {
    super(`${service}_http_${status}`);
  }
}

/**
 * Transcribe one speech segment (WAV, 16 kHz mono, under ~30 s) with Sarvam.
 * `keyterms` (domain words from the reading) help recognition; if Sarvam rejects the optional
 * field we retry once without it.
 */
export async function transcribeSegment(wav: ArrayBuffer, keyterms: string[]): Promise<string> {
  const call = async (withKeyterms: boolean) => {
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
    form.append("language_code", process.env.SARVAM_LANGUAGE?.trim() || "en-IN");
    const model = process.env.SARVAM_STT_MODEL?.trim();
    if (model) form.append("model", model);
    if (withKeyterms && keyterms.length) form.append("keyterms", JSON.stringify(keyterms.slice(0, 50).map((t) => t.slice(0, 64))));
    return fetch(`${sarvamBase()}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": process.env.SARVAM_API_KEY ?? "" },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  };

  let res = await call(true);
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
  if (!res.ok || !res.body) throw new VoiceUpstreamError("cartesia", res.status);
  return res;
}
