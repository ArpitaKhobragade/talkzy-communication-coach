// Browser only. Sends each finished session (numbers and the written report) to the college admin, once.
import { getModule } from "@/features/content/modules";
import { buildReportDocument } from "@/features/report/export";
import type { ProgressSubmission } from "@/features/admin/types";
import type { Session } from "@/features/session/types";
import { getProfile, getSessions } from "./storage";

const ID_KEY = "acc.v1.studentId";
const SYNCED_KEY = "acc.v1.synced";
const MAX_PER_RUN = 10;

function newStudentId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** A random number that stays on this device. It tells the admin which sessions belong to the same student. */
export function getStudentId(): string {
  try {
    const kept = window.localStorage.getItem(ID_KEY);
    if (kept && /^[A-Za-z0-9-]{8,64}$/.test(kept)) return kept;
    const id = newStudentId();
    window.localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return newStudentId();
  }
}

function readSynced(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SYNCED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSynced(ids: Set<string>): void {
  try {
    window.localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids].slice(-300)));
  } catch {
    /* it is sent again next time, and the admin's copy is replaced, not doubled */
  }
}

/** What is sent for one session. */
export function buildSubmission(studentId: string, name: string, s: Session): ProgressSubmission {
  const blocks = buildReportDocument(s, { displayName: name });
  const headline = blocks.find((b) => b.t === "p");
  return {
    studentId,
    name,
    session: {
      id: s.id,
      startedAt: s.startedAt,
      durationSec: Math.round(s.durationSec),
      moduleId: s.moduleId,
      moduleTitle: getModule(s.moduleId)?.title ?? s.moduleId,
      level: s.level,
      goal: s.goal,
      completed: s.completed,
      cameraOn: !!s.cameraOn,
      wpm: s.speech.wpm ?? null,
      fillerPer100: s.speech.fillerPer100 ?? null,
      avgAnswerWords: s.speech.avgAnswerWords ?? null,
      headline: headline && headline.t === "p" ? headline.text.slice(0, 300) : "",
    },
    report: blocks.filter((b): b is Exclude<typeof b, { t: "link" }> => b.t !== "link"),
  };
}

let running = false;

/** Sends the sessions the admin has not received yet. Safe to call often; it does nothing when there is nothing new or no connection. */
export async function syncProgress(): Promise<void> {
  if (typeof window === "undefined" || running) return;
  const profile = getProfile();
  if (!profile) return;
  const done = readSynced();
  const todo = getSessions()
    // Every session is sent, also a short one (the admin sees it marked as short), so a student who tried it once still appears.
    .filter((s) => !done.has(s.id))
    .slice(0, MAX_PER_RUN);
  if (!todo.length) return;
  running = true;
  try {
    const studentId = getStudentId();
    for (const s of todo) {
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSubmission(studentId, profile.displayName, s)),
      });
      if (res.ok || res.status === 400 || res.status === 413) done.add(s.id); // a refused session is not sent again and again
      else break;
    }
  } catch {
    /* offline: tried again next time */
  } finally {
    writeSynced(done);
    running = false;
  }
}
