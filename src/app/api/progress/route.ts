import { getStore, recordProgress } from "@/features/admin/store";
import { ProgressSubmissionSchema } from "@/features/admin/types";

export const dynamic = "force-dynamic";

const MAX_BODY = 200_000;

/** A student's device sends one finished session (numbers and the written report, never voice, video or transcript) to the college admin. */
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const parsed = ProgressSubmissionSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const store = getStore();
    await recordProgress(store, parsed.data);
    return Response.json({ ok: true, stored: store.kind });
  } catch {
    return Response.json({ error: "store_failed" }, { status: 502 });
  }
}
