import { activeProvider, isLiveMode } from "@/features/coach/server/llm";
import { sttConfigured, ttsConfigured } from "@/features/coach/server/voice";

export const dynamic = "force-dynamic";

/**
 * Tells the UI which services are configured. Only names, never key material.
 *  - mode "live": a real LLM (Groq or Anthropic) is configured; otherwise "dev".
 *  - stt "sarvam": cloud speech recognition is available; otherwise the browser's own recogniser is used.
 *  - tts "cartesia": a cloud voice is available (Cartesia, or Sarvam's own voice as the backup); otherwise the browser's own voice is used.
 */
export function GET() {
  return Response.json({
    mode: isLiveMode() ? "live" : "dev",
    llm: activeProvider(),
    stt: sttConfigured() ? "sarvam" : "browser",
    tts: ttsConfigured() ? "cartesia" : "browser",
  });
}
