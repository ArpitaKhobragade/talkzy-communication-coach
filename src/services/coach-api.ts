import {
  AiFeedbackSchema,
  CoachTurnResponseSchema,
  type AiFeedback,
  type CoachTurnRequest,
  type CoachTurnResponse,
  type ReportRequest,
} from "@/features/session/types";

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Throws on network/validation failure; callers fall back to a local scripted reply. */
export async function requestCoachTurn(body: CoachTurnRequest): Promise<CoachTurnResponse> {
  return CoachTurnResponseSchema.parse(await postJson("/api/coach/turn", body, 25_000));
}

export interface ReportResult {
  ai: AiFeedback | null;
  reason?: string;
  model?: string;
}

export async function requestReport(body: ReportRequest): Promise<ReportResult> {
  try {
    const data = (await postJson("/api/coach/report", body, 40_000)) as { ai?: unknown; reason?: string; model?: string };
    const ai = data.ai ? AiFeedbackSchema.safeParse(data.ai) : null;
    if (ai?.success) return { ai: ai.data, model: data.model };
    return { ai: null, reason: data.reason ?? "The written feedback could not be generated this time." };
  } catch {
    return { ai: null, reason: "We could not reach the feedback service. Your measured results are shown below." };
  }
}
