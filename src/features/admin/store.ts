// SERVER ONLY. The college admin's copy of the students' progress.
import type { ProgressSubmission, SessionSummary, StudentRecord } from "./types";

/*
 * Where the students' progress is kept:
 *  - "database": a Redis database reached over HTTPS (Upstash Redis, which Vercel offers in its Marketplace). The two settings are
 *    UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or the older KV_REST_API_URL and KV_REST_API_TOKEN).
 *  - "memory": when no database is set up (for example on a developer's computer, or in the tests). It is forgotten when the server restarts.
 */

export interface Store {
  kind: "database" | "memory";
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string): Promise<void>;
  sadd(set: string, member: string): Promise<void>;
  smembers(set: string): Promise<string[]>;
}

const STUDENTS = "talkzy:students";
const studentKey = (id: string) => `talkzy:student:${id}`;
const reportKey = (id: string, sessionId: string) => `talkzy:report:${id}:${sessionId}`;
const MAX_SESSIONS_PER_STUDENT = 200;

function redisStore(url: string, token: string): Store {
  async function cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`database_http_${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (json.error) throw new Error("database_error");
    return json.result;
  }
  return {
    kind: "database",
    get: async (key) => ((await cmd(["GET", key])) as string | null) ?? null,
    mget: async (keys) => (keys.length ? (((await cmd(["MGET", ...keys])) as (string | null)[]) ?? []) : []),
    set: async (key, value) => void (await cmd(["SET", key, value])),
    sadd: async (set, member) => void (await cmd(["SADD", set, member])),
    smembers: async (set) => ((await cmd(["SMEMBERS", set])) as string[]) ?? [],
  };
}

function memoryStore(): Store {
  const g = globalThis as unknown as { __talkzyMemory?: { kv: Map<string, string>; sets: Map<string, Set<string>> } };
  const mem = (g.__talkzyMemory ??= { kv: new Map(), sets: new Map() });
  return {
    kind: "memory",
    get: async (key) => mem.kv.get(key) ?? null,
    mget: async (keys) => keys.map((k) => mem.kv.get(k) ?? null),
    set: async (key, value) => void mem.kv.set(key, value),
    sadd: async (set, member) => void (mem.sets.get(set) ?? mem.sets.set(set, new Set()).get(set)!).add(member),
    smembers: async (set) => [...(mem.sets.get(set) ?? [])],
  };
}

export function getStore(): Store {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? redisStore(url.replace(/\/$/, ""), token) : memoryStore();
}

function parseRecord(raw: string | null): StudentRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as StudentRecord;
    return r && typeof r.studentId === "string" && Array.isArray(r.sessions) ? r : null;
  } catch {
    return null;
  }
}

/** Adds (or replaces) one finished session of one student, and keeps the report next to it. */
export async function recordProgress(store: Store, sub: ProgressSubmission): Promise<void> {
  const now = Date.now();
  const existing = parseRecord(await store.get(studentKey(sub.studentId)));
  const others = (existing?.sessions ?? []).filter((s) => s.id !== sub.session.id);
  const sessions: SessionSummary[] = [sub.session, ...others].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_SESSIONS_PER_STUDENT);
  const record: StudentRecord = {
    studentId: sub.studentId,
    name: sub.name,
    createdAt: existing?.createdAt ?? now,
    lastSeen: now,
    sessions,
  };
  await store.set(reportKey(sub.studentId, sub.session.id), JSON.stringify(sub.report));
  await store.set(studentKey(sub.studentId), JSON.stringify(record));
  await store.sadd(STUDENTS, sub.studentId);
}

export async function listStudents(store: Store): Promise<StudentRecord[]> {
  const ids = await store.smembers(STUDENTS);
  const raws = await store.mget(ids.map(studentKey));
  return raws
    .map(parseRecord)
    .filter((r): r is StudentRecord => r !== null)
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

export async function getReport(store: Store, studentId: string, sessionId: string): Promise<{ name: string; blocks: unknown } | null> {
  const [rec, raw] = await Promise.all([store.get(studentKey(studentId)), store.get(reportKey(studentId, sessionId))]);
  const record = parseRecord(rec);
  if (!record || !raw) return null;
  try {
    return { name: record.name, blocks: JSON.parse(raw) };
  } catch {
    return null;
  }
}
