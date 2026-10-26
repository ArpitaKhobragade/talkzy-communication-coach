import { extractJson, verifyFeedback } from "@/features/coach/verify";
import { generate, isLiveMode } from "@/features/coach/server/llm";
import { reportSystemPrompt, reportUserPrompt } from "@/features/coach/server/prompts";
import { getModule } from "@/features/content/modules";
import { AiFeedbackSchema, ReportRequestSchema } from "@/features/session/types";
import { jsonError, parseRequest } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const parsed = await parseRequest(req, ReportRequestSchema, "report", 10);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;

  const m = getModule(body.moduleId);
  if (!m) return jsonError(404, "unknown_module", "That learning module does not exist.");

  if (!isLiveMode()) {
    return Response.json({
      ai: null,
      reason: "Development mode: no AI key is configured, so AI-written feedback (grammar, vocabulary, structure) is not available.",
    });
  }

  const studentAnswers = body.turns.filter((t) => t.role === "student").map((t) => t.text);
  if (studentAnswers.length === 0) {
    return Response.json({ ai: null, reason: "There were no student answers to review." });
  }

  let lastError = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, model } = await generate({
        purpose: "report",
        system: reportSystemPrompt(),
        messages: [
          {
            role: "user",
            content:
              reportUserPrompt(m, body) +
              (attempt > 0 ? `\n\nYour previous reply could not be parsed (${lastError}). Reply with ONLY the JSON object.` : ""),
          },
        ],
        maxTokens: 5000,
      });
      const checked = AiFeedbackSchema.parse(extractJson(text));
      const { feedback, droppedQuotes } = verifyFeedback(checked, studentAnswers);
      return Response.json({ ai: feedback, model, droppedQuotes });
    } catch (err) {
      lastError = err instanceof Error ? err.name : "unknown";
      console.error("[coach/report] attempt failed:", err instanceof Error ? err.message : "unknown");
    }
  }
  return Response.json({
    ai: null,
    reason: "The AI service could not produce the written feedback this time. Your measured results are shown below.",
  });
}
