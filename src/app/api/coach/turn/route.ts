import { devCoachReply } from "@/features/coach/dev-coach";
import { keepOneQuestion } from "@/features/coach/one-question";
import { generate, isLiveMode } from "@/features/coach/server/llm";
import { buildChatMessages, coachSystemPrompt } from "@/features/coach/server/prompts";
import { getModule } from "@/features/content/modules";
import { CoachTurnRequestSchema, type CoachTurnResponse } from "@/features/session/types";
import { jsonError, parseRequest } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The coach wraps up when time is nearly gone or after this many student answers. */
const CLOSE_AFTER_SECONDS = 45;
const MAX_STUDENT_TURNS = 12;

export async function POST(req: Request) {
  const parsed = await parseRequest(req, CoachTurnRequestSchema, "turn", 40);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;

  const m = getModule(body.moduleId);
  if (!m) return jsonError(404, "unknown_module", "That learning module does not exist.");

  if (body.event === "start") {
    // The opening is fixed text so the conversation starts instantly in both modes.
    const res: CoachTurnResponse = {
      text: m.openingQuestion,
      mode: isLiveMode() ? "live" : "dev",
      wrapUp: false,
    };
    return Response.json(res);
  }

  if (!isLiveMode()) return Response.json(devCoachReply(body));

  const studentTurns = body.history.filter((h) => h.role === "student").length;
  const closing = body.event === "answer" && (body.remainingSec < CLOSE_AFTER_SECONDS || studentTurns >= MAX_STUDENT_TURNS);

  try {
    const { text } = await generate({
      purpose: "chat",
      system: coachSystemPrompt(m, body, closing),
      messages: buildChatMessages(body),
      // Spoken replies are short, but reasoning models also spend tokens thinking; leave headroom.
      maxTokens: 800,
    });
    const reply: CoachTurnResponse = { text: closing ? text.replace(/\s+/g, " ").trim() : keepOneQuestion(text), mode: "live", wrapUp: closing };
    return Response.json(reply);
  } catch (err) {
    // Do not log request content. Log only the error class so operators can see failures.
    console.error("[coach/turn] model call failed:", err instanceof Error ? err.message : "unknown");
    // Fall back to the scripted coach, honestly labelled as such via mode: "dev".
    return Response.json({ ...devCoachReply(body), degraded: true });
  }
}
