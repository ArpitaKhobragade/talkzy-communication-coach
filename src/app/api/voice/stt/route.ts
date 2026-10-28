import { getModule } from "@/features/content/modules";
import { sttConfigured, transcribeSegment } from "@/features/coach/server/voice";
import { jsonError, parseBinaryRequest } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Words a student says when the coach asks "Are you done?". */
const REPLY_WORDS = ["yes", "no", "move on", "next question", "I want to say more", "I am done", "end session"];

/**
 * The speech service allows 60 requests a minute for the whole account on its entry plan. Words shown while the student is still
 * speaking ("partial" words) are only a nicety, so they are given at most this many of those requests per minute on this server;
 * the rest is left for the real transcripts, which are never held back.
 */
const PARTIAL_BUDGET_PER_MIN = 30;
const recentPartials: number[] = [];

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
    const now = Date.now();
    while (recentPartials.length && now - recentPartials[0] > 60_000) recentPartials.shift();
    if (recentPartials.length >= PARTIAL_BUDGET_PER_MIN) return jsonError(429, "busy", "Live words are paused for a moment.");
    recentPartials.push(now);
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
