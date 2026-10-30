// SERVER ONLY. Who may open the admin panel: someone who knows the admin password (the ADMIN_PASSWORD setting).
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "talkzy_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

/** The admin password from the server settings. It must be at least 8 characters, or the admin panel stays closed. */
export function adminPassword(): string | undefined {
  const p = process.env.ADMIN_PASSWORD?.trim();
  return p && p.length >= 8 ? p : undefined;
}

const secret = () => process.env.ADMIN_SESSION_SECRET?.trim() || `talkzy-admin:${adminPassword() ?? ""}`;
const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

const sameText = (a: string, b: string) => {
  const x = createHmac("sha256", "cmp").update(a).digest();
  const y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
};

export const passwordMatches = (input: string): boolean => {
  const p = adminPassword();
  return !!p && sameText(input, p);
};

export function makeToken(now = Date.now()): string {
  const exp = String(now + SESSION_MS);
  return `${exp}.${sign(exp)}`;
}

export function tokenIsValid(token: string | undefined, now = Date.now()): boolean {
  if (!token || !adminPassword()) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return sameText(sig, sign(exp));
}

export async function isAdminRequest(): Promise<boolean> {
  return tokenIsValid((await cookies()).get(ADMIN_COOKIE)?.value);
}

export const cookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "strict" as const, secure, path: "/", maxAge: SESSION_MS / 1000 });

// A few wrong passwords from one address are allowed, then it must wait. Best effort: it is kept in the server's memory.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

export function tooManyAttempts(key: string, now = Date.now()): boolean {
  const a = attempts.get(key);
  return !!a && a.resetAt > now && a.count >= MAX_ATTEMPTS;
}

export function noteFailedAttempt(key: string, now = Date.now()): void {
  const a = attempts.get(key);
  if (!a || a.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else a.count++;
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
