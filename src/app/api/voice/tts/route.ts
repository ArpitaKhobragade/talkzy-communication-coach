import { speakWithBestVoice, ttsConfigured, VoiceUpstreamError, voiceFailureHint } from "@/features/coach/server/voice";
import { jsonError, parseRequest } from "@/lib/api-helpers";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({
  text: z.string().trim().min(1).max(600),
  speed: z.number().min(0.6).max(1.5).default(1),
});

/** Text-to-speech proxy. Streams MP3 back; the Cartesia voice ID is fixed on the server. It is the only voice, unless the owner turns on TTS_BACKUP=sarvam. */
export async function POST(req: Request) {
  if (!ttsConfigured()) return jsonError(501, "tts_not_configured", "Cloud voice is not configured.");

  const parsed = await parseRequest(req, Body, "tts", 240);
  if ("response" in parsed) return parsed.response;

  try {
    const { body, via } = await speakWithBestVoice(parsed.data.text, parsed.data.speed);
    return new Response(body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-talkzy-voice": via } });
  } catch (err) {
    console.error("[voice/tts] failed:", err instanceof Error ? err.message : "unknown");
    const hint = err instanceof VoiceUpstreamError ? voiceFailureHint(err.status, err.detail) : voiceFailureHint(0);
    return jsonError(502, "tts_failed", "The coach's voice is unavailable right now.", { hint });
  }
}

/** Voice check for the owner: GET /api/voice/tts?check=1 says whether the coach voice works, and if not, why. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("check") !== "1") return jsonError(400, "bad_request", "Use ?check=1.");
  if (!ttsConfigured()) return Response.json({ ok: false, hint: "The coach voice is not set up. Add CARTESIA_API_KEY and CARTESIA_VOICE_ID. Until then the browser voice is used." });
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  const limited = await parseRequest(new Request(req.url, { method: "POST", headers, body: JSON.stringify({ text: "Hello", speed: 1 }) }), Body, "tts-check", 10);
  if ("response" in limited) return limited.response;
  try {
    // A short sentence, like a real coach message, so a nearly empty credit is noticed too.
    // The check always asks Cartesia, even if it was marked as down a moment ago, so it tells the owner the truth.
    const { via } = await speakWithBestVoice("Hello, I am your coach. Let us begin.", 1, { ignoreCoolOff: true });
    return Response.json({ ok: true, via, hint: via === "cartesia" ? "The coach's voice (your Cartesia voice ID) is working." : "Sarvam's voice is being used because TTS_BACKUP=sarvam is on (the Cartesia voice is not available)." });
  } catch (err) {
    return Response.json({ ok: false, hint: err instanceof VoiceUpstreamError ? voiceFailureHint(err.status, err.detail) : voiceFailureHint(0) });
  }
}
