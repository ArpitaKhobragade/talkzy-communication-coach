import { getGoal } from "../content/fields";
import { getModule } from "../content/modules";
import type { CoachTurnRequest, CoachTurnResponse } from "../session/types";
import { countWords } from "../speech/metrics";

/**
 * DEVELOPMENT-MODE coach. This is a scripted question bank, NOT an AI: it does not understand
 * the student's answer. It exists so the full journey can be exercised without an API key,
 * and the UI labels it clearly. The module's questions are ordered from easy to difficult and
 * are asked in that order.
 */

export function openingMessage(moduleId: string, displayName: string): string {
  const m = getModule(moduleId);
  const name = displayName.trim().split(/\s+/)[0] || "there";
  const question = m?.openingQuestion ?? "What was the most interesting idea in the passage, and why?";
  return `Hi ${name}! Thanks for reading that. I'm your Talkzy coach, so take your time and speak naturally. ${question}`;
}

const ACKS = [
  "Thanks for sharing that.",
  "Good, I can hear you thinking it through.",
  "Okay, that gives me something to work with.",
  "Nice effort. Let's build on that.",
];

const LONGER_NUDGE = "Could you add a little more detail, maybe an example?";

const STRUCTURE_HINT: Record<string, string> = {
  clarity: "Try this shape: your main point, one reason, then a short example.",
  fluency: "Try to keep going in full sentences without stopping, even if you need to slow down.",
  vocabulary: "See if you can use one of the key terms from the passage in your answer.",
  confidence: "There is no wrong answer here. I'd like to hear your own opinion.",
  interview: "Imagine you are answering in an interview: be concise and give one concrete example.",
};

export function devCoachReply(req: CoachTurnRequest): CoachTurnResponse {
  const m = getModule(req.moduleId);
  const goal = getGoal(m?.goal ?? req.goal);
  const studentTurns = req.history.filter((h) => h.role === "student");

  if (req.event === "silence") {
    const last = [...req.history].reverse().find((h) => h.role === "coach")?.text;
    return {
      mode: "dev",
      wrapUp: false,
      text: `That's okay, take your time. ${STRUCTURE_HINT[goal.id] ?? ""} ${last ? "Would you like me to ask it another way, or shall we try a new question?" : ""}`.trim(),
    };
  }
  if (req.event === "unclear") {
    return { mode: "dev", wrapUp: false, text: "Sorry, I didn't catch that clearly. Could you say it again, a little slower?" };
  }

  // The module's follow-up questions, from easy to difficult.
  const questions = m?.followUpQuestions ?? [];
  const nextIndex = studentTurns.length - 1;
  const outOfQuestions = nextIndex >= questions.length;
  const closing = req.remainingSec < 45 || outOfQuestions;

  if (closing) {
    return {
      mode: "dev",
      wrapUp: true,
      text: "Thank you, that was a good conversation. Let's stop here and I'll put your feedback report together.",
    };
  }

  const lastAnswer = studentTurns[studentTurns.length - 1]?.text ?? "";
  const ack = ACKS[(studentTurns.length - 1) % ACKS.length];
  const short = countWords(lastAnswer) < 8;
  const prefix = short ? `${ack} ${LONGER_NUDGE}` : ack;
  return { mode: "dev", wrapUp: false, text: `${prefix} ${questions[nextIndex]}` };
}
