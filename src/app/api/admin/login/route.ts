import { cookies } from "next/headers";
import { z } from "zod";
import { ADMIN_COOKIE, adminPassword, clearAttempts, cookieOptions, isAdminRequest, makeToken, noteFailedAttempt, passwordMatches, tooManyAttempts } from "@/features/admin/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(200) });

const who = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

/** Asks whether the visitor is signed in, and whether the admin panel is set up at all. */
export async function GET() {
  return Response.json({ configured: !!adminPassword(), signedIn: await isAdminRequest() });
}

export async function POST(req: Request) {
  if (!adminPassword()) return Response.json({ error: "not_configured" }, { status: 503 });
  const key = who(req);
  if (tooManyAttempts(key)) return Response.json({ error: "too_many_attempts" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !passwordMatches(parsed.data.password)) {
    noteFailedAttempt(key);
    return Response.json({ error: "wrong_password" }, { status: 401 });
  }
  clearAttempts(key);
  (await cookies()).set(ADMIN_COOKIE, makeToken(), cookieOptions(process.env.NODE_ENV === "production" && new URL(req.url).protocol === "https:"));
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
}
