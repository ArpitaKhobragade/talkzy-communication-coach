"use client";

import { ArrowRight, BookOpenText, Camera, CheckCircle, ChatsCircle, DownloadSimple, Gauge, ListChecks, Microphone, SpeakerHigh, TextAa, TrendUp, Warning } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, ButtonLink, Card, EmptyState } from "@/components/ui";
import { getModule } from "@/features/content/modules";
import { recommendNext } from "@/features/progress/stats";
import { buildReportDocument, downloadFile, renderPdf, reportFileName } from "@/features/report/export";
import { buildQuickReport, FILLER_LIMIT_PER_100, GOOD_READING_WPM, type QuickLine, type QuickReading, type QuickWords, type Tile, type Where } from "@/features/report/quick";
import type { Session } from "@/features/session/types";
import { splitPassage } from "@/features/speech/passage-words";
import { speak, ttsSupported } from "@/features/speech/synthesis";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

/** A box about one part of the session (reading, conversation, face and body). */
function Box({ icon, title, subtitle, children, testId }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode; testId: string }) {
  return (
    <Card className="space-y-4 !p-5 md:!p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#ff9a56] to-[#ff5e7a] text-white shadow-sm" aria-hidden>
          {icon}
        </span>
        <div>
          <h2 className="text-xl font-extrabold leading-tight" data-testid={testId}>
            {title}
          </h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function Good({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl bg-good-soft/70 px-3.5 py-2.5 text-[0.98rem] font-semibold leading-snug text-ink" data-testid="went-well">
      <CheckCircle size={22} weight="fill" className="mt-px shrink-0 text-good" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Which question a point is about. */
function WhereChip({ where }: { where?: Where }) {
  if (!where) return <p className="text-xs font-extrabold uppercase tracking-wide text-muted">In your answers</p>;
  return (
    <div className="space-y-0.5">
      <p className="inline-block rounded-full bg-ink px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide text-paper">Question {where.n}</p>
      <p className="text-sm font-semibold leading-snug text-muted">&ldquo;{where.question}&rdquo;</p>
    </div>
  );
}

/** A "to fix" box: what is wrong, the student's own words when there are any, and how to fix it. */
function Fix({ children, quote, how, where, testId = "to-fix" }: { children: ReactNode; quote?: string; how?: string; where?: Where | "none" | "all"; testId?: string }) {
  return (
    <div className="space-y-2 rounded-2xl border border-warn/30 bg-warn-soft/60 p-4 text-[0.98rem] leading-snug" data-testid={testId}>
      {where !== "none" && where !== undefined && <WhereChip where={where === "all" ? undefined : where} />}
      <p className="flex items-start gap-2 font-extrabold">
        <TrendUp size={20} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <span>{children}</span>
      </p>
      {quote && <p className="border-l-4 border-warn/40 pl-3 italic text-muted">You said: &ldquo;{quote}&rdquo;</p>}
      {how && (
        <p className="rounded-xl bg-white/70 px-3 py-2">
          <span className="font-extrabold text-good">How to fix it: </span>
          {how}
        </p>
      )}
    </div>
  );
}

function hearIt(word: string) {
  if (ttsSupported()) speak(word, { rate: 0.8, lang: "en-IN" });
}

/** The tiles at the top: how each part went, at a glance. */
function TileCard({ tile }: { tile: Tile }) {
  const tone = tile.status === "good" ? "text-good" : tile.status === "fix" ? "text-warn" : "text-muted";
  const Icon = tile.status === "good" ? CheckCircle : tile.status === "fix" ? Warning : Microphone;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-ink shadow-sm" data-testid="tile">
      <Icon size={30} weight="fill" className={`shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{tile.area}</p>
        <p className={`font-extrabold leading-tight ${tone}`}>{tile.text}</p>
      </div>
    </div>
  );
}

/** How much of the passage was reached: a bar that fills. */
function Coverage({ pct }: { pct: number }) {
  const full = pct >= 95;
  return (
    <div className="space-y-1.5" data-testid="coverage">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-extrabold">How much you read</p>
        <p className={`text-lg font-extrabold ${full ? "text-good" : "text-warn"}`}>{pct}%</p>
      </div>
      <div role="progressbar" aria-label="How much of the passage you read" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-3.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${full ? "bg-good" : "bg-warn"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Reading speed on a bar with a slow zone, a good zone and a fast zone. */
function SpeedGauge({ pace }: { pace: NonNullable<QuickReading["pace"]> }) {
  const [lo, hi] = GOOD_READING_WPM;
  const MIN = 40;
  const MAX = 240;
  const pos = (w: number) => Math.min(100, Math.max(0, ((w - MIN) / (MAX - MIN)) * 100));
  const label = pace.level === "good" ? "Good speed" : pace.level === "fast" ? "Too fast" : "Too slow";
  return (
    <div className="space-y-1.5" data-testid="speed">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 font-extrabold">
          <Gauge size={20} weight="fill" aria-hidden /> Your reading speed
        </p>
        <p className={`text-lg font-extrabold ${pace.level === "good" ? "text-good" : "text-warn"}`}>{label}</p>
      </div>
      <div className="relative h-3.5 overflow-hidden rounded-full" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-warn/40" style={{ width: `${pos(lo)}%` }} />
        <div className="absolute inset-y-0 bg-good/60" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-warn/40" style={{ width: `${100 - pos(hi)}%` }} />
        <div className="absolute -inset-y-0.5 w-1.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${pos(pace.wpm)}%` }} />
      </div>
      <div className="flex justify-between text-xs font-semibold text-muted" aria-hidden>
        <span>Slow</span>
        <span>Good</span>
        <span>Fast</span>
      </div>
    </div>
  );
}

/** The passage with a line under every word: green read, red skipped, orange not clear, and grey not reached. */
function MarkedPassage({ passage, marks }: { passage: string; marks: string }) {
  const { paragraphs, tokens } = useMemo(() => splitPassage(passage), [passage]);
  if (marks.length !== tokens.length) return null;
  const style: Record<string, string> = {
    r: "underline decoration-good decoration-[3px] underline-offset-4",
    s: "rounded bg-bad-soft text-bad underline decoration-bad decoration-[3px] underline-offset-4",
    m: "rounded bg-warn-soft text-warn underline decoration-warn decoration-[3px] underline-offset-4",
    u: "text-muted/70",
  };
  return (
    <div className="space-y-2.5" data-testid="marked-passage">
      <p className="font-extrabold">Your reading, word by word</p>
      <div className="space-y-3 rounded-2xl bg-paper p-4 text-[1.02rem] leading-loose">
        {paragraphs.map((words, pi) => (
          <p key={pi}>
            {words.map((w, wi) => (
              <span key={wi} className={style[marks[w.tokenEnd - 1] ?? "u"]} data-mark={marks[w.tokenEnd - 1]}>
                {w.text}{" "}
              </span>
            ))}
          </p>
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-muted">
        <span><span className="underline decoration-good decoration-[3px] underline-offset-4">Green</span> read</span>
        <span><span className="rounded bg-bad-soft px-1 text-bad underline decoration-bad decoration-[3px] underline-offset-4">Red</span> skipped</span>
        <span><span className="rounded bg-warn-soft px-1 text-warn underline decoration-warn decoration-[3px] underline-offset-4">Orange</span> not said clearly</span>
        <span><span className="text-muted/70">Grey</span> not reached</span>
      </p>
    </div>
  );
}

/** Filler words ("umm", "haa") and wrong words, from everything the student said. */
function WordsPanel({ w }: { w: QuickWords }) {
  const high = w.fillersPer100 !== null && w.fillersPer100 > FILLER_LIMIT_PER_100;
  return (
    <div className="grid gap-5 md:grid-cols-2 md:items-start">
      <div className="space-y-3" data-testid="fillers">
        <p className="font-extrabold">Filler words</p>
        {w.fillerTotal === 0 ? (
          <Good>No filler words heard. Your speech was clean.</Good>
        ) : (
          <div className={`space-y-3 rounded-2xl border p-4 ${high ? "border-warn/30 bg-warn-soft/60" : "border-good/30 bg-good-soft/50"}`}>
            <div className="flex items-end gap-3">
              <p className={`text-4xl font-extrabold leading-none ${high ? "text-warn" : "text-good"}`}>{w.fillerTotal}</p>
              <p className="pb-0.5 font-bold leading-tight">
                filler {w.fillerTotal === 1 ? "word" : "words"}
                {w.fillersPer100 !== null && <span className="block text-sm font-semibold text-muted">about {w.fillersPer100} in every 100 words</span>}
              </p>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Your filler words">
              {w.fillers.map((f) => (
                <li key={f.word} className="rounded-full bg-white px-3 py-1 text-sm font-extrabold shadow-sm">
                  &ldquo;{f.word}&rdquo; <span className="text-warn">&times;{f.count}</span>
                </li>
              ))}
            </ul>
            {w.worstQuestion && (
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-muted">Most fillers were in:</p>
                <WhereChip where={w.worstQuestion.where} />
              </div>
            )}
            {high && (
              <p className="rounded-xl bg-white/70 px-3 py-2">
                <span className="font-extrabold text-good">How to fix it: </span>
                When you want to say a filler, stay quiet for one second instead. A short pause sounds confident.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3" data-testid="word-fixes">
        <p className="font-extrabold">Words to correct</p>
        {w.mistakes.length === 0 ? (
          <Good>We found no clear wrong words. Keep speaking in full sentences.</Good>
        ) : (
          <div className="space-y-2.5">
            {w.mistakes.map((m) => (
              <div key={m.said} className="space-y-1.5 rounded-2xl border border-warn/30 bg-warn-soft/60 p-4 text-[0.98rem] leading-snug" data-testid="word-fix">
                {m.where && <WhereChip where={m.where} />}
                <p>
                  <span className="text-sm font-extrabold uppercase tracking-wide text-bad">You said </span>
                  <span className="rounded bg-white/80 px-1.5 font-bold line-through decoration-bad decoration-2">{m.said}</span>
                </p>
                <p>
                  <span className="text-sm font-extrabold uppercase tracking-wide text-good">Say </span>
                  <span className="rounded bg-white/80 px-1.5 font-bold">{m.better}</span>
                </p>
                <p className="text-muted">{m.why}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadingLine({ line }: { line: QuickLine }) {
  return line.kind === "good" ? (
    <Good>{line.text}</Good>
  ) : (
    <Fix how={line.how} where="none" testId="reading-fix">
      {line.text}
    </Fix>
  );
}

export function ReportView({ sessionId }: { sessionId: string }) {
  const sessions = useSessions();
  const profile = useProfile();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hydrated || !profile) return null;
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) {
    return (
      <EmptyState title="We could not find that report" action={<ButtonLink href="/progress">See your history</ButtonLink>}>
        It may have been deleted, or it was saved in a different browser.
      </EmptyState>
    );
  }
  const session: Session = s;
  const rec = recommendNext(profile, sessions);
  const q = buildQuickReport(session);
  const next = { title: rec.module.title, url: `${window.location.origin}/practice/${rec.module.id}` };
  const rd = q.reading;
  const cam = q.camera;
  const canHear = ttsSupported();
  const mod = getModule(session.moduleId);
  const when = new Date(session.startedAt).toLocaleDateString("en-US", { dateStyle: "long" });

  /** Makes the black-and-white PDF on this device (nothing is uploaded) and saves it. */
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const bytes = await renderPdf(buildReportDocument(session, { displayName: profile!.displayName, next }));
      downloadFile(bytes, reportFileName(session.startedAt, "pdf"), "application/pdf");
    } catch {
      setError("We could not make the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5" data-testid="report">
      <section className="overflow-hidden rounded-card bg-gradient-to-br from-[#ff9a56] to-[#ff5e7a] p-6 text-white shadow-lift md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <p className="text-sm font-extrabold uppercase tracking-wide text-white/85">
              {profile.displayName} &middot; {when}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight md:text-4xl">Your feedback report</h1>
            {mod && <p className="mt-1 text-white/90">{mod.title}</p>}
            <p className="mt-3 text-[1.1rem] font-semibold leading-snug text-white" data-testid="report-headline">
              {q.headline}
            </p>
          </div>
          <Button size="lg" variant="secondary" className="!border-white !bg-white !text-ink hover:!bg-white/90" icon={<DownloadSimple size={20} weight="bold" aria-hidden />} onClick={() => void download()} disabled={busy}>
            {busy ? "Making your PDF..." : "Download PDF"}
          </Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {q.tiles.map((t) => (
            <TileCard key={t.area} tile={t} />
          ))}
        </div>
      </section>

      {q.plan.length > 0 && (
        <Card className="space-y-3 !p-5 md:!p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-ink text-paper" aria-hidden>
              <ListChecks size={22} weight="fill" />
            </span>
            <div>
              <h2 className="text-xl font-extrabold leading-tight">Your plan for next time</h2>
              <p className="text-sm text-muted">Do these {q.plan.length === 1 ? "one thing" : `${q.plan.length} things`} in your next session</p>
            </div>
          </div>
          <ol className="grid gap-2.5 md:grid-cols-3" data-testid="plan">
            {q.plan.map((step, i) => (
              <li key={step} className="flex items-start gap-3 rounded-2xl bg-paper p-3.5 text-[0.98rem] font-semibold leading-snug">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#ff9a56] to-[#ff5e7a] text-sm font-extrabold text-white">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Box icon={<BookOpenText size={22} weight="fill" />} title="Reading" subtitle="How you read the passage out loud" testId="reading-box">
        {rd.mode === "silent" ? (
          <div className="space-y-2.5">
            {rd.lines.map((l) => (
              <ReadingLine key={l.text} line={l} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-5 md:grid-cols-2">
              {rd.coveragePct !== null && <Coverage pct={rd.coveragePct} />}
              {rd.pace && <SpeedGauge pace={rd.pace} />}
            </div>
            <div className="grid gap-2.5 md:grid-cols-2 md:items-start">
              {rd.lines.map((l) => (
                <ReadingLine key={l.text} line={l} />
              ))}
            </div>
            {(rd.skipped.length > 0 || rd.unreadTail) && (
              <div className="space-y-2 rounded-2xl border border-bad/25 bg-bad-soft/50 p-4" data-testid="skipped">
                <p className="font-extrabold text-bad">Parts you skipped</p>
                <ul className="space-y-1.5 text-[0.98rem]">
                  {rd.skipped.map((phrase) => (
                    <li key={phrase}>
                      You skipped: <span className="rounded bg-white/80 px-1.5 font-bold underline decoration-bad decoration-[3px] underline-offset-4">&ldquo;{phrase}&rdquo;</span>
                    </li>
                  ))}
                  {rd.unreadTail && (
                    <li>
                      You stopped before: <span className="rounded bg-white/80 px-1.5 font-bold underline decoration-bad decoration-[3px] underline-offset-4">&ldquo;{rd.unreadTail}&rdquo;</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
            {rd.pronunciation.length > 0 && (
              <div className="space-y-2.5">
                <p className="font-extrabold">Words to say more clearly</p>
                <div className="grid gap-2.5 md:grid-cols-2">
                  {rd.pronunciation.map((w) => (
                    <div key={w.word} className="space-y-1 rounded-2xl border border-warn/30 bg-warn-soft/60 p-4 text-[0.98rem] leading-snug" data-testid="pronunciation">
                      <p className="flex flex-wrap items-center gap-x-2 text-lg font-extrabold">
                        <span className="underline decoration-warn decoration-[3px] underline-offset-4">{w.word}</span>
                        {canHear && (
                          <button
                            type="button"
                            onClick={() => hearIt(w.word)}
                            className="ml-auto inline-flex items-center gap-1 rounded-full border border-ink/25 bg-white px-3 py-1 text-xs font-bold hover:bg-surface"
                            aria-label={`Hear how to say ${w.word}`}
                          >
                            <SpeakerHigh size={14} weight="fill" aria-hidden /> Hear it
                          </button>
                        )}
                      </p>
                      {w.heard && <p className="italic text-muted">It sounded like &ldquo;{w.heard}&rdquo;</p>}
                      <p>
                        <span className="font-extrabold">Say it in parts: </span>
                        {w.parts}
                      </p>
                      <p className="text-muted">{w.tip}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {mod && rd.marks && <MarkedPassage passage={mod.passage} marks={rd.marks} />}
          </div>
        )}
      </Box>

      <Box icon={<ChatsCircle size={22} weight="fill" />} title="Conversation" subtitle="How you answered the coach's questions" testId="conversation-box">
        {q.noAnswers ? (
          <p className="text-[0.98rem] text-muted">We did not hear any answers, so there is nothing to review here.</p>
        ) : (
          <div className="space-y-3">
            {q.good.length > 0 && (
              <div className="grid gap-2.5 md:grid-cols-2 md:items-start">
                {q.good.map((g) => (
                  <Good key={g.text}>{g.text}</Good>
                ))}
              </div>
            )}
            {q.fix.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 md:items-start">
                {q.fix.map((x) => (
                  <Fix key={`${x.where?.n}-${x.problem}`} quote={x.quote} how={x.how} where={x.where ?? "all"}>
                    {x.problem}
                  </Fix>
                ))}
              </div>
            ) : (
              <p className="text-muted">Nothing big to fix this time. Keep practising.</p>
            )}
            {q.sayItBetter && (
              <div className="space-y-1 rounded-2xl bg-accent-soft/70 p-4 text-[0.98rem] leading-snug" data-testid="say-it-better">
                <p className="text-xs font-extrabold uppercase tracking-wide text-accent-ink">Say it like this</p>
                <p className="italic text-muted">Instead of: &ldquo;{q.sayItBetter.said}&rdquo;</p>
                <p className="font-bold">Say: &ldquo;{q.sayItBetter.better}&rdquo;</p>
              </div>
            )}
          </div>
        )}
      </Box>

      {!q.noAnswers && (
        <Box icon={<TextAa size={22} weight="fill" />} title="Your words" subtitle="Fillers like umm and haa, and words to correct" testId="words-box">
          <WordsPanel w={q.words} />
          <p className="text-xs font-semibold text-muted">Fillers are counted from what the app could hear, so a few may be missed. Wrong words are checked against common mistakes.</p>
        </Box>
      )}

      <Box icon={<Camera size={22} weight="fill" />} title="Face and body" subtitle="How you looked while you spoke" testId="camera-box">
        {cam.status === "ok" ? (
          <div className="grid gap-2.5 md:grid-cols-2 md:items-start">
            {cam.looked && <Good>{cam.looked}</Good>}
            {cam.good.map((g) => (
              <Good key={g}>{g}</Good>
            ))}
            {cam.fix.map((x) => (
              <Fix key={x.problem} how={x.how} where="none" testId="camera-fix">
                {x.problem}
              </Fix>
            ))}
          </div>
        ) : cam.status === "unavailable" ? (
          <p className="text-[0.98rem] text-muted">The camera could not be used this time, so there is no feedback on your face and body.</p>
        ) : (
          <p className="text-[0.98rem] text-muted">The camera was off. Turn it on at the start of your next session to get feedback on how you look and sit.</p>
        )}
      </Box>

      <div className="flex flex-wrap items-center gap-3 pb-2">
        <Button size="lg" icon={<DownloadSimple size={20} weight="bold" aria-hidden />} onClick={() => void download()} disabled={busy}>
          {busy ? "Making your PDF..." : "Download PDF"}
        </Button>
        <ButtonLink href={`/practice/${rec.module.id}`} variant="secondary" size="lg">
          Practise next: {rec.module.title}
          <ArrowRight size={18} aria-hidden />
        </ButtonLink>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
