import { isAdminRequest } from "@/features/admin/auth";
import { getStore, listStudents } from "@/features/admin/store";

export const dynamic = "force-dynamic";

/** Every student with their sessions. Only for a signed-in admin. */
export async function GET() {
  if (!(await isAdminRequest())) return Response.json({ error: "sign_in" }, { status: 401 });
  try {
    const store = getStore();
    return Response.json({ storage: store.kind, students: await listStudents(store) });
  } catch {
    return Response.json({ error: "store_failed" }, { status: 502 });
  }
}
