"use client";

import { ArrowRight, Microphone, StopCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, IconChip, Notice, PhaseSteps } from "@/components/ui";
import type { LearningModule } from "@/features/content/types";
import type { ReadingResult } from "@/features/session/types";
import { tokenize } from "@/features/speech/metrics";
import { analyzeReadingAloud, readingProgress } from "@/features/speech/reading";
import type { CaptureFatal, TurnCaptureLike } from "@/features/speech/capture";
import { createCapture, pickEngine } from "@/features/speech/engine";
import type { VadSession } from "@/features/speech/vad-session";

const TRY_AGAIN = "You can press \"Read aloud again\", or continue and read silently.";
const FATAL_TEXT: Record<CaptureFatal, string> = {
  "not-allowed": `Speech recognition is blocked in this browser, so reading aloud can't be analysed. ${TRY_AGAIN}`,
  "no-device": "No microphone was found, so reading aloud can't be analysed. You can still read silently.",
  network: `The voice connection was interrupted. ${TRY_AGAIN}`,
  unsupported: "This browser can't recognise speech. Try Chrome or Edge. You can still read silently.",
  unknown: `The voice connection was interrupted. ${TRY_AGAIN}`,
  "cloud-stt": `The voice connection was interrupted. ${TRY_AGAIN}`,
  vad: `Voice detection could not start. ${TRY_AGAIN}`,
};

export function ReadingPhase({
  module,
  stream,
  vad,
  lang,
  onDone,
}: {
  module: LearningModule;
  stream: MediaStream | null;
  vad: VadSession | null;
  lang: string;
  onDone: (r: { reading: ReadingResult; readingSec: number }) => void;
}) {
  const startedAt = useRef(0);
  const capture = useRef<TurnCaptureLike | null>(null);
  const [listening, setListening] = useState(false);
  const [spoken, setSpoken] = useState("");
  const [captured, setCaptured] = useState<{ text: string; speakingSec: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const engineKind = pickEngine({ stream, vad });
  const canReadAloud = engineKind !== "none";

  const { paragraphs, passageTokens } = useMemo(() => {
    const paras = module.passage.split(/\n\n+/);
    const flat = paras.flatMap((p, para) => p.split(/\s+/).filter(Boolean).map((text) => ({ text, para, n: tokenize(text).length })));
    const ends = flat.reduce<number[]>((acc, w) => {
      acc.push((acc[acc.length - 1] ?? 0) + w.n);
      return acc;
    }, []);
    const mapped = paras.map((_, para) =>
      flat.flatMap((w, i) => (w.para === para ? [{ text: w.text, tokenEnd: ends[i] }] : [])),
    );
    return { paragraphs: mapped, passageTokens: tokenize(module.passage) };
  }, [module.passage]);

  useEffect(() => {
    startedAt.current = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      capture.current?.dispose();
      capture.current = null;
    },
    [],
  );

  const progress = useMemo(() => readingProgress(passageTokens, tokenize(spoken)), [passageTokens, spoken]);

  function startReadAloud() {
    if (!stream) return;
    setNotice(null);
    setCaptured(null);
    setSpoken("");
    capture.current?.dispose();
    const c = createCapture(engineKind, { stream, vad }, module.id, {
      lang,
      onInterim: (t) => setSpoken(t.replace(/\s*\.\.\.$/, "")),
      onFatal: (reason) => {
        setNotice(FATAL_TEXT[reason]);
        setListening(false);
        capture.current?.dispose();
        capture.current = null;
      },
    });
    if (!c) return;
    capture.current = c;
    c.begin();
    setListening(true);
  }

  async function stopReadAloud() {
    const c = capture.current;
    if (!c) return;
    setListening(false);
    const res = await c.end();
    c.dispose();
    capture.current = null;
    setSpoken(res.text);
    setCaptured({ text: res.text, speakingSec: res.timing.speakingSec });
  }

  async function finish() {
    let cap = captured;
    if (listening && capture.current) {
      const c = capture.current;
      setListening(false);
      const res = await c.end();
      c.dispose();
      capture.current = null;
      cap = { text: res.text, speakingSec: res.timing.speakingSec };
    }
    const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
    const analysis = cap ? analyzeReadingAloud(module.passage, cap.text, cap.speakingSec) : null;
    const reading: ReadingResult = analysis
      ? {
          mode: "aloud",
          durationSec,
          aloud: {
            accuracyPct: analysis.accuracyPct,
            coveragePct: analysis.coveragePct,
            wpm: analysis.wpm,
            spokenWordCount: analysis.spokenWordCount,
            missedWords: analysis.missedWords,
          },
        }
      : { mode: "silent", durationSec };
    onDone({ reading, readingSec: durationSec });
  }

  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-3">
        <PhaseSteps current={1} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Phase 1 of 2: Reading</Badge>
            <Badge>{module.level}</Badge>
          </div>
          <p className="text-sm font-semibold tabular-nums text-muted" aria-label={`Reading time ${mm}`}>
            Reading time {mm}
          </p>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <IconChip>
            <Microphone size={22} weight="duotone" />
          </IconChip>
          <div>
            <h2 className="text-lg font-bold leading-tight">Read this out loud</h2>
            <p className="mt-0.5 text-[0.95rem] text-muted">
              {canReadAloud
                ? "Read the passage below just as it is written. The words light up as they are heard. Then you will talk with your coach about what you read."
                : stream
                  ? "This browser cannot recognise speech, so read the passage below and then start the conversation. Use Chrome or Edge to read out loud."
                  : "The microphone is off, so read the passage below and then start the conversation."}
            </p>
          </div>
        </div>
        {canReadAloud && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {!listening ? (
                <Button onClick={startReadAloud} variant={captured ? "secondary" : "primary"} size="lg" icon={<Microphone size={20} weight="fill" aria-hidden />}>
                  {captured ? "Read it again" : "Start reading"}
                </Button>
              ) : (
                <Button variant="danger" size="lg" onClick={stopReadAloud} icon={<StopCircle size={20} weight="fill" aria-hidden />}>
                  I&apos;ve finished reading aloud
                </Button>
              )}
              {listening && (
                <span role="status" className="flex items-center gap-2 text-sm font-semibold text-good">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-good" aria-hidden /> Listening...
                </span>
              )}
            </div>
            {captured && !listening && (
              <p className="text-sm font-semibold text-good">
                {analyzeReadingAloud(module.passage, captured.text, captured.speakingSec)
                  ? "Well done. You can start the conversation now."
                  : "We did not hear enough words. Try reading it again, a little louder, or continue."}
              </p>
            )}
          </>
        )}
      </Card>

      {notice && (
        <Notice tone="warn" role="status">
          {notice}
        </Notice>
      )}

      <Card className="space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight">{module.title}</h1>
        <div className="passage space-y-4 text-ink" aria-label="Reading passage">
          {paragraphs.map((words, pi) => (
            <p key={pi}>
              {words.map((w, wi) => {
                const read = (listening || captured) && w.tokenEnd <= progress;
                return (
                  <span key={wi} className={read ? "rounded bg-accent-soft text-accent-dark" : undefined}>
                    {w.text}{" "}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
          <span className="font-semibold">Key terms:</span>
          {module.keyTerms.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        {/* The main action once the passage has been read aloud (or when voice is not available). */}
        <Button onClick={finish} disabled={elapsed < 3} variant={captured || !canReadAloud ? "primary" : "secondary"} size="lg">
          I&apos;ve finished reading: start the conversation
          <ArrowRight size={18} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
