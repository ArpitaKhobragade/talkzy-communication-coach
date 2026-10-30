import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeProvider, generate, groqChatModels, isLiveMode, resetGroqSkips } from "@/features/coach/server/llm";
import { hasIndicScript, resetGroqSttCoolOff, resetPartialBudget, resetVoiceCoolOff, synthesizeSarvam, synthesizeSpeech, transcribePartialFast, transcribeSegment } from "@/features/coach/server/voice";
import { POST as sttPost } from "@/app/api/voice/stt/route";
import { GET as ttsCheck, POST as ttsPost } from "@/app/api/voice/tts/route";
import { GET as statusGet } from "@/app/api/status/route";

// No real service is called: global fetch is replaced with a stub in every test.
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  resetGroqSkips();
  resetVoiceCoolOff();
  resetGroqSttCoolOff();
  resetPartialBudget();
  vi.stubGlobal("fetch", fetchMock);
  for (const k of ["GROQ_STT_PARTIALS", "GROQ_API_KEY", "ANTHROPIC_API_KEY", "LLM_PROVIDER", "SARVAM_API_KEY", "CARTESIA_API_KEY", "CARTESIA_VOICE_ID", "SARVAM_STT_MODEL", "TTS_BACKUP", "GROQ_CHAT_MODEL", "GROQ_CHAT_MODELS", "GROQ_REPORT_MODEL", "GROQ_MODEL"]) {
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

describe("Groq (the spoken conversation and the report)", () => {
  it("talks with Qwen first, with no thinking, in an OpenAI-style request", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: " Hello there. " } }] }));
    const out = await generate({ purpose: "chat", system: "SYS", messages: [{ role: "user", content: "hi" }], maxTokens: 800 });
    expect(out).toEqual({ text: "Hello there.", model: "qwen/qwen3.8-27b" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer gsk-test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "qwen/qwen3.8-27b", reasoning_effort: "none", max_completion_tokens: 800 });
    expect(body.include_reasoning).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("keeps gpt-oss to a little thinking, hidden, when it is the model that answers", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    vi.stubEnv("GROQ_CHAT_MODELS", "openai/gpt-oss-20b");
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: "hi" } }] }));
    await generate({ purpose: "chat", system: "s", messages: [], maxTokens: 800 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "openai/gpt-oss-20b", reasoning_effort: "low", include_reasoning: false });
  });

  it("uses low reasoning for reports and throws on HTTP errors or empty replies", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    vi.stubEnv("GROQ_CHAT_MODELS", "only-chat-model");
    fetchMock.mockResolvedValueOnce(json({ choices: [{ message: { content: "{}" } }] }));
    await generate({ purpose: "report", system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 100 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe("low");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("openai/gpt-oss-120b"); // the report uses the larger model

    // The daily allowance is used up (Groq says to wait 15 minutes): fail at once instead of waiting.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "nope" }), { status: 429, headers: { "retry-after": "900" } }));
    await expect(generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 })).rejects.toThrow(/groq_http_429/);
    fetchMock.mockImplementation(async () => json({ choices: [{ message: { content: "" } }] }));
    await expect(generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 })).rejects.toThrow(/empty/);
  });
});

describe("the conversation's list of models", () => {
  it("is Qwen, then gpt-oss-20b, then gpt-oss-120b by default", () => {
    expect(groqChatModels()).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  });
  it("ignores the old default that older setups wrote into GROQ_CHAT_MODEL, but honours a deliberate choice", () => {
    vi.stubEnv("GROQ_CHAT_MODEL", "openai/gpt-oss-20b");
    expect(groqChatModels()[0]).toBe("qwen/qwen3.8-27b");
    vi.stubEnv("GROQ_CHAT_MODEL", "my-own-model");
    expect(groqChatModels()).toEqual(["my-own-model", "openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  });
  it("can be set as a whole list with GROQ_CHAT_MODELS", () => {
    vi.stubEnv("GROQ_CHAT_MODELS", " a , b ,a");
    expect(groqChatModels()).toEqual(["a", "b"]);
  });

  it("hands over to the next model at once when one is at its per-minute limit, and skips it for a little while", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).model === "qwen/qwen3.8-27b" ? new Response("{}", { status: 429, headers: { "retry-after": "1" } }) : json({ choices: [{ message: { content: "from the next model" } }] }),
    );
    const out = await generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 });
    expect(out).toEqual({ text: "from the next model", model: "openai/gpt-oss-20b" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The next turn does not try the model that just said "limit".
    fetchMock.mockClear();
    await generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("openai/gpt-oss-20b");
  });

  it("moves on from a model that does not exist for this key", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).model === "qwen/qwen3.8-27b" ? new Response("{}", { status: 404 }) : json({ choices: [{ message: { content: "ok" } }] }),
    );
    expect((await generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 })).model).toBe("openai/gpt-oss-20b");
  });

  it("fails only when every model has failed", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    fetchMock.mockImplementation(async () => new Response("{}", { status: 500, headers: { "retry-after": "900" } }));
    await expect(generate({ purpose: "chat", system: "s", messages: [], maxTokens: 10 })).rejects.toThrow(/groq_http_500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Groq rate limits and models", () => {
  it("waits a moment and asks again when the per-minute limit is hit and there is no other model to turn to", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    vi.stubEnv("GROQ_CHAT_MODELS", "only-model");
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

  it("does NOT ask for word-for-word text by default: that mode writes English in Hindi letters", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValue(json({ transcript: "umm a program is a list" }));
    await transcribeSegment(new Uint8Array(2000).buffer, [], { verbatim: true });
    expect((fetchMock.mock.calls[0][1].body as FormData).has("mode")).toBe(false);
  });

  it("asks for word-for-word text only when SARVAM_VERBATIM=on, and falls back to the normal text if that is refused", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    vi.stubEnv("SARVAM_VERBATIM", "on");
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

  it("never returns Hindi letters: it asks again for Roman letters, and returns nothing if that does not help", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    expect(hasIndicScript("द इलेक्ट्रिसिटी बेल")).toBe(true);
    expect(hasIndicScript("the electricity bill")).toBe(false);

    fetchMock.mockResolvedValueOnce(json({ transcript: "द इलेक्ट्रिसिटी बेल गेट रिड्यूस्ड" })).mockResolvedValueOnce(json({ transcript: "the electricity bill gets reduced" }));
    expect(await transcribeSegment(new Uint8Array(2000).buffer, [])).toBe("the electricity bill gets reduced");
    const again = fetchMock.mock.calls[1][1].body as FormData;
    expect(again.get("mode")).toBe("translit");

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json({ transcript: "द इलेक्ट्रिसिटी बेल" }));
    expect(await transcribeSegment(new Uint8Array(2000).buffer, [])).toBe("");
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

describe("Sarvam text-to-speech (the backup voice)", () => {
  it("asks for an English MP3 and returns the audio bytes", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValue(json({ audios: [Buffer.from([1, 2, 3, 4]).toString("base64")] }));
    const audio = await synthesizeSarvam("Hello student", 1.1);
    expect(new Uint8Array(audio)).toEqual(new Uint8Array([1, 2, 3, 4]));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sarvam.ai/text-to-speech");
    expect(init.headers["api-subscription-key"]).toBe("sv-test");
    expect(JSON.parse(init.body)).toMatchObject({ text: "Hello student", language_code: "en-IN", output_audio_codec: "mp3", pace: 1.1 });
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

  it("gives live words (interim=1) only part of the speech service's quota, and never holds back a real transcript", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockImplementation(async () => json({ transcript: "hello" }));
    const partial = () => sttPost(sttRequest({ url: "http://localhost/api/voice/stt?module=x&interim=1" }));
    let limited = 0;
    for (let i = 0; i < 60; i++) if ((await partial()).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
    // The live words were marked as such for the speech service, and a real transcript still goes through.
    expect(fetchMock.mock.calls[0][1].headers["x-talkzy-purpose"]).toBe("partial");
    const calls = fetchMock.mock.calls.length;
    expect((await sttPost(sttRequest())).status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
    expect(fetchMock.mock.calls.at(-1)?.[1].headers["x-talkzy-purpose"]).toBeUndefined();
  });

  it("shows live words from Groq Whisper first, without using the speech service's allowance", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    vi.stubEnv("GROQ_API_KEY", "gq-test");
    fetchMock.mockImplementation(async () => json({ text: " A brand is the promise" }));
    const res = await sttPost(sttRequest({ url: "http://localhost/api/voice/stt?module=x&interim=1" }));
    expect(await res.json()).toEqual({ text: "A brand is the promise", fast: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.headers.authorization).toBe("Bearer gq-test");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("en");
    // The accurate transcript is never taken from Whisper: a real request still goes to the speech service.
    fetchMock.mockImplementation(async () => json({ transcript: "accurate words" }));
    expect(await (await sttPost(sttRequest())).json()).toEqual({ text: "accurate words" });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("sarvam");
  });

  it("falls back to the speech service for live words when Groq is out of allowance, and leaves Groq alone for a while", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    vi.stubEnv("GROQ_API_KEY", "gq-test");
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("groq") ? new Response("{}", { status: 429, headers: { "retry-after": "30" } }) : json({ transcript: "from the speech service" }),
    );
    const partial = () => sttPost(sttRequest({ url: "http://localhost/api/voice/stt?module=x&interim=1" }));
    expect(await (await partial()).json()).toEqual({ text: "from the speech service" });
    const groqCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("groq")).length;
    expect(groqCalls()).toBe(1);
    await partial();
    expect(groqCalls()).toBe(1); // not asked again while it is out of allowance
  });

  it("transcribePartialFast: not used without a key or when switched off, and noise and Hindi letters give no words", async () => {
    expect(await transcribePartialFast(new Uint8Array(2000).buffer)).toBeNull();
    vi.stubEnv("GROQ_API_KEY", "gq-test");
    vi.stubEnv("GROQ_STT_PARTIALS", "off");
    expect(await transcribePartialFast(new Uint8Array(2000).buffer)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("GROQ_STT_PARTIALS", "");
    fetchMock.mockImplementation(async () => json({ text: " Thank you." }));
    expect(await transcribePartialFast(new Uint8Array(2000).buffer)).toBe("");
    fetchMock.mockImplementation(async () => json({ text: "नमस्ते" }));
    expect(await transcribePartialFast(new Uint8Array(2000).buffer)).toBe("");
  });

  it("asks once more when a real transcript is refused with 'too many requests'", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValueOnce(json({ error: "slow down" }, 429)).mockResolvedValueOnce(json({ transcript: "it worked" }));
    expect(await transcribeSegment(new Uint8Array(2000).buffer, [])).toBe("it worked");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("allows same-origin browser requests", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-test");
    fetchMock.mockResolvedValue(json({ transcript: "ok" }));
    const res = await sttPost(sttRequest({ headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/voice/tts", () => {
  it("is a clean 501 until Cartesia has its key and the voice ID", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk");
    expect((await ttsPost(ttsRequest({ text: "hi" }))).status).toBe(501);
  });

  const noCredit = () => new Response(JSON.stringify({ error_code: "quota_exceeded", message: "This request requires approximately 119 credits but you have 8 remaining." }), { status: 402 });
  const cartesiaCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("cartesia")).length;
  const sarvamVoiceCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("text-to-speech")).length;

  it("never uses a second voice: with no Cartesia credit it fails, and Cartesia is not asked again for a while", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk");
    vi.stubEnv("CARTESIA_VOICE_ID", "v");
    vi.stubEnv("SARVAM_API_KEY", "sv");
    fetchMock.mockImplementation(async () => noCredit());
    const first = await ttsPost(ttsRequest({ text: "Hello" }));
    expect(first.status).toBe(502);
    expect(JSON.stringify(await first.json())).toMatch(/19|8 credits are left|credit/);
    expect(cartesiaCalls()).toBe(1);

    // The next message fails at once, with the same reason: nothing waits for the service that is down.
    const second = await ttsPost(ttsRequest({ text: "Again" }));
    expect(second.status).toBe(502);
    expect(JSON.stringify(await second.json())).toMatch(/8 credits are left/);
    expect(cartesiaCalls()).toBe(1);
    expect(sarvamVoiceCalls()).toBe(0);
  });

  it("uses Sarvam's voice only when the owner turns it on with TTS_BACKUP=sarvam", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "sk");
    vi.stubEnv("CARTESIA_VOICE_ID", "v");
    vi.stubEnv("SARVAM_API_KEY", "sv");
    vi.stubEnv("TTS_BACKUP", "sarvam");
    fetchMock.mockImplementation(async (url: string) => (String(url).includes("cartesia") ? noCredit() : json({ audios: [Buffer.from([5, 6, 7]).toString("base64")] })));
    const res = await ttsPost(ttsRequest({ text: "Hello" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-talkzy-voice")).toBe("sarvam");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([5, 6, 7]));
  });

  it("does not work with only the Sarvam key: its voice is a second voice", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv");
    expect((await ttsPost(ttsRequest({ text: "Hello" }))).status).toBe(501);
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
    expect(await (await check()).json()).toEqual({ ok: true, via: "cartesia", hint: "The coach's voice (your Cartesia voice ID) is working." });
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
  it("says the browser voice is used when only the Sarvam key is set (its voice is a second voice)", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-secret");
    expect(await (await statusGet()).json()).toEqual({ mode: "dev", llm: null, stt: "sarvam", tts: "browser" });
  });

  it("says a cloud voice is available with the Sarvam key when the owner turned on TTS_BACKUP=sarvam", async () => {
    vi.stubEnv("SARVAM_API_KEY", "sv-secret");
    vi.stubEnv("TTS_BACKUP", "sarvam");
    expect(await (await statusGet()).json()).toEqual({ mode: "dev", llm: null, stt: "sarvam", tts: "cartesia" });
  });

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
