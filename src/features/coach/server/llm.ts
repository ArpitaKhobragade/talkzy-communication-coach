// SERVER ONLY. One place that talks to whichever LLM is configured (Groq or Anthropic).
// Never import from client components: it reads API keys.
import { chatModel, getClient, reportModel } from "./anthropic";

export type LlmProvider = "groq" | "anthropic";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** "chat" favours speed (spoken conversation); "report" favours quality. */
  purpose: "chat" | "report";
}

export interface LlmResult {
  text: string;
  model: string;
}

const has = (name: string) => Boolean(process.env[name]?.trim());

/** LLM_PROVIDER wins if set and its key exists; otherwise Groq, then Anthropic, by which key is present. */
export function activeProvider(): LlmProvider | null {
  const want = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (want === "groq" && has("GROQ_API_KEY")) return "groq";
  if (want === "anthropic" && has("ANTHROPIC_API_KEY")) return "anthropic";
  if (has("GROQ_API_KEY")) return "groq";
  if (has("ANTHROPIC_API_KEY")) return "anthropic";
  return null;
}

/** True when a real LLM is configured. Otherwise the app runs in development mode. */
export function isLiveMode(): boolean {
  return activeProvider() !== null;
}

/**
 * Groq counts tokens per model, per minute and per day, so the two jobs use two models and each has its own
 * allowance. The spoken conversation needs speed and short replies, so it uses the smaller model
 * (GROQ_CHAT_MODELS). The written report needs to be accurate and honest: in our quality check the small
 * model missed mistakes and invented problems, so the report keeps the larger one (GROQ_REPORT_MODEL,
 * or GROQ_MODEL for older setups).
 */
export function groqModel(purpose: "chat" | "report" = "report"): string {
  if (purpose === "chat") return groqChatModels()[0];
  return process.env.GROQ_REPORT_MODEL?.trim() || process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
}

const groqBase = () => (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "");

interface GroqResponse {
  choices?: { message?: { content?: string | null } }[];
}

/** How long Groq asks us to wait before trying again (seconds), kept short so a student is not left waiting. */
function retryDelayMs(res: Response): number {
  const secs = Number(res.headers.get("retry-after"));
  const ms = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 3000;
  return Math.min(ms, 8000);
}

/** The model the spoken conversation uses first: the most natural talker we tested, and fast. */
const DEFAULT_CHAT_MODEL = "qwen/qwen3.8-27b";
/** The value older setups had written into GROQ_CHAT_MODEL (it was the old default, so it is not a deliberate choice). */
const OLD_DEFAULT_CHAT_MODEL = "openai/gpt-oss-20b";

/**
 * The models the spoken conversation may use, best first. Groq counts tokens per model per minute, so when the first one is at its
 * limit the next one answers at once instead of the student waiting. GROQ_CHAT_MODELS (comma separated) sets the whole list; a
 * deliberate GROQ_CHAT_MODEL is put first.
 */
export function groqChatModels(): string[] {
  const listed = (process.env.GROQ_CHAT_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const own = process.env.GROQ_CHAT_MODEL?.trim();
  const first = own && own !== OLD_DEFAULT_CHAT_MODEL ? own : DEFAULT_CHAT_MODEL;
  const all = listed.length ? listed : [first, "openai/gpt-oss-20b", "openai/gpt-oss-120b"];
  return [...new Set(all)];
}

/** One model, with a short wait and retry when it is not the last choice there is. */
async function generateGroqWith(model: string, req: LlmRequest, mayWait: boolean): Promise<LlmResult> {
  const body = JSON.stringify({
    model,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    max_completion_tokens: req.maxTokens,
    // These models think before they answer, which is slow for a spoken conversation: gpt-oss is kept to a little thinking (so leave
    // headroom for the answer) and Qwen to none.
    ...(model.includes("gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : model.includes("qwen") ? { reasoning_effort: "none" } : {}),
    temperature: req.purpose === "chat" ? 0.7 : 0.4,
  });
  // Groq limits how many tokens a key can use per minute. When several students finish at the same
  // moment the limit can be hit (HTTP 429); waiting a few seconds and asking again almost always works.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${groqBase()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body,
      signal: AbortSignal.timeout(45_000),
    });
    // A short wait fixes the per-minute limit. If Groq says to wait much longer (the daily allowance is
    // used up), waiting here would only leave the student staring at the screen, so fail at once.
    const retryAfterSec = Number(res.headers.get("retry-after"));
    const longWait = Number.isFinite(retryAfterSec) && retryAfterSec > 20;
    if ((res.status === 429 || res.status >= 500) && attempt < 2 && !longWait && mayWait) {
      await new Promise((r) => setTimeout(r, retryDelayMs(res)));
      continue;
    }
    if (!res.ok) throw new Error(`groq_http_${res.status}`);
    const data = (await res.json()) as GroqResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("groq_empty_reply");
    return { text, model };
  }
}

/** A model that just refused (at its limit, or not available) is skipped for a little while, so the next one answers without a wasted try. */
const skipUntil = new Map<string, number>();

/** Forget which models were skipped (used by tests). */
export function resetGroqSkips(): void {
  skipUntil.clear();
}

async function generateGroq(req: LlmRequest): Promise<LlmResult> {
  const models = req.purpose === "chat" ? groqChatModels() : [groqModel("report")];
  let lastError: unknown = new Error("groq_failed");
  for (let i = 0; i < models.length; i++) {
    const last = i === models.length - 1;
    if (!last && Date.now() < (skipUntil.get(models[i]) ?? 0)) continue;
    try {
      // Only the last choice waits and retries: before that, a model at its limit hands over to the next one straight away.
      return await generateGroqWith(models[i], req, last);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : "";
      if (!last) skipUntil.set(models[i], Date.now() + (msg.endsWith("_404") ? 60 * 60_000 : msg.endsWith("_429") ? 12_000 : 0));
    }
  }
  throw lastError;
}

async function generateAnthropic(req: LlmRequest): Promise<LlmResult> {
  const model = req.purpose === "chat" ? chatModel() : reportModel();
  const msg = await getClient().messages.create({
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").trim();
  if (!text) throw new Error("anthropic_empty_reply");
  return { text, model };
}

/** Throws on any failure; callers decide how to degrade (scripted coach, no AI feedback). */
export async function generate(req: LlmRequest): Promise<LlmResult> {
  const provider = activeProvider();
  if (provider === "groq") return generateGroq(req);
  if (provider === "anthropic") return generateAnthropic(req);
  throw new Error("no_llm_configured");
}
