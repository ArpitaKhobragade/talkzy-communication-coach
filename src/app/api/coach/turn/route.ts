import { devCoachReply } from "@/features/coach/dev-coach";
import { cleanClosing, keepOneQuestion } from "@/features/coach/one-question";
import { generate, isLiveMode, type LlmMessage } from "@/features/coach/server/llm";
import { buildChatMessages, coachSystemPrompt } from "@/features/coach/server/prompts";
import { getModule } from "@/features/content/modules";
import { CoachTurnRequestSchema, type CoachTurnResponse } from "@/features/session/types";
import { jsonError, parseRequest } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The coach wraps up when time is nearly gone (the time budget decides how long the talk is) or after this many student answers. */
const CLOSE_AFTER_SECONDS = 75;
/** The conversation closes by itself after this many answers (about eight to ten minutes), or sooner when the time is nearly up. */
const MAX_STUDENT_TURNS = 10;

/** An opening shorter than this is just "ready to chat?": it says nothing about the passage. */
const MIN_OPENING_WORDS = 14;
const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;
/** Words of an examiner, not of a friend. */
const GRADING = /\b(perfect(ly)?|fantastic|excellent|brilliant|outstanding|well done|great answer|good answer|nice answer|strong answer|great job|good job)\b/i;
/** The coach has no past: it cannot remember, have read or have always felt anything. */
const MADE_UP_PAST = /(welcome back|good to see you again|nice to see you again|stuck with me|i['’]ve always|i have always|i remember|when i was|i was thinking about|i just (read|finished)|i read (it|that))/i;

/** What is wrong with the coach's words, in plain terms for the AI (nothing is wrong when the list is empty). */
function problemsIn(text: string, event: string): string[] {
  const out: string[] = [];
  if (!text.includes("?")) out.push("it has no question: END with ONE short follow-up question about what the student just said");
  if (event === "start" && wordsIn(text) < MIN_OPENING_WORDS) {
    out.push("the opening is too thin: give a friendly greeting with {name}, ONE specific idea from the passage, and ONE easy open question");
  }
  if (event === "start" && !/\{name\}|^\s*(hi|hello|hey|good (morning|afternoon|evening)|welcome|nice to meet)\b/i.test(text)) {
    out.push("it does not start with a friendly greeting: begin with a greeting that has {name} in it");
  }
  if (GRADING.test(text)) out.push("it grades or praises the student's answer: do not use words like perfect, fantastic or well done, just react naturally");
  if (MADE_UP_PAST.test(text)) out.push("it claims a past or memories of your own: you have none, so say what is interesting about the idea itself");
  return out;
}

/**
 * The coach's words. Every turn must end with a follow-up question so the talk keeps going, the opening must say something real about
 * the passage, and the coach must not grade the student or claim a past. If anything is wrong, the AI is asked once to say it again
 * properly (the first words are kept if the second try is no better).
 */
async function coachText(system: string, messages: LlmMessage[], closing: boolean, event: string, maxTokens: number): Promise<string> {
  const { text } = await generate({ purpose: "chat", system, messages, maxTokens });
  if (event === "unclear") return text;
  if (closing) {
    // A closing is a goodbye: no question, and it says the report is being made. If not, the AI is asked once more.
    const bye = cleanClosing(text);
    if (!bye.includes("?") && /\b(report|feedback)\b/i.test(bye)) return text;
    try {
      const again = await generate({
        purpose: "chat",
        system,
        messages: [...messages, { role: "assistant", content: text }, { role: "user", content: "[That was not a goodbye. Say a warm, specific goodbye in one or two short sentences, with no question, and say that their written feedback report is being made now.]" }],
        maxTokens,
      });
      const better = cleanClosing(again.text);
      return !better.includes("?") && /\b(report|feedback)\b/i.test(better) ? again.text : text;
    } catch {
      return text;
    }
  }
  const problems = problemsIn(text, event);
  if (!problems.length) return text;
  try {
    const fix = `[Say your reply again, keeping what was good, because ${problems.join("; and ")}.]`;
    const again = await generate({ purpose: "chat", system, messages: [...messages, { role: "assistant", content: text }, { role: "user", content: fix }], maxTokens });
    return problemsIn(again.text, event).length < problems.length ? again.text : text;
  } catch {
    return text;
  }
}

export async function POST(req: Request) {
  const parsed = await parseRequest(req, CoachTurnRequestSchema, "turn", 40);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;

  const m = getModule(body.moduleId);
  if (!m) return jsonError(404, "unknown_module", "That learning module does not exist.");

  if (body.event === "start") {
    // The opening is made by the AI from the passage while the student is still reading, so it is ready the moment the talk starts.
    // Without an AI (or if it fails) the app uses its own scripted opening, and says so with `degraded` / mode "dev".
    if (isLiveMode()) {
      try {
        const text = await coachText(coachSystemPrompt(m, body, false), buildChatMessages(body), false, body.event, 600);
        const res: CoachTurnResponse = { text: keepOneQuestion(text), mode: "live", wrapUp: false };
        return Response.json(res);
      } catch (err) {
        console.error("[coach/turn] opening failed:", err instanceof Error ? err.message : "unknown");
        return Response.json({ text: m.openingQuestion, mode: "dev", wrapUp: false, degraded: true } satisfies CoachTurnResponse);
      }
    }
    return Response.json({ text: m.openingQuestion, mode: "dev", wrapUp: false } satisfies CoachTurnResponse);
  }

  if (!isLiveMode()) return Response.json(devCoachReply(body));

  const studentTurns = Math.max(body.history.filter((h) => h.role === "student").length, body.answerCount ?? 0);
  // The student ending the session is also a closing: the coach says a natural goodbye, with no new question.
  const closing = body.event === "end" || (body.event === "answer" && (body.remainingSec < CLOSE_AFTER_SECONDS || studentTurns >= MAX_STUDENT_TURNS));

  try {
    // Spoken replies are short, but reasoning models also spend tokens thinking; leave headroom.
    const text = await coachText(coachSystemPrompt(m, body, closing), buildChatMessages(body, closing), closing, body.event, 800);
    const reply: CoachTurnResponse = { text: closing ? cleanClosing(text) : keepOneQuestion(text), mode: "live", wrapUp: closing };
    return Response.json(reply);
  } catch (err) {
    // Do not log request content. Log only the error class so operators can see failures.
    console.error("[coach/turn] model call failed:", err instanceof Error ? err.message : "unknown");
    // Fall back to the scripted coach, honestly labelled as such via mode: "dev".
    return Response.json({ ...devCoachReply(body), degraded: true });
  }
}
