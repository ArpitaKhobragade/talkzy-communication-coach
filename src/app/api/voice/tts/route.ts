import { synthesizeSpeech, ttsConfigured } from "@/features/coach/server/voice";
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
    return jsonError(502, "tts_failed", "The coach's voice is unavailable right now.");
  }
}
