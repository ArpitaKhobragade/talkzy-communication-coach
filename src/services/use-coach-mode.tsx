"use client";

import { useEffect, useState } from "react";

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
    // One failed request (a network blip, a busy server waking up) must not leave the whole visit without the AI and the cloud voice.
    const ask = async (): Promise<Partial<ServerStatus>> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch("/api/status", { cache: "no-store" });
          if (!r.ok) throw new Error("status");
          return (await r.json()) as Partial<ServerStatus>;
        } catch (err) {
          if (attempt >= 3) throw err;
          await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
        }
      }
    };
    ask()
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
