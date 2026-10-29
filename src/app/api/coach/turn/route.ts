import { devCoachReply } from "@/features/coach/dev-coach";
import { keepOneQuestion } from "@/features/coach/one-question";
import { generate, isLiveMode, type LlmMessage } from "@/features/coach/server/llm";
import { buildChatMessages, coachSystemPrompt } from "@/features/coach/server/prompts";
import { getModule } from "@/features/content/modules";
import { CoachTurnRequestSchema, type CoachTurnResponse } from "@/features/session/types";
import { jsonError, parseRequest } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The coach wraps up when time is nearly gone (the time budget decides how long the talk is) or after this many student answers. */
const CLOSE_AFTER_SECONDS = 75;
const MAX_STUDENT_TURNS = 30;

/**
 * The coach's words. Every turn must end with a follow-up question so the talk keeps going; if the AI forgot, it is asked once to say
 * the same thing again with a question at the end (the first words are kept if the second try also has none).
 */
async function coachText(system: string, messages: LlmMessage[], closing: boolean, event: string, maxTokens: number): Promise<string> {
  const { text } = await generate({ purpose: "chat", system, messages, maxTokens });
  if (closing || event === "unclear" || text.includes("?")) return text;
  try {
    const again = await generate({
      purpose: "chat",
      system,
      messages: [...messages, { role: "assistant", content: text }, { role: "user", content: "[Your reply has no question. Say it again in the same words, and END with ONE short follow-up question about what the student just said.]" }],
      maxTokens,
    });
    return again.text.includes("?") ? again.text : text;
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

  const studentTurns = body.history.filter((h) => h.role === "student").length;
  const closing = body.event === "answer" && (body.remainingSec < CLOSE_AFTER_SECONDS || studentTurns >= MAX_STUDENT_TURNS);

  try {
    // Spoken replies are short, but reasoning models also spend tokens thinking; leave headroom.
    const text = await coachText(coachSystemPrompt(m, body, closing), buildChatMessages(body, closing), closing, body.event, 800);
    const reply: CoachTurnResponse = { text: closing ? text.replace(/\s+/g, " ").trim() : keepOneQuestion(text), mode: "live", wrapUp: closing };
    return Response.json(reply);
  } catch (err) {
    // Do not log request content. Log only the error class so operators can see failures.
    console.error("[coach/turn] model call failed:", err instanceof Error ? err.message : "unknown");
    // Fall back to the scripted coach, honestly labelled as such via mode: "dev".
    return Response.json({ ...devCoachReply(body), degraded: true });
  }
}
