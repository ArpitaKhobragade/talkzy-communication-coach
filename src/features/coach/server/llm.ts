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

export function groqModel(): string {
  return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
}

const groqBase = () => (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "");

interface GroqResponse {
  choices?: { message?: { content?: string | null } }[];
}

async function generateGroq(req: LlmRequest): Promise<LlmResult> {
  const model = groqModel();
  const res = await fetch(`${groqBase()}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      // gpt-oss spends part of the budget on hidden reasoning, so leave headroom for the answer.
      max_completion_tokens: req.maxTokens,
      reasoning_effort: req.purpose === "chat" ? "low" : "medium",
      include_reasoning: false,
      temperature: req.purpose === "chat" ? 0.7 : 0.4,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`groq_http_${res.status}`);
  const data = (await res.json()) as GroqResponse;
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("groq_empty_reply");
  return { text, model };
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
