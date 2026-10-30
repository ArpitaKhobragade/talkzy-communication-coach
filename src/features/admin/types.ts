import { z } from "zod";

/*
 * What a student's device sends to the college admin after a session: the student's name, a few numbers about the session, and the
 * written report as a list of blocks (the same blocks that make the PDF). It never contains the voice, the video or the transcript.
 */

const short = (n: number) => z.string().max(n);

/** The report blocks the admin can turn into a PDF. (No links: the report has none, and the admin should never open one.) */
export const ReportBlockSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("title"), text: short(200) }),
  z.object({ t: z.literal("meta"), text: short(200) }),
  z.object({ t: z.literal("h2"), text: short(200) }),
  z.object({ t: z.literal("p"), text: short(1500) }),
  z.object({ t: z.literal("bullet"), text: short(1500), topic: short(300).optional(), how: short(1500).optional() }),
  z.object({ t: z.literal("compare"), said: short(600), better: short(600) }),
]);

const num = z.number().finite();

export const SessionSummarySchema = z.object({
  id: short(80),
  startedAt: num,
  durationSec: num.min(0).max(36_000),
  moduleId: short(100),
  moduleTitle: short(200),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  goal: short(30),
  completed: z.boolean(),
  cameraOn: z.boolean(),
  wpm: num.nullable(),
  fillerPer100: num.nullable(),
  avgAnswerWords: num.nullable(),
  headline: short(300),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const STUDENT_ID = /^[A-Za-z0-9-]{8,64}$/;
export const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;

export const ProgressSubmissionSchema = z.object({
  studentId: z.string().regex(STUDENT_ID),
  name: z.string().trim().min(1).max(60),
  session: SessionSummarySchema,
  report: z.array(ReportBlockSchema).max(120),
});
export type ProgressSubmission = z.infer<typeof ProgressSubmissionSchema>;

/** What the admin page shows for one student. */
export interface StudentRecord {
  studentId: string;
  name: string;
  createdAt: number;
  lastSeen: number;
  /** Newest first. */
  sessions: SessionSummary[];
}
