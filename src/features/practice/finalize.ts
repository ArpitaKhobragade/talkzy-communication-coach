import type { Goal, Level } from "../content/types";
import {
  buildAnswerCoaching,
  buildBodyLanguageCoaching,
  buildBodyLanguageNotes,
  buildFallbackExercises,
  buildReadingCoaching,
  buildSayItBetter,
  buildSpeechNotes,
} from "../coach/report-builder";
import { computeSpeechMetrics } from "../speech/metrics";
import type { AiFeedback, ReadingResult, Session, Turn, VisionMetrics } from "../session/types";

export interface FinalizeInput {
  id: string;
  startedAt: number;
  endedAt: number;
  /** Seconds that may count toward today's limit for this session. */
  budgetSec: number;
  moduleId: string;
  field: Session["field"];
  level: Level;
  goal: Goal;
  /** Live only if the server had AI configured and no scripted fallback was used. */
  liveAi: boolean;
  readingSec: number;
  /** Words in the passage, used to judge silent reading speed. */
  passageWords: number;
  reading: ReadingResult;
  turns: Turn[];
  vision: VisionMetrics | null;
  /** The camera was switched on, even if its analysis could not run. */
  cameraOn?: boolean;
  keepTranscript: boolean;
  ai: AiFeedback | null;
  aiReason?: string;
  model?: string;
}

/** A conversation counts as completed once the student gave at least two answers. */
export const MIN_ANSWERS_FOR_COMPLETED = 2;

export function buildSession(i: FinalizeInput): Session {
  const speech = computeSpeechMetrics(i.turns);
  const elapsed = Math.max(0, Math.round((i.endedAt - i.startedAt) / 1000));
  const durationSec = Math.min(elapsed, Math.max(0, i.budgetSec));
  const readingSec = Math.min(Math.round(i.readingSec), durationSec);
  const answers = i.turns.filter((t) => t.role === "student" && t.text.trim()).length;

  return {
    id: i.id,
    startedAt: i.startedAt,
    endedAt: i.endedAt,
    moduleId: i.moduleId,
    field: i.field,
    level: i.level,
    goal: i.goal,
    mode: i.liveAi ? "live" : "dev",
    durationSec,
    readingSec,
    conversationSec: Math.max(0, durationSec - readingSec),
    completed: answers >= MIN_ANSWERS_FOR_COMPLETED,
    reading: i.reading,
    turns: i.keepTranscript ? i.turns : [],
    transcriptKept: i.keepTranscript,
    speech,
    vision: i.vision,
    cameraOn: i.cameraOn ?? i.vision !== null,
    report: {
      generatedBy: i.ai ? "ai" : "dev",
      model: i.model,
      createdAt: i.endedAt,
      ai: i.ai,
      aiUnavailableReason: i.ai ? undefined : i.aiReason,
      speechNotes: buildSpeechNotes(speech, i.reading.aloud),
      bodyLanguageNotes: buildBodyLanguageNotes(i.vision),
      // Worked out now, from the full transcript, even if the transcript itself is not kept afterwards.
      sayItBetter: i.ai?.sayItBetter?.length ? i.ai.sayItBetter.map((x) => ({ ...x, source: "ai" as const })) : buildSayItBetter(i.turns),
      readingCoaching: buildReadingCoaching(i.reading, i.passageWords),
      answerCoaching: buildAnswerCoaching(speech),
      bodyLanguageCoaching: buildBodyLanguageCoaching(i.vision),
      fallbackExercises: buildFallbackExercises(speech, i.goal),
    },
  };
}
