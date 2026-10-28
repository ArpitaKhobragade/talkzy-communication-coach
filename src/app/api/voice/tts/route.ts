import { synthesizeSpeech, ttsConfigured, VoiceUpstreamError, voiceFailureHint } from "@/features/coach/server/voice";
import { jsonError, parseRequest } from "@/lib/api-helpers";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({
  text: z.string().trim().min(1).max(600),
  speed: z.number().min(0.6).max(1.5).default(1),
});

/** Text-to-speech proxy (Cartesia). Streams MP3 back; the voice ID is fixed on the server. */
export async function POST(req: Request) {
  if (!ttsConfigured()) return jsonError(501, "tts_not_configured", "Cloud voice is not configured.");

  const parsed = await parseRequest(req, Body, "tts", 90);
  if ("response" in parsed) return parsed.response;

  try {
    const upstream = await synthesizeSpeech(parsed.data.text, parsed.data.speed);
    return new Response(upstream.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (err) {
    console.error("[voice/tts] failed:", err instanceof Error ? err.message : "unknown");
    const hint = err instanceof VoiceUpstreamError ? voiceFailureHint(err.status, err.detail) : voiceFailureHint(0);
    return jsonError(502, "tts_failed", "The coach's voice is unavailable right now.", { hint });
  }
}

/** Voice check for the owner: GET /api/voice/tts?check=1 says whether the studio voice works, and if not, why. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("check") !== "1") return jsonError(400, "bad_request", "Use ?check=1.");
  if (!ttsConfigured()) return Response.json({ ok: false, hint: "The studio voice is not set up. Add CARTESIA_API_KEY and CARTESIA_VOICE_ID. The browser voice is used instead." });
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  const limited = await parseRequest(new Request(req.url, { method: "POST", headers, body: JSON.stringify({ text: "Hello", speed: 1 }) }), Body, "tts-check", 10);
  if ("response" in limited) return limited.response;
  try {
    // A short sentence, like a real coach message, so a nearly empty credit is noticed too.
    await synthesizeSpeech("Hello, I am your coach. Let us begin.", 1);
    return Response.json({ ok: true, hint: "The studio voice is working." });
  } catch (err) {
    return Response.json({ ok: false, hint: err instanceof VoiceUpstreamError ? voiceFailureHint(err.status, err.detail) : voiceFailureHint(0) });
  }
}
