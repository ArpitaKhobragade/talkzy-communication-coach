import { z } from "zod";
import { clientKey, rateLimit } from "./rate-limit";

const MAX_BODY_BYTES = 200_000;

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ error: code, message, ...extra }, { status });
}

/**
 * Browsers always send an Origin header on cross-site POSTs. If it names a different host than this
 * request, refuse: the AI and voice routes spend paid API keys and must only serve this app's pages.
 * Requests with no Origin (curl, server-to-server, tests) are allowed and still rate-limited.
 */
export function crossSiteRejection(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return null;
  } catch {
    /* fall through */
  }
  return jsonError(403, "cross_site", "This request is not allowed from another site.");
}

function limited(req: Request, bucket: string, limitPerMinute: number): Response | null {
  const rl = rateLimit(`${bucket}:${clientKey(req)}`, limitPerMinute, 60_000);
  if (rl.ok) return null;
  return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", { retryAfterSec: rl.retryAfterSec });
}

/** Rate-limit, size-check and zod-validate a JSON POST body. Returns data or a ready Response. */
export async function parseRequest<T extends z.ZodType>(
  req: Request,
  schema: T,
  bucket: string,
  limitPerMinute: number,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  const blocked = crossSiteRejection(req) ?? limited(req, bucket, limitPerMinute);
  if (blocked) return { response: blocked };
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return { response: jsonError(415, "bad_content_type", "Expected application/json.") };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { response: jsonError(400, "bad_body", "Could not read the request.") };
  }
  if (text.length > MAX_BODY_BYTES) return { response: jsonError(413, "too_large", "Request is too large.") };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { response: jsonError(400, "bad_json", "Request is not valid JSON.") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { response: jsonError(400, "invalid_request", "Request did not match the expected format.") };
  return { data: parsed.data };
}

/** Same protections for a raw binary upload (audio). */
export async function parseBinaryRequest(
  req: Request,
  opts: { bucket: string; limitPerMinute: number; contentType: string; maxBytes: number },
): Promise<{ data: ArrayBuffer } | { response: Response }> {
  const blocked = crossSiteRejection(req) ?? limited(req, opts.bucket, opts.limitPerMinute);
  if (blocked) return { response: blocked };
  if (!req.headers.get("content-type")?.startsWith(opts.contentType)) {
    return { response: jsonError(415, "bad_content_type", `Expected ${opts.contentType}.`) };
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > opts.maxBytes) return { response: jsonError(413, "too_large", "Audio is too large.") };
  let data: ArrayBuffer;
  try {
    data = await req.arrayBuffer();
  } catch {
    return { response: jsonError(400, "bad_body", "Could not read the audio.") };
  }
  if (data.byteLength > opts.maxBytes) return { response: jsonError(413, "too_large", "Audio is too large.") };
  if (data.byteLength < 1000) return { response: jsonError(400, "too_short", "Audio is too short.") };
  return { data };
}
