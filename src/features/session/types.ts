import { z } from "zod";

export const FieldIdSchema = z.enum([
  "computer-science",
  "business-marketing",
  "science",
  "engineering",
  "health-medicine",
  "humanities-social",
  "arts-design",
  "school-general",
]);
export const LevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const GoalSchema = z.enum(["fluency", "clarity", "vocabulary", "confidence", "interview"]);
export const AgeBandSchema = z.enum(["under13", "13to17", "18plus"]);

// ---------- Profile & settings ----------

export const ProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  ageBand: AgeBandSchema,
  field: FieldIdSchema,
  level: LevelSchema,
  goal: GoalSchema,
  consent: z.object({
    acceptedAt: z.number(),
    guardianConfirmed: z.boolean(),
  }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const SettingsSchema = z.object({
  /** Pre-tick the camera option at session start. Off by default. */
  cameraDefault: z.boolean(),
  /** Keep the full transcript after the report is generated. */
  keepTranscripts: z.boolean(),
  /** Coach speech rate for text-to-speech, 0.7 - 1.2. */
  speechRate: z.number().min(0.6).max(1.3),
  /** Speak the coach's replies aloud. Students who cannot use audio can turn this off. */
  coachVoice: z.boolean(),
  /** English variety used by speech recognition and the coach's voice. */
  speechLang: z.enum(["en-US", "en-GB", "en-IN", "en-AU"]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  cameraDefault: false,
  keepTranscripts: true,
  speechRate: 0.95,
  coachVoice: true,
  speechLang: "en-US",
};

// ---------- Session data ----------

export const TurnSchema = z.object({
  id: z.string(),
  role: z.enum(["coach", "student"]),
  text: z.string().max(4000),
  inputMode: z.enum(["voice", "typed"]).optional(),
  at: z.number(),
  /** Student voice turns: seconds from first to last detected speech (pauses inside it included). */
  speakingSec: z.number().min(0).optional(),
  pauseCount: z.number().int().min(0).optional(),
  longestPauseSec: z.number().min(0).optional(),
  /** Seconds between the coach finishing and the student starting to speak. */
  latencySec: z.number().min(0).optional(),
  lowConfidence: z.boolean().optional(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const ReadingResultSchema = z.object({
  mode: z.enum(["silent", "aloud"]),
  durationSec: z.number().min(0),
  aloud: z
    .object({
      accuracyPct: z.number().min(0).max(100),
      coveragePct: z.number().min(0).max(100),
      wpm: z.number().min(0).nullable(),
      spokenWordCount: z.number().int().min(0),
      missedWords: z.array(z.string()).max(60),
    })
    .optional(),
});
export type ReadingResult = z.infer<typeof ReadingResultSchema>;

export const SpeechMetricsSchema = z.object({
  voiceTurns: z.number().int().min(0),
  typedTurns: z.number().int().min(0),
  totalWords: z.number().int().min(0),
  voiceWords: z.number().int().min(0),
  speakingSec: z.number().min(0),
  /** Words per minute over voice-activity time. Null when too little voice data. */
  wpm: z.number().nullable(),
  fillerCount: z.number().int().min(0),
  fillerPer100: z.number().nullable(),
  fillers: z.array(z.object({ word: z.string(), count: z.number().int() })),
  repetitionCount: z.number().int().min(0),
  repetitions: z.array(z.string()).max(20),
  pauseCount: z.number().int().min(0),
  longestPauseSec: z.number().min(0),
  avgLatencySec: z.number().nullable(),
  avgAnswerWords: z.number().nullable(),
  uniqueWords: z.number().int().min(0),
  /** Share of distinct words (type-token ratio, first 200 words). Null if < 50 words. */
  lexicalVariety: z.number().nullable(),
  /** Share of words with 7+ letters. */
  longWordPct: z.number().nullable(),
});
export type SpeechMetrics = z.infer<typeof SpeechMetricsSchema>;

export const VisionMetricsSchema = z.object({
  framesAnalyzed: z.number().int().min(0),
  durationSec: z.number().min(0),
  facePresentPct: z.number().min(0).max(100),
  cameraFacingPct: z.number().min(0).max(100).nullable(),
  avgHeadYawDeg: z.number().nullable(),
  avgHeadPitchDeg: z.number().nullable(),
  shoulderTiltDeg: z.number().nullable(),
  uprightPct: z.number().min(0).max(100).nullable(),
  bodyVisiblePct: z.number().min(0).max(100),
  handsVisiblePct: z.number().min(0).max(100).nullable(),
  movementIndex: z.number().nullable(),
  movementLevel: z.enum(["low", "moderate", "high"]).nullable(),
  facialMovementIndex: z.number().nullable(),
  facialMovementLevel: z.enum(["low", "moderate", "high"]).nullable(),
});
export type VisionMetrics = z.infer<typeof VisionMetricsSchema>;

export const AiFeedbackSchema = z.object({
  headline: z.string().max(400),
  strengths: z
    .array(z.object({ title: z.string().max(120), detail: z.string().max(600), quote: z.string().max(300).optional() }))
    .max(5),
  improvements: z
    .array(
      z.object({
        title: z.string().max(120),
        detail: z.string().max(600),
        quote: z.string().max(300).optional(),
        tip: z.string().max(500),
      }),
    )
    .max(5),
  grammar: z
    .array(z.object({ quote: z.string().max(300), issue: z.string().max(300), suggestion: z.string().max(300) }))
    .max(6),
  vocabulary: z.object({
    summary: z.string().max(600),
    upgrades: z.array(z.object({ said: z.string().max(80), tryInstead: z.string().max(120) })).max(5),
  }),
  structure: z.object({
    summary: z.string().max(600),
    perAnswer: z
      .array(
        z.object({
          answerNumber: z.number().int().min(1).max(30),
          relevance: z.number().int().min(1).max(5),
          completeness: z.number().int().min(1).max(5),
          organization: z.number().int().min(1).max(5),
          comment: z.string().max(300),
        }),
      )
      .max(30),
  }),
  /** Sentences the student said, each with a clearer way to say it. `said` must be a verbatim quote. */
  sayItBetter: z
    .array(z.object({ said: z.string().max(300), better: z.string().max(400), why: z.string().max(300) }))
    .max(4)
    .optional(),
  /** How the student did while reading the passage. Optional: older sessions and some model replies lack it. */
  reading: z
    .object({
      summary: z.string().max(600),
      wentWell: z.array(z.string().max(300)).max(3),
      improve: z.array(z.object({ issue: z.string().max(300), howTo: z.string().max(400) })).max(4),
    })
    .optional(),
  exercises: z
    .array(z.object({ title: z.string().max(120), instructions: z.string().max(600), minutes: z.number().int().min(1).max(10) }))
    .min(1)
    .max(5),
  nextSessionFocus: z.string().max(400),
});
export type AiFeedback = z.infer<typeof AiFeedbackSchema>;

/** One piece of rule-based coaching: what was observed, why it matters, how to improve it. */
export const CoachingItemSchema = z.object({
  kind: z.enum(["good", "improve", "info"]),
  /** Short plain-language title, for example "Looking at the camera". */
  topic: z.string().optional(),
  observation: z.string(),
  why: z.string().optional(),
  howTo: z.string().optional(),
});
export type CoachingItem = z.infer<typeof CoachingItemSchema>;

export const ReportSchema = z.object({
  generatedBy: z.enum(["ai", "dev"]),
  model: z.string().optional(),
  createdAt: z.number(),
  /** Model-written feedback. Null in development mode or if generation failed. */
  ai: AiFeedbackSchema.nullable(),
  /** Why `ai` is null, shown to the student. */
  aiUnavailableReason: z.string().optional(),
  /** Rule-based observations computed from metrics (never from a model). */
  speechNotes: z.array(z.string()),
  bodyLanguageNotes: z.array(z.string()),
  /** Rule-based coaching computed from measurements (optional so older saved sessions still load). */
  /** "Instead of this, say it like this" examples, from the AI when available, otherwise worked out from the student's own words. */
  sayItBetter: z
    .array(z.object({ said: z.string(), better: z.string(), why: z.string(), source: z.enum(["ai", "rule"]) }))
    .optional(),
  readingCoaching: z.array(CoachingItemSchema).optional(),
  answerCoaching: z.array(CoachingItemSchema).optional(),
  bodyLanguageCoaching: z.array(CoachingItemSchema).optional(),
  /** Rule-based exercises used when `ai` is null. */
  fallbackExercises: z.array(z.object({ title: z.string(), instructions: z.string(), minutes: z.number() })),
});
export type Report = z.infer<typeof ReportSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  moduleId: z.string(),
  field: FieldIdSchema,
  level: LevelSchema,
  goal: GoalSchema,
  mode: z.enum(["live", "dev"]),
  /** Active practice time in seconds (counts toward the 20-minute daily limit). */
  durationSec: z.number().min(0),
  readingSec: z.number().min(0),
  conversationSec: z.number().min(0),
  completed: z.boolean(),
  reading: ReadingResultSchema,
  turns: z.array(TurnSchema),
  transcriptKept: z.boolean(),
  speech: SpeechMetricsSchema,
  vision: VisionMetricsSchema.nullable(),
  report: ReportSchema,
});
export type Session = z.infer<typeof SessionSchema>;

// ---------- Coach API ----------

export const CoachTurnRequestSchema = z.object({
  moduleId: z.string().max(80),
  goal: GoalSchema,
  level: LevelSchema,
  ageBand: AgeBandSchema,
  /** Seconds remaining in the conversation (lets the coach wrap up). */
  remainingSec: z.number().min(0).max(3600),
  /** Alternate roles; the last message is from the student, or absent for the opening. */
  history: z
    .array(z.object({ role: z.enum(["coach", "student"]), text: z.string().max(2000) }))
    .max(40),
  /** Signals from the client: silence, unclear speech, etc. */
  event: z.enum(["answer", "silence", "unclear", "start"]).default("answer"),
});
export type CoachTurnRequest = z.infer<typeof CoachTurnRequestSchema>;

export const CoachTurnResponseSchema = z.object({
  text: z.string(),
  mode: z.enum(["live", "dev"]),
  /** True when the coach is closing the conversation. */
  wrapUp: z.boolean(),
  /** True when live AI was expected but failed, so a scripted reply was used instead. */
  degraded: z.boolean().optional(),
});
export type CoachTurnResponse = z.infer<typeof CoachTurnResponseSchema>;

export const ReportRequestSchema = z.object({
  moduleId: z.string().max(80),
  goal: GoalSchema,
  level: LevelSchema,
  ageBand: AgeBandSchema,
  turns: z
    .array(
      z.object({
        role: z.enum(["coach", "student"]),
        text: z.string().max(2000),
        inputMode: z.enum(["voice", "typed"]).optional(),
      }),
    )
    .max(60),
  /** Computed client-side; passed so the model can reference real numbers. */
  speech: SpeechMetricsSchema,
  readingAloud: ReadingResultSchema.shape.aloud,
  readingMode: z.enum(["silent", "aloud"]).optional(),
  readingSec: z.number().min(0).max(7200).optional(),
  passageWords: z.number().int().min(0).max(2000).optional(),
});
export type ReportRequest = z.infer<typeof ReportRequestSchema>;
