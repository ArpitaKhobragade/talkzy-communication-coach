import { getModule } from "@/features/content/modules";
import { sttConfigured, takePartialSlot, transcribePartialFast, transcribeSegment } from "@/features/coach/server/voice";
import { jsonError, parseBinaryRequest } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Words a student says when the coach asks "Are you done?". */
const REPLY_WORDS = ["yes", "no", "move on", "next question", "I want to say more", "I am done", "end session"];

/** 25 s of 16 kHz 16-bit mono audio is about 800 KB; allow headroom for the WAV header. */
const MAX_AUDIO_BYTES = 1_200_000;

/**
 * Speech-to-text proxy (Sarvam). The browser sends one VAD-detected speech segment as WAV.
 * Audio is forwarded and discarded: nothing is stored or logged.
 */
export async function POST(req: Request) {
  if (!sttConfigured()) return jsonError(501, "stt_not_configured", "Cloud speech recognition is not configured.");

  // Words are sent while the student is still speaking (every second or so) so they can be shown at once, so the limit is generous.
  const parsed = await parseBinaryRequest(req, { bucket: "stt", limitPerMinute: 300, contentType: "audio/wav", maxBytes: MAX_AUDIO_BYTES });
  if ("response" in parsed) return parsed.response;

  // Domain words from the reading help the recogniser with terms like "debugging" or "peer review".
  // A short reply to "Are you done?" is helped by the command words instead.
  const params = new URL(req.url).searchParams;
  const keyterms = params.get("reply") === "1" ? REPLY_WORDS : (getModule(params.get("module") ?? "")?.keyTerms ?? []);

  const partial = params.get("interim") === "1";
  if (partial) {
    // The fast live words come first: they are quicker, and they do not use the speech service's allowance.
    const fast = await transcribePartialFast(parsed.data);
    if (fast !== null) return Response.json({ text: fast, fast: true });
    // Otherwise the speech service shows them, within its share of the allowance (real transcripts are never held back).
    if (!takePartialSlot()) return jsonError(429, "busy", "Live words are paused for a moment.");
  }

  try {
    // Spoken answers keep the filler words, so the report can count them. Replies and the reading use the normal text.
    const verbatim = params.get("answer") === "1";
    const text = await transcribeSegment(parsed.data, keyterms, { verbatim, partial });
    return Response.json({ text });
  } catch (err) {
    console.error("[voice/stt] failed:", err instanceof Error ? err.message : "unknown");
    return jsonError(502, "stt_failed", "Speech recognition failed for this part.");
  }
}
