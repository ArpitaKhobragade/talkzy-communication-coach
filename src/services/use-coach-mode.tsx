"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/ui";

export type CoachMode = "live" | "dev" | "unknown";

export interface ServerStatus {
  mode: CoachMode;
  llm: "groq" | "anthropic" | null;
  /** "sarvam" when cloud speech recognition is configured, else the browser's own. */
  stt: "sarvam" | "browser";
  /** "cartesia" when the cloud voice is configured, else the browser's own. */
  tts: "cartesia" | "browser";
  /** False until the first answer from the server arrives. */
  ready: boolean;
}

const UNKNOWN: ServerStatus = { mode: "unknown", llm: null, stt: "browser", tts: "browser", ready: false };
// If the server cannot be reached, be honest and assume the scripted coach and browser voice.
const OFFLINE: ServerStatus = { mode: "dev", llm: null, stt: "browser", tts: "browser", ready: true };

let cached: ServerStatus | null = null;

/** Which services are configured on the server. Fetched once per page load. */
export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>(cached ?? UNKNOWN);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status"))))
      .then((d: Partial<ServerStatus>) => {
        cached = {
          mode: d.mode === "live" ? "live" : "dev",
          llm: d.llm === "groq" || d.llm === "anthropic" ? d.llm : null,
          stt: d.stt === "sarvam" ? "sarvam" : "browser",
          tts: d.tts === "cartesia" ? "cartesia" : "browser",
          ready: true,
        };
        if (alive) setStatus(cached);
      })
      .catch(() => {
        if (alive) setStatus(OFFLINE);
      });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** Is a real AI configured on the server? */
export function useCoachMode(): CoachMode {
  return useServerStatus().mode;
}

export function DevModeBanner({ mode }: { mode: CoachMode }) {
  if (mode !== "dev") return null;
  return (
    <Notice tone="warn" title="Development mode: no AI key configured" role="status">
      The coach uses a scripted list of questions and does not understand your answers. Your speech measurements (pace, pauses, filler
      words) are still real, but AI-written feedback on grammar, vocabulary and structure is switched off. See the README to add an API
      key.
    </Notice>
  );
}
