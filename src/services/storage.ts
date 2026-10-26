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
let sessionsCache: { raw: string | null; value: Session[] } = { raw: null, value: [] };

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
  settingsCache = { raw, value: parsed.success ? parsed.data : DEFAULT_SETTINGS };
  return settingsCache.value;
}

export function saveSettings(settings: Settings): boolean {
  return write(KEYS.settings, JSON.stringify(SettingsSchema.parse(settings)));
}

/** Sessions newest first. Corrupt entries are skipped rather than losing everything. */
export function getSessions(): Session[] {
  const raw = read(KEYS.sessions);
  if (raw === sessionsCache.raw) return sessionsCache.value;
  const data = parseJson(raw);
  const out: Session[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      const parsed = SessionSchema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  sessionsCache = { raw, value: out };
  return out;
}

export function getSession(id: string): Session | undefined {
  return getSessions().find((s) => s.id === id);
}

export function saveSession(session: Session): boolean {
  const parsed = SessionSchema.parse(session);
  const others = getSessions().filter((s) => s.id !== parsed.id);
  const next = [parsed, ...others].slice(0, MAX_SESSIONS);
  return write(KEYS.sessions, JSON.stringify(next));
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
