"use client";

import { CheckCircle, Info, Warning } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { recognitionSupported } from "@/features/speech/recognition";
import { encodeWav16 } from "@/features/speech/segments";
import { VadSession } from "@/features/speech/vad-session";
import { requestCoachTurn } from "@/services/coach-api";

type State = "wait" | "run" | "ok" | "bad" | "info";
interface Row {
  id: string;
  label: string;
  state: State;
  detail: string;
}

const ROWS: Row[] = [
  { id: "server", label: "Reaching the coach service", state: "wait", detail: "" },
  { id: "ai", label: "The AI coach answers", state: "wait", detail: "" },
  { id: "storage", label: "Saving sessions on this device", state: "wait", detail: "" },
  { id: "mic", label: "Your microphone", state: "wait", detail: "" },
  { id: "recognition", label: "Your browser's own live words", state: "wait", detail: "" },
  { id: "vad", label: "The voice detector", state: "wait", detail: "" },
  { id: "stt", label: "Your voice becomes words", state: "wait", detail: "" },
  { id: "tts", label: "The coach's voice", state: "wait", detail: "" },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const secs = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
const MODULE = "computer-science-intermediate-fluency-18plus";

/** Records the microphone for a few seconds and returns 16 kHz mono samples, so they can be sent like the real app sends them. */
async function record(stream: MediaStream, ms: number): Promise<Float32Array> {
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start();
  await sleep(ms);
  rec.stop();
  await stopped;
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
  void ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

export function CheckPanel() {
  const [rows, setRows] = useState<Row[]>(ROWS);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const stream = useRef<MediaStream | null>(null);

  const set = (id: string, state: State, detail = "") => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state, detail } : r)));

  async function run() {
    setRunning(true);
    setDone(false);
    setRows(ROWS);

    // 1. The server.
    set("server", "run");
    try {
      const t0 = performance.now();
      const res = await fetch("/api/status", { cache: "no-store" });
      const d = (await res.json()) as { mode?: string; llm?: string; stt?: string; tts?: string };
      const ok = res.ok && d.mode === "live";
      set("server", ok ? "ok" : "bad", ok ? `Answered in ${secs(t0)}. AI: ${d.llm}, speech: ${d.stt}, voice: ${d.tts}.` : `The server answered but the AI is not set up (mode: ${d.mode}).`);
    } catch (e) {
      set("server", "bad", `The page could not reach the server (${e instanceof Error ? e.message : "unknown"}). Check your internet, or a blocker in the browser.`);
    }

    // 2. The AI coach.
    set("ai", "run");
    try {
      const t0 = performance.now();
      const res = await requestCoachTurn({
        moduleId: MODULE,
        goal: "fluency",
        level: "intermediate",
        ageBand: "18plus",
        remainingSec: 600,
        history: [
          { role: "coach", text: "What does the engineer try to do first with a bug report?" },
          { role: "student", text: "The engineer tries to repeat the problem." },
        ],
        event: "answer",
      });
      const live = res.mode === "live" && !res.degraded;
      set("ai", live ? "ok" : "bad", live ? `Replied in ${secs(t0)}: "${res.text.slice(0, 90)}"` : "The coach used a simple scripted reply, so the AI did not answer (it may be out of allowance for a minute).");
    } catch (e) {
      set("ai", "bad", `No answer from the AI (${e instanceof Error ? e.message : "unknown"}).`);
    }

    // 3. Saving on this device.
    set("storage", "run");
    try {
      const saved = localStorage.getItem("acc.v1.sessions") ?? "";
      let count = 0;
      try {
        count = (JSON.parse(saved || "[]") as unknown[]).length;
      } catch {
        count = 0;
      }
      let test = "ok";
      try {
        localStorage.setItem("acc.check.test", "x".repeat(200_000));
        localStorage.removeItem("acc.check.test");
      } catch {
        test = "failed";
      }
      const kb = Math.round(saved.length / 1000);
      set("storage", test === "ok" ? "ok" : "bad", `${count} saved sessions use about ${kb} KB. A test save of 200 KB ${test === "ok" ? "worked" : "failed: the browser storage is full or blocked"}.`);
    } catch (e) {
      set("storage", "bad", `The browser blocks storage (${e instanceof Error ? e.message : "unknown"}).`);
    }

    // 4. The microphone.
    set("mic", "run");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const track = s.getAudioTracks()[0];
      set("mic", "ok", `Allowed. Using: ${track?.label || "the default microphone"}.`);
    } catch (e) {
      set("mic", "bad", `The microphone could not be opened (${e instanceof Error ? e.name : "unknown"}). Allow it with the lock icon in the address bar, and close other apps that use it.`);
    }

    // 5. The browser's own live words.
    set("recognition", recognitionSupported() ? "ok" : "info", recognitionSupported() ? "This browser has its own speech recognition." : "This browser has no speech recognition of its own. The app's voice service is used instead.");

    // 6. The voice detector.
    if (stream.current) {
      set("vad", "run");
      try {
        const t0 = performance.now();
        const v = await VadSession.create(stream.current);
        await v.destroy();
        set("vad", "ok", `Loaded in ${secs(t0)}.`);
      } catch (e) {
        set("vad", "bad", `The voice detector could not start (${e instanceof Error ? e.message : "unknown"}). The app then depends on the browser's own speech recognition.`);
      }

      // 7. Speaking.
      set("stt", "run", "Speak now for 4 seconds: say \"This is my voice check, one two three\".");
      try {
        const audio = await record(stream.current, 4000);
        let peak = 0;
        for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
        if (peak < 0.01) {
          set("stt", "bad", "Nothing was heard: the microphone is silent. It may be muted, or the wrong microphone is selected in the browser or Windows.");
        } else {
          const wav = encodeWav16(audio);
          const t0 = performance.now();
          const quick = await fetch(`/api/voice/stt?module=${MODULE}&interim=1`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav });
          const quickBody = (await quick.json().catch(() => ({}))) as { text?: string; fast?: boolean };
          const quickTime = secs(t0);
          const t1 = performance.now();
          const full = await fetch(`/api/voice/stt?module=${MODULE}`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav });
          const fullBody = (await full.json().catch(() => ({}))) as { text?: string };
          const ok = quick.ok && full.ok && !!(quickBody.text || fullBody.text);
          set(
            "stt",
            ok ? "ok" : "bad",
            `Live words (${quick.status}, ${quickTime}${quickBody.fast ? ", fast service" : ""}): "${quickBody.text ?? ""}". Saved words (${full.status}, ${secs(t1)}): "${fullBody.text ?? ""}".`,
          );
        }
      } catch (e) {
        set("stt", "bad", `Recording or sending failed (${e instanceof Error ? e.message : "unknown"}).`);
      }
    } else {
      set("vad", "info", "Skipped: no microphone.");
      set("stt", "info", "Skipped: no microphone.");
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;

    // 8. The coach's voice.
    set("tts", "run");
    try {
      const t0 = performance.now();
      const res = await fetch("/api/voice/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hello, this is your coach voice.", speed: 1 }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const via = res.headers.get("x-talkzy-voice");
      const blob = await res.blob();
      set("tts", "ok", `Made in ${secs(t0)} (${via === "sarvam" ? "backup voice" : "your studio voice"}). You should hear it now.`);
      await new Audio(URL.createObjectURL(blob)).play();
    } catch (e) {
      set("tts", "bad", `The coach's voice could not be made or played (${e instanceof Error ? e.message : "unknown"}).`);
    }

    setRunning(false);
    setDone(true);
  }

  const bad = rows.filter((r) => r.state === "bad");

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-muted">Press the button, allow the microphone, and say a short sentence when asked. It takes about 20 seconds.</p>
        <Button size="lg" onClick={() => void run()} disabled={running}>
          {running ? "Checking..." : done ? "Check again" : "Run the check"}
        </Button>
      </Card>
      <Card className="divide-y divide-line p-0">
        {rows.map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-5 py-3.5" data-testid={`check-${r.id}`} data-state={r.state}>
            <span className="mt-0.5 shrink-0" aria-hidden>
              {r.state === "ok" ? (
                <CheckCircle size={24} weight="fill" className="text-good" />
              ) : r.state === "bad" ? (
                <Warning size={24} weight="fill" className="text-bad" />
              ) : (
                <Info size={24} weight="fill" className={r.state === "run" ? "animate-pulse text-accent" : "text-muted"} />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-bold">{r.label}</p>
              {r.detail && <p className="break-words text-sm text-muted">{r.detail}</p>}
            </div>
          </div>
        ))}
      </Card>
      {done && (
        <Card className="space-y-1">
          <p className="font-extrabold" data-testid="check-summary">{bad.length === 0 ? "Everything works in this browser." : `${bad.length} thing${bad.length === 1 ? "" : "s"} to fix: ${bad.map((r) => r.label.toLowerCase()).join(", ")}.`}</p>
          <p className="text-sm text-muted">If something failed, take a screenshot of this page and send it.</p>
        </Card>
      )}
    </div>
  );
}
