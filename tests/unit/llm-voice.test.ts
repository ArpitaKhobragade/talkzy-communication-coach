import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeProvider, generate, isLiveMode } from "@/features/coach/server/llm";
import { synthesizeSpeech, transcribeSegment } from "@/features/coach/server/voice";
import { POST as sttPost } from "@/app/api/voice/stt/route";
import { GET as ttsCheck, POST as ttsPost } from "@/app/api/voice/tts/route";
import { GET as statusGet } from "@/app/api/status/route";

// No real service is called: global fetch is replaced with a stub in every test.
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const k of ["GROQ_API_KEY", "ANTHROPIC_API_KEY", "LLM_PROVIDER", "SARVAM_API_KEY", "CARTESIA_API_KEY", "CARTESIA_VOICE_ID", "SARVAM_STT_MODEL"]) {
    vi.stubEnv(k, "");
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let ip = 0;
const wavBytes = () => new Uint8Array(4000).fill(7);
const sttRequest = (over: { headers?: Record<string, string>; body?: Uint8Array; url?: string } = {}) =>
  new Request(over.url ?? "http://localhost/api/voice/stt?module=computer-science-beginner", {
    method: "POST",
    headers: { "content-type": "audio/wav", "x-forwarded-for": `10.1.0.${++ip}`, ...over.headers },
    body: (over.body ?? wavBytes()) as BodyInit,
  });
const ttsRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${++ip}`, ...headers },
    body: JSON.stringify(body),
  });

describe("provider selection", () => {
  it("is in development mode with no keys", () => {
    expect(activeProvider()).toBeNull();
    expect(isLiveMode()).toBe(false);
  });
  it("prefers Groq, falls back to Anthropic, and honours LLM_PROVIDER when its key exists", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    expect(activeProvider()).toBe("anthropic");
    vi.stubEnv("GROQ_API_KEY", "g");
    expect(activeProvider()).toBe("groq");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    expect(activeProvider()).toBe("anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(activeProvider()).toBe("groq"); // requested provider has no key
  });
});

describe("Groq (gpt-oss)", () => {
  it("sends an OpenAI-style request with reasoning hidden and a low effort for chat", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: " Hello there. " } }] }));
    const out = await generate({ purpose: "chat", system: "SYS", messages: [{ role: "user", content: "hi" }], maxTokens: 800 });
    expect(out).toEqual({ text: "Hello there.", model: "openai/gpt-oss-20b" }); // the conversation uses the smaller, faster model

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer gsk-test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 800,
    });
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("uses low reasoning for reports and throws on HTTP errors or empty replies", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    fetchMock.mockResolvedValueOnce(json({ choices: [{ message: { content: "{}" } }] }));
    await generate({ purpose: "report", system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 100 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe("low");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("openai/gpt-oss-120b"); // the report uses the larger model

    // The daily allowance is used up (Groq says to wait 15 minutes): fail at once instead of waiting.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "nope" }), { status: 429, headers: { "retry-after": "900" } }));
    await expect(generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 })).rejects.toThrow(/groq_http_429/);
    fetchMock.mockResolvedValueOnce(json({ choices: [{ message: { content: "" } }] }));
    await expect(generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 })).rejects.toThrow(/empty/);
  });
});

describe("Groq rate limits and models", () => {
  it("waits a moment and asks again when the per-minute limit is hit", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "1" } }));
    fetchMock.mockResolvedValueOnce(json({ choices: [{ message: { content: "ok after waiting" } }] }));
    const out = await generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 });
    expect(out.text).toBe("ok after waiting");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can use a separate model for the conversation and for the report", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    vi.stubEnv("GROQ_CHAT_MODEL", "chat-model");
    vi.stubEnv("GROQ_REPORT_MODEL", "report-model");
    fetchMock.mockImplementation(async () => json({ choices: [{ message: { content: "hi" } }] }));
    expect((await generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 })).model).toBe("chat-model");
    expect((await generate({ purpose: "report", system: "s", messages: [], maxTokens: 10 })).model).toBe("report-model");
  });
});

describe("Sarvam speech-to-text", () => {
  it("posts the WAV as multipart with the subscription-key header, language and key terms", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValue(json({ transcript: "  a program is a list of steps ", language_code: "en-IN" }));
    const text = await transcribeSegment(new Uint8Array(2000).buffer, ["debugging", "bug"]);
    expect(text).toBe("a program is a list of steps");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sarvam.ai/speech-to-text");
    expect(init.headers["api-subscription-key"]).toBe("sv-test");
    const form = init.body as FormData;
    expect(form.get("language_code")).toBe("en-IN");
    expect(form.get("keyterms")).toBe(JSON.stringify(["debugging", "bug"]));
    expect((form.get("file") as File).name).toBe("speech.wav");
    expect(form.has("model")).toBe(false); // service default unless SARVAM_STT_MODEL is set
  });

  it("asks for word-for-word text (with umm and haa) for a spoken answer, and falls back to the normal text if that is refused", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValueOnce(json({ transcript: "umm a program is haa a list" }));
    expect(await transcribeSegment(new Uint8Array(2000).buffer, ["debugging"], { verbatim: true })).toBe("umm a program is haa a list");
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBe("saaras:v3");
    expect(form.get("mode")).toBe("verbatim");
    expect(form.has("keyterms")).toBe(false); // key terms are not offered with this model

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json({ error: "no" }, 400)).mockResolvedValueOnce(json({ transcript: "a program is a list" }));
    expect(await transcribeSegment(new Uint8Array(2000).buffer, ["debugging"], { verbatim: true })).toBe("a program is a list");
    const second = fetchMock.mock.calls[1][1].body as FormData;
    expect(second.has("mode")).toBe(false);
    expect(second.get("keyterms")).toBe(JSON.stringify(["debugging"]));
  });

  it("does not ask for word-for-word text when SARVAM_VERBATIM is off", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    vi.stubEnv("SARVAM_VERBATIM", "off");
    fetchMock.mockResolvedValue(json({ transcript: "ok" }));
    await transcribeSegment(new Uint8Array(2000).buffer, [], { verbatim: true });
    expect((fetchMock.mock.calls[0][1].body as FormData).has("mode")).toBe(false);
  });

  it("retries once without key terms if Sarvam rejects the optional field", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValueOnce(json({ error: "bad keyterms" }, 422)).mockResolvedValueOnce(json({ transcript: "ok" }));
    expect(await transcribeSegment(new Uint8Array(2000).buffer, ["x"])).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1].body as FormData).has("keyterms")).toBe(false);
  });
});

describe("Cartesia text-to-speech", () => {
  it("requests sonic-3.6 MP3 with the configured voice ID and bearer auth", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk_car_test");
    vi.stubEnv("CARTESIA_VOICE_ID", "voice-123");
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    await synthesizeSpeech("Hello student", 0.95);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(init.headers.authorization).toBe("Bearer sk_car_test");
    expect(init.headers["cartesia-version"]).toBeTruthy();
    expect(JSON.parse(init.body)).toMatchObject({
      model_id: "sonic-3.6",
      transcript: "Hello student",
      voice: { id: "voice-123" },
      output_format: { container: "mp3" },
      language: "en",
      generation_config: { speed: 0.95 },
    });
  });
});

describe("POST /api/voice/stt", () => {
  it("is a clean 501 when Sarvam is not configured", async () => {
    expect((await sttPost(sttRequest())).status).toBe(501);
  });

  it("returns the transcript and passes the module's key terms", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValue(json({ transcript: "hello world" }));
    const res = await sttPost(sttRequest());
    expect(await res.json()).toEqual({ text: "hello world" });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(JSON.parse(form.get("keyterms") as string)).toContain("debugging");
  });

  it("rejects cross-site, wrong type, tiny and oversized uploads, and hides upstream failures", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    expect((await sttPost(sttRequest({ headers: { origin: "https://evil.example", host: "localhost" } }))).status).toBe(403);
    expect((await sttPost(sttRequest({ headers: { "content-type": "text/plain" } }))).status).toBe(415);
    expect((await sttPost(sttRequest({ body: new Uint8Array(10) }))).status).toBe(400);
    expect((await sttPost(sttRequest({ body: new Uint8Array(1_300_000) }))).status).toBe(413);

    fetchMock.mockResolvedValue(json({ error: { message: "secret detail" } }, 500));
    const res = await sttPost(sttRequest());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });

  it("allows same-origin browser requests", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValue(json({ transcript: "ok" }));
    const res = await sttPost(sttRequest({ headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/voice/tts", () => {
  it("is a clean 501 until both the Cartesia key and voice ID are set", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk");
    expect((await ttsPost(ttsRequest({ text: "hi" }))).status).toBe(501);
  });

  it("streams MP3 back and validates input", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk");
    vi.stubEnv("CARTESIA_VOICE_ID", "v");
    fetchMock.mockResolvedValue(new Response(new Uint8Array([9, 9, 9]), { status: 200 }));
    const ok = await ttsPost(ttsRequest({ text: "Hello", speed: 1 }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]));

    expect((await ttsPost(ttsRequest({ text: "" }))).status).toBe(400);
    expect((await ttsPost(ttsRequest({ text: "x".repeat(601) }))).status).toBe(400);
    expect((await ttsPost(ttsRequest({ text: "hi", speed: 3 }))).status).toBe(400);
    expect((await ttsPost(ttsRequest({ text: "hi" }, { origin: "https://evil.example", host: "localhost" }))).status).toBe(403);

    fetchMock.mockResolvedValue(new Response("x", { status: 401 }));
    expect((await ttsPost(ttsRequest({ text: "hi" }))).status).toBe(502);
  });
});

describe("GET /api/voice/tts?check=1 (the voice check)", () => {
  const check = () => ttsCheck(new Request("http://localhost/api/voice/tts?check=1", { headers: { "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` } }));

  it("says the voice is not set up when the key or voice ID is missing", async () => {
    const body = await (await check()).json();
    expect(body.ok).toBe(false);
    expect(body.hint).toMatch(/CARTESIA_API_KEY and CARTESIA_VOICE_ID/);
  });

  it("says the voice works when Cartesia answers", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk");
    vi.stubEnv("CARTESIA_VOICE_ID", "v");
    fetchMock.mockResolvedValue(new Response(new Uint8Array([9, 9, 9]), { status: 200 }));
    expect(await (await check()).json()).toEqual({ ok: true, hint: "The studio voice is working." });
  });

  it("says why it fails, without showing the key", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk-secret");
    vi.stubEnv("CARTESIA_VOICE_ID", "v");
    for (const [status, words] of [[401, /did not accept the API key/], [402, /run out of credit/], [404, /voice or the model/], [500, /problem on its side/]] as const) {
      fetchMock.mockResolvedValue(new Response("nope", { status }));
      const body = await (await check()).json();
      expect(body.ok).toBe(false);
      expect(body.hint).toMatch(words);
      expect(JSON.stringify(body)).not.toContain("sk-secret");
    }
  });

  it("says how many credits are left when Cartesia says the plan is used up", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk-secret");
    vi.stubEnv("CARTESIA_VOICE_ID", "v");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error_code: "quota_exceeded", message: "This request requires approximately 148 credits but you have 19 remaining. Please upgrade." }), { status: 402 }),
    );
    const body = await (await check()).json();
    expect(body.ok).toBe(false);
    expect(body.hint).toMatch(/19 credits are left/);
    expect(body.hint).toMatch(/about 148/);
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("only answers ?check=1", async () => {
    expect((await ttsCheck(new Request("http://localhost/api/voice/tts"))).status).toBe(400);
  });
});

describe("GET /api/status", () => {
  it("reports only service names, never keys", async () => {
    expect(await (await statusGet()).json()).toEqual({ mode: "dev", llm: null, stt: "browser", tts: "browser" });
    vi.stubEnv("GROQ_API_KEY", "gsk-secret");
    vi.stubEnv("SARVAM_API_KEY", "sv-secret");
    vi.stubEnv("CARTESIA_API_KEY", "ca-secret");
    vi.stubEnv("CARTESIA_VOICE_ID", "voice");
    const live = await (await statusGet()).json();
    expect(live).toEqual({ mode: "live", llm: "groq", stt: "sarvam", tts: "cartesia" });
    expect(JSON.stringify(live)).not.toMatch(/secret/);
  });
});
