import { getModule } from "@/features/content/modules";
import { sttConfigured, transcribeSegment } from "@/features/coach/server/voice";
import { jsonError, parseBinaryRequest } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 25 s of 16 kHz 16-bit mono audio is about 800 KB; allow headroom for the WAV header. */
const MAX_AUDIO_BYTES = 1_200_000;

/**
 * Speech-to-text proxy (Sarvam). The browser sends one VAD-detected speech segment as WAV.
 * Audio is forwarded and discarded: nothing is stored or logged.
 */
export async function POST(req: Request) {
  if (!sttConfigured()) return jsonError(501, "stt_not_configured", "Cloud speech recognition is not configured.");

  const parsed = await parseBinaryRequest(req, { bucket: "stt", limitPerMinute: 90, contentType: "audio/wav", maxBytes: MAX_AUDIO_BYTES });
  if ("response" in parsed) return parsed.response;

  // Domain words from the reading help the recogniser with terms like "debugging" or "peer review".
  const moduleId = new URL(req.url).searchParams.get("module") ?? "";
  const keyterms = getModule(moduleId)?.keyTerms ?? [];

  try {
    const text = await transcribeSegment(parsed.data, keyterms);
    return Response.json({ text });
  } catch (err) {
    console.error("[voice/stt] failed:", err instanceof Error ? err.message : "unknown");
    return jsonError(502, "stt_failed", "Speech recognition failed for this part.");
  }
}
