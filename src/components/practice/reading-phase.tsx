"use client";

import { ArrowRight, ArrowCounterClockwise, CheckCircle, Microphone, Play } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, IconChip, Notice, PhaseSteps } from "@/components/ui";
import type { LearningModule } from "@/features/content/types";
import type { ReadingResult } from "@/features/session/types";
import { tokenize } from "@/features/speech/metrics";
import { alignReading, analyzeReadingAloud, finishedReading } from "@/features/speech/reading";
import type { CaptureFatal, TurnCaptureLike } from "@/features/speech/capture";
import { createCapture, pickEngine } from "@/features/speech/engine";
import type { VadSession } from "@/features/speech/vad-session";

const TRY_AGAIN = "You can press Start reading to try again, or start the conversation without reading aloud.";
const FATAL_TEXT: Record<CaptureFatal, string> = {
  "not-allowed": `Speech recognition is blocked in this browser, so reading aloud can't be analysed. ${TRY_AGAIN}`,
  "no-device": "No microphone was found, so reading aloud can't be analysed. You can still read silently and start the conversation.",
  network: `The voice connection was interrupted. ${TRY_AGAIN}`,
  unsupported: "This browser can't recognise speech. Try Chrome or Edge. You can still read silently and start the conversation.",
  unknown: `The voice connection was interrupted. ${TRY_AGAIN}`,
  "cloud-stt": `The voice connection was interrupted. ${TRY_AGAIN}`,
  vad: `Voice detection could not start. ${TRY_AGAIN}`,
};

/** The reading is finished by itself this long after the last word of the passage is heard. */
const FINISH_DELAY_MS = 1200;
/** Almost all of the passage was read and then the student stopped talking: the reading is finished after this much quiet. */
const QUIET_FINISH_MS = 3500;

type ReadingOutcome = { reading: ReadingResult; readingSec: number };

export function ReadingPhase({
  module,
  stream,
  vad,
  vadPending,
  lang,
  onDone,
}: {
  module: LearningModule;
  stream: MediaStream | null;
  vad: VadSession | null;
  /** The accurate voice detector is still loading. Reading can start as soon as it is ready, or with the browser's voice recognition if it is slow. */
  vadPending: boolean;
  lang: string;
  onDone: (r: ReadingOutcome) => void;
}) {
  const openedAt = useRef(0);
  /** When the student pressed "Start reading" (0 until then). */
  const startedAt = useRef(0);
  const capture = useRef<TurnCaptureLike | null>(null);
  const finishing = useRef(false);
  const lastChange = useRef(0);
  const lastText = useRef("");
  const [listening, setListening] = useState(false);
  const [checking, setChecking] = useState(false);
  const [spoken, setSpoken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [quietMs, setQuietMs] = useState(0);
  /** The reading is finished and checked. The student starts the conversation from the button at the top. */
  const [result, setResult] = useState<ReadingOutcome | null>(null);

  const engineKind = pickEngine({ stream, vad });
  const canReadAloud = engineKind !== "none";

  const { paragraphs, passageTokens } = useMemo(() => {
    const paras = module.passage.split(/\n\n+/);
    const flat = paras.flatMap((p, para) => p.split(/\s+/).filter(Boolean).map((text) => ({ text, para, n: tokenize(text).length })));
    const ends = flat.reduce<number[]>((acc, w) => {
      acc.push((acc[acc.length - 1] ?? 0) + w.n);
      return acc;
    }, []);
    const mapped = paras.map((_, para) => flat.flatMap((w, i) => (w.para === para ? [{ text: w.text, tokenEnd: ends[i], tokens: w.n }] : [])));
    return { paragraphs: mapped, passageTokens: tokenize(module.passage) };
  }, [module.passage]);

  useEffect(() => {
    openedAt.current = Date.now();
    const id = setInterval(() => {
      setElapsed(startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0);
      // Quiet means no new words AND no voice heard: words can pause for a moment while the student is still reading.
      const heardIdle = capture.current?.idleMs();
      setQuietMs(heardIdle === undefined ? Date.now() - lastChange.current : Math.min(Date.now() - lastChange.current, heardIdle));
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      capture.current?.dispose();
      capture.current = null;
    },
    [],
  );

  const spokenTokens = useMemo(() => tokenize(spoken), [spoken]);
  // Word by word: read, skipped, not clear, or not reached yet.
  const alignment = useMemo(() => alignReading(passageTokens, spokenTokens), [passageTokens, spokenTokens]);
  const reachedEnd = useMemo(() => finishedReading(passageTokens, spokenTokens), [passageTokens, spokenTokens]);
  const reachedMost = alignment.last >= 0 && (alignment.last + 1) / passageTokens.length >= 0.85;

  /** Stops listening and works out how the reading went. The conversation starts from the button at the top. */
  async function finishReading() {
    if (finishing.current) return;
    finishing.current = true;
    setChecking(true);
    let text = "";
    let speakingSec = 0;
    const c = capture.current;
    if (c) {
      setListening(false);
      const res = await c.end();
      c.dispose();
      capture.current = null;
      // If the accurate transcript has nothing, the words that were shown on the screen are used.
      text = res.text || lastText.current;
      speakingSec = res.timing.speakingSec;
    }
    const durationSec = Math.round((Date.now() - (startedAt.current || openedAt.current)) / 1000);
    const analysis = text ? analyzeReadingAloud(module.passage, text, speakingSec) : null;
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
            skipped: analysis.skipped,
            unreadTail: analysis.unreadTail,
            misheard: analysis.misheard,
            marks: analysis.marks,
          },
        }
      : { mode: "silent", durationSec };
    setChecking(false);
    setResult({ reading, readingSec: durationSec });
  }

  /** "Start conversation": with a finished reading, that reading is kept; without one, the passage counts as read silently. */
  function startConversation() {
    if (result) {
      onDone(result);
      return;
    }
    capture.current?.dispose();
    capture.current = null;
    const durationSec = Math.round((Date.now() - (startedAt.current || openedAt.current)) / 1000);
    onDone({ reading: { mode: "silent", durationSec }, readingSec: durationSec });
  }

  function startReadAloud() {
    if (!stream || finishing.current) return;
    setNotice(null);
    setSpoken("");
    lastText.current = "";
    lastChange.current = Date.now();
    startedAt.current = Date.now();
    setElapsed(0);
    capture.current?.dispose();
    const c = createCapture(engineKind, { stream, vad }, module.id, {
      lang,
      onInterim: (t) => {
        const text = t.replace(/\s*\.\.\.$/, "");
        if (text !== lastText.current) {
          lastText.current = text;
          lastChange.current = Date.now();
        }
        setSpoken(text);
      },
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

  /** Read the passage again from the start. */
  function readAgain() {
    finishing.current = false;
    setResult(null);
    setChecking(false);
    startReadAloud();
  }

  // The reading is finished when the last words of the passage are heard.
  useEffect(() => {
    if (!listening || !reachedEnd) return;
    const t = setTimeout(() => void finishReading(), FINISH_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, reachedEnd, spoken]);

  // Nearly everything was read and the student went quiet: that is the end.
  useEffect(() => {
    if (listening && reachedMost && quietMs > QUIET_FINISH_MS) void finishReading();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, reachedMost, quietMs]);

  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const started = spokenTokens.length > 0;
  const aloud = result?.reading.aloud;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-44">
      {/* The buttons are at the top, and stay there while the passage is scrolled. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur md:mx-0 md:px-0" data-testid="reading-actions">
        <div className="flex flex-wrap items-center gap-3">
          {result ? (
            <>
              <Button size="lg" onClick={startConversation} icon={<ArrowRight size={20} weight="bold" aria-hidden />} className="flex-row-reverse">
                Start conversation
              </Button>
              {canReadAloud && (
                <Button size="lg" variant="secondary" onClick={readAgain} icon={<ArrowCounterClockwise size={18} aria-hidden />}>
                  Read again
                </Button>
              )}
            </>
          ) : !canReadAloud ? (
            <Button size="lg" onClick={startConversation} icon={<ArrowRight size={20} weight="bold" aria-hidden />} className="flex-row-reverse">
              Start conversation
            </Button>
          ) : listening || checking ? (
            <Button size="lg" onClick={() => void finishReading()} disabled={checking} icon={<CheckCircle size={20} weight="fill" aria-hidden />}>
              {checking ? "Checking your reading..." : "Finish reading"}
            </Button>
          ) : (
            <>
              <Button size="lg" onClick={startReadAloud} disabled={vadPending} icon={<Play size={20} weight="fill" aria-hidden />}>
                {vadPending ? "Getting your microphone ready..." : "Start reading"}
              </Button>
              <Button size="lg" variant="secondary" onClick={startConversation} icon={<ArrowRight size={18} aria-hidden />} className="flex-row-reverse">
                Skip reading, start conversation
              </Button>
            </>
          )}
          {listening && (
            <span role="status" className="flex shrink-0 items-center gap-2 text-sm font-semibold text-good">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-good" aria-hidden /> Listening
            </span>
          )}
          <p className="ml-auto text-sm font-semibold tabular-nums text-muted" aria-label={`Reading time ${mm}`}>
            Reading time {mm}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <PhaseSteps current={1} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Phase 1 of 2: Reading</Badge>
          <Badge>{module.level}</Badge>
        </div>
      </div>

      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <IconChip>
            <Microphone size={22} weight="duotone" />
          </IconChip>
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">Read this out loud</h2>
            <p className="mt-0.5 text-[0.95rem] text-muted" role="status" data-testid="reading-hint">
              {result
                ? aloud
                  ? `Well done! You read ${aloud.coveragePct}% of the passage. Look at the lines under the words, then press Start conversation.`
                  : "Reading finished. Press Start conversation."
                : checking
                  ? "Well done. Checking your reading..."
                  : canReadAloud
                    ? listening
                      ? started
                        ? "Keep reading. When you reach the end, press Finish reading (it also finishes by itself)."
                        : "Listening... start reading the passage out loud."
                      : vadPending
                        ? "Getting your microphone ready..."
                        : "Press Start reading, then read the passage out loud. Each word gets a line under it as you say it: green when it is read, red when it is skipped, orange when it is not said clearly."
                    : stream
                      ? "This browser cannot recognise speech, so read the passage below and then press Start conversation. Use Chrome or Edge to read out loud."
                      : "The microphone is off, so read the passage below and then press Start conversation."}
            </p>
          </div>
        </div>
        {canReadAloud && (started || result) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-muted" aria-hidden>
            <span><span className="underline decoration-good decoration-[3px] underline-offset-4">green line</span> read</span>
            <span><span className="rounded bg-bad-soft px-1.5 text-bad underline decoration-bad decoration-[3px] underline-offset-4">red line</span> skipped</span>
            <span><span className="rounded bg-warn-soft px-1.5 text-warn underline decoration-warn decoration-[3px] underline-offset-4">orange line</span> not said clearly</span>
          </p>
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
                const st = alignment.status[w.tokenEnd - 1];
                // A line under each word: green when it was read, red when it was skipped, orange when it was not said clearly.
                const cls =
                  st === "read"
                    ? "underline decoration-good decoration-[3px] underline-offset-4"
                    : st === "skipped"
                      ? "rounded bg-bad-soft text-bad underline decoration-bad decoration-[3px] underline-offset-4"
                      : st === "misheard"
                        ? "rounded bg-warn-soft text-warn underline decoration-warn decoration-[3px] underline-offset-4"
                        : undefined;
                return (
                  <span key={wi} className={cls} data-status={st}>
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
    </div>
  );
}
