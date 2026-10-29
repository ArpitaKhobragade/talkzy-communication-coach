// Browser-only. The coach's opening line is made by the AI from the passage while the student is still reading, so the talk
// starts the moment the reading ends. Without an AI (or if it is slow or fails) the app's own scripted opening is used.
import { openingMessage } from "@/features/coach/dev-coach";
import { fillName, NAME_TOKEN } from "@/features/coach/name-token";
import type { CoachTurnRequest } from "@/features/session/types";
import { prefetchSpeech } from "@/features/speech/speaker";
import { requestCoachTurn } from "./coach-api";

export interface OpeningInput {
  moduleId: string;
  goal: CoachTurnRequest["goal"];
  level: CoachTurnRequest["level"];
  ageBand: CoachTurnRequest["ageBand"];
  /** The student's name: only the first name is used, and it never leaves this device. */
  name: string;
  /** A real AI is configured (otherwise the scripted opening is used). */
  live: boolean;
  /** The coach's voice is on and is the cloud voice, so the audio can be made ahead of time. */
  cloudVoice: boolean;
  rate: number;
}

/** The longest the talk waits for the AI's opening before it starts with the scripted one. */
export const OPENING_WAIT_MS = 5000;

const pending = new Map<string, Promise<string>>();
const keyOf = (i: OpeningInput) => `${i.moduleId}|${i.name}`;

/** The AI greets the student itself (with {name} where the first name goes). If it forgot to, a plain hello is put in front. */
function withGreeting(text: string, name: string): string {
  const greeted = /^(hi|hello|hey|good (morning|afternoon|evening)|welcome|nice to meet)\b/i.test(text) || text.includes(NAME_TOKEN);
  return fillName(greeted ? text : `Hi ${NAME_TOKEN}! ${text}`, name);
}

/** Starts making the opening (once). Calling it again before it is taken gives the same one. */
export function prepareOpening(i: OpeningInput): Promise<string> {
  const key = keyOf(i);
  const existing = pending.get(key);
  if (existing) return existing;
  const scripted = openingMessage(i.moduleId, i.name);
  const made = i.live
    ? requestCoachTurn({ moduleId: i.moduleId, goal: i.goal, level: i.level, ageBand: i.ageBand, remainingSec: 600, history: [], event: "start" })
        .then((res) => (res.mode === "live" && !res.degraded && res.text.trim() ? withGreeting(res.text.trim(), i.name) : scripted))
        .catch(() => scripted)
    : Promise.resolve(scripted);
  const done = made.then((text) => {
    if (i.cloudVoice) prefetchSpeech(text, { rate: i.rate, cloud: true });
    return text;
  });
  pending.set(key, done);
  return done;
}

/** The prepared opening (made now if there is none), waiting at most `OPENING_WAIT_MS` for it. It can only be taken once. */
export async function takeOpening(i: OpeningInput): Promise<string> {
  const key = keyOf(i);
  const made = pending.get(key) ?? prepareOpening(i);
  pending.delete(key);
  const scripted = openingMessage(i.moduleId, i.name);
  return Promise.race([made, new Promise<string>((resolve) => setTimeout(() => resolve(scripted), OPENING_WAIT_MS))]);
}
