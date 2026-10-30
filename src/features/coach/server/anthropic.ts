// SERVER ONLY. Never import from client components: it reads the API key.
import Anthropic from "@anthropic-ai/sdk";

/** Fast model for the spoken conversation (latency matters). */
export function chatModel(): string {
  return process.env.ANTHROPIC_CHAT_MODEL?.trim() || "claude-haiku-5-5";
}

/** Stronger model for the post-session report. */
export function reportModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
  return client;
}
