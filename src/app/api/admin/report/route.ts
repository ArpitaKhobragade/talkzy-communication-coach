import { isAdminRequest } from "@/features/admin/auth";
import { getReport, getStore } from "@/features/admin/store";
import { ReportBlockSchema, SESSION_ID, STUDENT_ID } from "@/features/admin/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** One student's report for one session, as blocks the admin page turns into a PDF. Only for a signed-in admin. */
export async function GET(req: Request) {
  if (!(await isAdminRequest())) return Response.json({ error: "sign_in" }, { status: 401 });
  const url = new URL(req.url);
  const studentId = url.searchParams.get("studentId") ?? "";
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!STUDENT_ID.test(studentId) || !SESSION_ID.test(sessionId)) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const found = await getReport(getStore(), studentId, sessionId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    const blocks = z.array(ReportBlockSchema).safeParse(found.blocks);
    if (!blocks.success) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ name: found.name, blocks: blocks.data });
  } catch {
    return Response.json({ error: "store_failed" }, { status: 502 });
  }
}
