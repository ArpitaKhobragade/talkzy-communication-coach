// Device-local storage (see docs/DECISIONS.md #2). Browser-only: every function is a safe
// no-op / returns an empty value on the server or if storage is blocked.
import {
  DEFAULT_SETTINGS,
  ProfileSchema,
  SessionSchema,
  SettingsSchema,
  type Profile,
  type Session,
  type Settings,
} from "@/features/session/types";

const KEYS = {
  profile: "acc.v1.profile",
  settings: "acc.v1.settings",
  sessions: "acc.v1.sessions",
} as const;

const CHANGE_EVENT = "acc:change";
const MAX_SESSIONS = 200;

function read(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Snapshot caches keep object identity stable between reads (required by useSyncExternalStore).
let profileCache: { raw: string | null; value: Profile | null } = { raw: null, value: null };
let settingsCache: { raw: string | null; value: Settings } = { raw: null, value: DEFAULT_SETTINGS };
let sessionsCache: { raw: string | null; memory: number; value: Session[] } = { raw: null, memory: 0, value: [] };

/**
 * Sessions the browser would not store (its storage was full or blocked). They are kept here, in memory, so the report can still
 * be opened and downloaded in this tab. They are gone when the tab is closed.
 */
let memoryOnly: Session[] = [];
let memoryVersion = 0;

export function getProfile(): Profile | null {
  const raw = read(KEYS.profile);
  if (raw === profileCache.raw) return profileCache.value;
  const parsed = ProfileSchema.safeParse(parseJson(raw));
  profileCache = { raw, value: parsed.success ? parsed.data : null };
  return profileCache.value;
}

export function saveProfile(profile: Profile): boolean {
  return write(KEYS.profile, JSON.stringify(ProfileSchema.parse(profile)));
}

export function getSettings(): Settings {
  const raw = read(KEYS.settings);
  if (raw === settingsCache.raw) return settingsCache.value;
  const parsed = SettingsSchema.safeParse(parseJson(raw));
  // English (India) is the only accent: older saved choices are ignored.
  settingsCache = { raw, value: parsed.success ? { ...parsed.data, speechLang: "en-IN" } : DEFAULT_SETTINGS };
  return settingsCache.value;
}

export function saveSettings(settings: Settings): boolean {
  return write(KEYS.settings, JSON.stringify(SettingsSchema.parse(settings)));
}

function storedSessions(raw: string | null): Session[] {
  const data = parseJson(raw);
  const out: Session[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      const parsed = SessionSchema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out;
}

/** Sessions newest first. Corrupt entries are skipped rather than losing everything. */
export function getSessions(): Session[] {
  const raw = read(KEYS.sessions);
  if (raw === sessionsCache.raw && memoryVersion === sessionsCache.memory) return sessionsCache.value;
  const out = storedSessions(raw);
  const ids = new Set(out.map((s) => s.id));
  for (const s of memoryOnly) if (!ids.has(s.id)) out.push(s);
  out.sort((a, b) => b.startedAt - a.startedAt);
  sessionsCache = { raw, memory: memoryVersion, value: out };
  return out;
}

/** True when this session is only kept in memory (the browser would not store it), so it is lost when the tab is closed. */
export function isUnsaved(id: string): boolean {
  return memoryOnly.some((s) => s.id === id);
}

export function getSession(id: string): Session | undefined {
  return getSessions().find((s) => s.id === id);
}

/**
 * Saves a session together with all the older ones. Nothing is ever deleted behind the student's back: if the browser has no room,
 * "full" is returned and the student chooses which old sessions to delete (or opens the report without saving it).
 */
export function trySaveSession(session: Session): "saved" | "full" {
  const parsed = SessionSchema.parse(session);
  const others = storedSessions(read(KEYS.sessions)).filter((s) => s.id !== parsed.id).sort((a, b) => b.startedAt - a.startedAt);
  if (!write(KEYS.sessions, JSON.stringify([parsed, ...others.slice(0, MAX_SESSIONS - 1)]))) return "full";
  memoryOnly = memoryOnly.filter((s) => s.id !== parsed.id);
  memoryVersion++;
  return "saved";
}

/**
 * Keeps a session in memory for this tab only (the student chose to open the report without making room). `isUnsaved` says so, and
 * the session is gone when the tab is closed. Returns false only if it cannot even be kept.
 */
export function keepInMemory(session: Session): boolean {
  if (typeof window === "undefined") return false;
  const parsed = SessionSchema.parse(session);
  memoryOnly = [parsed, ...memoryOnly.filter((s) => s.id !== parsed.id)].slice(0, 5);
  memoryVersion++;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

/** Deletes every saved session (the profile and settings stay). */
export function deleteAllSessions(): boolean {
  return write(KEYS.sessions, null);
}

export function deleteSession(id: string): boolean {
  return write(KEYS.sessions, JSON.stringify(getSessions().filter((s) => s.id !== id)));
}

/** Remove saved transcripts from every session (reports and metrics are kept). */
export function clearAllTranscripts(): boolean {
  const next = getSessions().map((s) => ({ ...s, turns: [], transcriptKept: false }));
  return write(KEYS.sessions, JSON.stringify(next));
}

/** Delete every piece of data this app stores on the device. */
export function deleteAllData(): void {
  write(KEYS.sessions, null);
  write(KEYS.settings, null);
  write(KEYS.profile, null);
}

export function exportAllData(): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), profile: getProfile(), settings: getSettings(), sessions: getSessions() },
    null,
    2,
  );
}

export function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
