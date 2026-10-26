"use client";

import { ArrowClockwise, ArrowRight, BookOpenText, Camera, ChatCircleText, ChatsCircle, CheckCircle, DownloadSimple, FilePdf, Info, Target, TrendUp, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Badge, Button, ButtonLink, Card, EmptyState, IconChip, Notice, SourceTag, Stat } from "@/components/ui";
import { getField, getGoal } from "@/features/content/fields";
import { getModule } from "@/features/content/modules";
import { recommendNext } from "@/features/progress/stats";
import type { CoachingItem } from "@/features/session/types";
import { countWords, paceLabel } from "@/features/speech/metrics";
import { buildReportDocument, documentToText, downloadFile, renderPdf, reportFileName } from "@/features/report/export";
import { requestReport } from "@/services/coach-api";
import { deleteSession, saveSession } from "@/services/storage";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

function Section({ title, subtitle, tag, icon, children }: { title: string; subtitle?: string; tag?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && <IconChip>{icon}</IconChip>}
          <div>
            <h2 className="text-xl font-extrabold leading-tight tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
        </div>
        {tag}
      </div>
      {children}
    </Card>
  );
}

function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="mt-2 border-l-4 border-accent/40 bg-paper px-3 py-2 text-sm italic text-ink">&ldquo;{children}&rdquo;</blockquote>;
}

function Block({ title, tone, children }: { title: string; tone: "good" | "warn" | "neutral"; children: ReactNode }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-muted";
  // The icon and the words carry the meaning, so it never relies on colour alone.
  const Icon = tone === "good" ? CheckCircle : tone === "warn" ? TrendUp : Info;
  return (
    <div className="space-y-2.5">
      <h3 className={`flex items-center gap-2 text-base font-extrabold ${color}`}>
        <Icon size={20} weight="fill" aria-hidden />
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Rule-based coaching, grouped into what went well, what to improve (with why and how), and notes. */
function CoachingList({ items, emptyText }: { items: CoachingItem[]; emptyText?: string }) {
  const good = items.filter((i) => i.kind === "good");
  const improve = items.filter((i) => i.kind === "improve");
  const info = items.filter((i) => i.kind === "info");
  if (items.length === 0) return emptyText ? <p className="text-muted">{emptyText}</p> : null;
  return (
    <div className="space-y-5">
      {good.length > 0 && (
        <Block title="What went well" tone="good">
          <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
            {good.map((i, k) => (
              <li key={k}>
                {i.topic && <span className="font-semibold">{i.topic}: </span>}
                {i.observation}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {improve.length > 0 && (
        <Block title="What to fix" tone="warn">
          <ul className="space-y-3">
            {improve.map((i, k) => (
              <li key={k} className="rounded-xl border border-warn/25 bg-warn-soft/50 p-3 text-[0.95rem]">
                {i.topic && <p className="text-sm font-extrabold text-warn">{i.topic}</p>}
                <p className="font-semibold">{i.observation}</p>
                {i.why && <p className="mt-1 text-sm text-muted">{i.why}</p>}
                {i.howTo && (
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">How to fix it: </span>
                    {i.howTo}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {info.length > 0 && (
        <Block title="Good to know" tone="neutral">
          <ul className="space-y-2 text-[0.95rem] text-muted">
            {info.map((i, k) => (
              <li key={k}>
                {i.topic && <span className="font-semibold text-ink">{i.topic}: </span>}
                {i.observation}
                {i.howTo && (
                  <span className="block text-sm">
                    <span className="font-semibold text-ink">Tip: </span>
                    {i.howTo}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

export function ReportView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const sessions = useSessions();
  const profile = useProfile();
  const hydrated = useHydrated();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "txt" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);

  if (!hydrated || !profile) return null;
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) {
    return (
      <EmptyState title="We could not find that session" action={<ButtonLink href="/progress">See your history</ButtonLink>}>
        It may have been deleted, or it was saved in a different browser.
      </EmptyState>
    );
  }

  const m = getModule(s.moduleId);
  const ai = s.report.ai;
  const sp = s.speech;
  const aloud = s.reading.aloud;
  const v = s.vision;
  const rec = recommendNext(profile, sessions);
  const exercises = ai ? ai.exercises : s.report.fallbackExercises;
  const minutes = Math.max(1, Math.round(s.durationSec / 60));
  const readingCoaching = s.report.readingCoaching ?? [];
  const answerCoaching = s.report.answerCoaching ?? [];
  const cameraCoaching = s.report.bodyLanguageCoaching ?? [];
  const hasCameraData = !!v && (cameraCoaching.length > 0 || s.report.bodyLanguageNotes.length > 0);

  /** Makes the report file on this device (nothing is uploaded) and saves it. */
  async function download(kind: "pdf" | "txt") {
    setBusy(kind);
    setDownloadError(null);
    try {
      const doc = buildReportDocument(s!, {
        displayName: profile!.displayName,
        moduleTitle: m?.title ?? "Practice session",
        fieldName: getField(s!.field).name,
        goalName: getGoal(s!.goal).name,
        next: { title: rec.module.title, level: rec.module.level, reason: rec.reason },
      });
      if (kind === "pdf") downloadFile(await renderPdf(doc), reportFileName(s!.startedAt, "pdf"), "application/pdf");
      else downloadFile(documentToText(doc), reportFileName(s!.startedAt, "txt"), "text/plain;charset=utf-8");
    } catch {
      setDownloadError("We could not make the file. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const sayItBetter = s.report.sayItBetter ?? [];

  /** The written feedback can fail (network, busy AI service). The saved answers are enough to ask again. */
  const canRetryAi =
    !ai &&
    m !== undefined &&
    s.transcriptKept &&
    !/Development mode/.test(s.report.aiUnavailableReason ?? "") &&
    s.turns.some((t) => t.role === "student" && t.text.trim());

  async function retryAi() {
    if (!m) return;
    setRetrying(true);
    setRetryNote(null);
    const res = await requestReport({
      moduleId: s!.moduleId,
      goal: s!.goal,
      level: s!.level,
      ageBand: profile!.ageBand,
      turns: s!.turns.slice(0, 60).map((t) => ({ role: t.role, text: t.text.slice(0, 2000), inputMode: t.inputMode })),
      speech: s!.speech,
      readingAloud: s!.reading.aloud,
      readingMode: s!.reading.mode,
      readingSec: s!.readingSec,
      passageWords: countWords(m.passage),
    });
    if (res.ai) {
      const better = res.ai.sayItBetter?.length ? res.ai.sayItBetter.map((x) => ({ ...x, source: "ai" as const })) : s!.report.sayItBetter;
      saveSession({ ...s!, report: { ...s!.report, ai: res.ai, generatedBy: "ai", model: res.model, aiUnavailableReason: undefined, sayItBetter: better } });
    } else {
      setRetryNote(res.reason ?? "The written feedback could not be generated this time.");
    }
    setRetrying(false);
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.report.generatedBy === "ai" ? "good" : "warn"}>{s.report.generatedBy === "ai" ? "AI-written feedback" : "Development mode"}</Badge>
          <Badge>{s.level}</Badge>
          <Badge>Focus: {getGoal(s.goal).name}</Badge>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Your feedback report</h1>
        <p className="text-muted">
          {m?.title ?? "Practice session"} · {getField(s.field).name} · {new Date(s.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {minutes} min
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button icon={<FilePdf size={18} weight="fill" aria-hidden />} onClick={() => void download("pdf")} disabled={busy !== null}>
            {busy === "pdf" ? "Making your PDF..." : "Download PDF"}
          </Button>
          <Button variant="secondary" icon={<DownloadSimple size={18} aria-hidden />} onClick={() => void download("txt")} disabled={busy !== null}>
            {busy === "txt" ? "Making your file..." : "Download as text"}
          </Button>
          <span className="text-sm text-muted">Made on your device. Nothing is uploaded.</span>
        </div>
        {downloadError && (
          <p role="alert" className="mt-2 text-sm font-semibold text-bad">
            {downloadError}
          </p>
        )}
      </div>

      {!s.completed && (
        <Notice tone="warn" title="This was a short session">
          Fewer than two answers were captured, so measurements may be missing and this session does not count toward your streak. A full session takes about
          10 minutes.
        </Notice>
      )}

      {ai ? (
        <Card className="bg-accent-soft/60">
          <p className="text-lg font-semibold leading-snug">{ai.headline}</p>
        </Card>
      ) : (
        <Notice tone="warn" title="AI-written feedback is not available for this session">
          {s.report.aiUnavailableReason ?? "The written feedback could not be generated."} The coaching below is still based on what you actually said and did.
          {canRetryAi && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="secondary" icon={<ArrowClockwise size={18} aria-hidden />} onClick={() => void retryAi()} disabled={retrying}>
                {retrying ? "Writing your feedback..." : "Try again"}
              </Button>
              {retryNote && <span role="status">{retryNote}</span>}
            </div>
          )}
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      {/* 1. READING */}
      <Section icon={<BookOpenText size={22} weight="duotone" />} title="1. How you did while reading" subtitle="From your reading-aloud results, or your reading time if you read silently." tag={<SourceTag kind="measured" />}>
        {ai?.reading ? (
          <div className="space-y-5">
            <p className="text-[0.95rem]">{ai.reading.summary}</p>
            {ai.reading.wentWell.length > 0 && (
              <Block title="What went well" tone="good">
                <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
                  {ai.reading.wentWell.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </Block>
            )}
            {ai.reading.improve.length > 0 && (
              <Block title="What to fix" tone="warn">
                <ul className="space-y-3">
                  {ai.reading.improve.map((t, i) => (
                    <li key={i} className="rounded-xl border border-warn/25 bg-warn-soft/50 p-3 text-[0.95rem]">
                      <p className="font-semibold">{t.issue}</p>
                      <p className="mt-2 text-sm">
                        <span className="font-semibold">How to fix it: </span>
                        {t.howTo}
                      </p>
                    </li>
                  ))}
                </ul>
              </Block>
            )}
            {aloud?.missedWords.length ? (
              <p className="text-sm text-muted">
                Words the recogniser did not hear clearly (approximate, not a pronunciation score): {aloud.missedWords.slice(0, 8).join(", ")}.
              </p>
            ) : null}
          </div>
        ) : (
          <CoachingList items={readingCoaching} emptyText="No reading data was recorded for this session." />
        )}
        {aloud && (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Words matched" value={`${aloud.accuracyPct}%`} hint="Of words you reached" />
            <Stat label="Passage read" value={`${aloud.coveragePct}%`} />
            <Stat label="Reading pace" value={aloud.wpm !== null ? `${aloud.wpm} wpm` : "n/a"} />
          </div>
        )}
      </Section>

      {/* 2. ANSWERS */}
      <Section icon={<ChatsCircle size={22} weight="duotone" />} title="2. How you did while answering" subtitle="From your spoken answers in the conversation." tag={<SourceTag kind="measured" />}>
        <CoachingList items={answerCoaching} emptyText="Not enough answers were captured to coach on." />

        {sayItBetter.length > 0 && (
          <div className="space-y-3 border-t border-line pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-extrabold text-accent-ink">
                <ChatCircleText size={20} weight="fill" aria-hidden />
                Instead of this, say it like this
              </h3>
              <SourceTag kind={sayItBetter[0].source === "ai" ? "ai" : "rule"} />
            </div>
            <p className="text-sm text-muted">These are sentences from your talk. Next to each one is a clearer way to say it.</p>
            <ul className="space-y-3">
              {sayItBetter.map((x, i) => (
                <li key={i} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                  <p className="flex items-start gap-2 text-sm">
                    <XCircle size={20} weight="fill" className="mt-px shrink-0 text-warn" aria-hidden />
                    <span>
                      <span className="font-semibold">Instead of saying: </span>
                      <span className="italic text-muted">&ldquo;{x.said}&rdquo;</span>
                    </span>
                  </p>
                  <p className="mt-2.5 flex items-start gap-2">
                    <CheckCircle size={20} weight="fill" className="mt-px shrink-0 text-good" aria-hidden />
                    <span>
                      <span className="text-sm font-semibold">Say it like this: </span>
                      <span className="font-bold">&ldquo;{x.better}&rdquo;</span>
                    </span>
                  </p>
                  <p className="mt-2 pl-7 text-sm text-muted">{x.why}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ai && (
          <div className="space-y-5 border-t border-line pt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">What the AI coach noticed in your words</h3>
              <SourceTag kind="ai" />
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Block title="What went well" tone="good">
                <ul className="space-y-4">
                  {ai.strengths.map((x, i) => (
                    <li key={i}>
                      <p className="font-semibold">{x.title}</p>
                      <p className="text-[0.95rem] text-muted">{x.detail}</p>
                      {x.quote && <Quote>{x.quote}</Quote>}
                    </li>
                  ))}
                </ul>
              </Block>
              <Block title="What to fix" tone="warn">
                <ul className="space-y-4">
                  {ai.improvements.map((x, i) => (
                    <li key={i}>
                      <p className="font-semibold">{x.title}</p>
                      <p className="text-[0.95rem] text-muted">{x.detail}</p>
                      {x.quote && <Quote>{x.quote}</Quote>}
                      <p className="mt-2 text-sm">
                        <span className="font-semibold">How to fix it: </span>
                        {x.tip}
                      </p>
                    </li>
                  ))}
                </ul>
              </Block>
            </div>

            <details className="rounded-xl border border-line p-4">
              <summary className="cursor-pointer font-semibold">Grammar, vocabulary and answer structure</summary>
              <div className="mt-4 space-y-5">
                <Block title="Grammar" tone="neutral">
                  {ai.grammar.length === 0 ? (
                    <p className="text-[0.95rem] text-muted">No clear grammar mistakes were found in what you said. Nice work.</p>
                  ) : (
                    <ul className="space-y-3">
                      {ai.grammar.map((g, i) => (
                        <li key={i} className="rounded-xl border border-line p-3 text-[0.95rem]">
                          <p>
                            <span className="font-semibold">You said: </span>
                            <span className="italic">&ldquo;{g.quote}&rdquo;</span>
                          </p>
                          <p>
                            <span className="font-semibold">Better: </span>
                            <span className="text-good">&ldquo;{g.suggestion}&rdquo;</span>
                          </p>
                          <p className="text-sm text-muted">{g.issue}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted">Spoken answers come from speech recognition, so punctuation and spelling are not judged.</p>
                </Block>
                <Block title="Vocabulary" tone="neutral">
                  <p className="text-[0.95rem] text-muted">{ai.vocabulary.summary}</p>
                  {ai.vocabulary.upgrades.length > 0 && (
                    <ul className="space-y-1 text-[0.95rem]">
                      {ai.vocabulary.upgrades.map((u, i) => (
                        <li key={i}>
                          Instead of <span className="font-semibold">&ldquo;{u.said}&rdquo;</span>, try <span className="font-semibold text-accent-dark">&ldquo;{u.tryInstead}&rdquo;</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>
                <Block title="Clarity, structure and relevance" tone="neutral">
                  <p className="text-[0.95rem] text-muted">{ai.structure.summary}</p>
                  {ai.structure.perAnswer.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[32rem] text-left text-sm">
                        <caption className="sr-only">Scores for each answer out of 5</caption>
                        <thead>
                          <tr className="border-b border-line text-muted">
                            <th className="py-2 pr-3">Answer</th>
                            <th className="px-2">Relevance</th>
                            <th className="px-2">Detail</th>
                            <th className="px-2">Organisation</th>
                            <th className="pl-3">Comment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ai.structure.perAnswer.map((a) => (
                            <tr key={a.answerNumber} className="border-b border-line/60 align-top">
                              <td className="py-2 pr-3 font-semibold">{a.answerNumber}</td>
                              <td className="px-2">{a.relevance}/5</td>
                              <td className="px-2">{a.completeness}/5</td>
                              <td className="px-2">{a.organization}/5</td>
                              <td className="pl-3 text-muted">{a.comment}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Block>
              </div>
            </details>
          </div>
        )}
      </Section>

      {/* 3. CAMERA */}
      <Section
        icon={<Camera size={22} weight="duotone" />}
        title="3. Camera: your face and body"
        subtitle="What went well, what to fix, and how to fix it. The camera only sees where your face and body are, not how you feel."
        tag={<SourceTag kind="measured" />}
      >
        {hasCameraData ? (
          <>
            {cameraCoaching.length > 0 ? (
              <CoachingList items={cameraCoaching} />
            ) : (
              <ul className="list-disc space-y-2 pl-5 text-[0.95rem] text-muted">
                {s.report.bodyLanguageNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <p className="rounded-xl bg-paper p-3 text-sm text-muted">
              These are observations of visible cues only. They say nothing about how you feel, how confident you are, or how honest you are, and a camera
              cannot tell that.
            </p>
          </>
        ) : (
          <p className="text-muted">
            The camera was off or its analysis was not available this time, so there are no body-language observations. Turn the camera on at the start of
            your next session to get feedback on your posture, eye-line and movement. Everything else in your report is unaffected.
          </p>
        )}
      </Section>

      <Section icon={<Target size={22} weight="duotone" />} title="Practice before next time" tag={ai ? <SourceTag kind="ai" /> : <SourceTag kind="rule" />}>
        <ul className="space-y-3">
          {exercises.map((e, i) => (
            <li key={i} className="rounded-xl border border-line p-3">
              <p className="font-semibold">
                {e.title} <span className="text-sm font-normal text-muted">· about {e.minutes} min</span>
              </p>
              <p className="text-[0.95rem] text-muted">{e.instructions}</p>
            </li>
          ))}
        </ul>
        {ai && (
          <p className="font-semibold">
            Next session focus: <span className="font-normal text-muted">{ai.nextSessionFocus}</span>
          </p>
        )}
        <div className="rounded-xl bg-accent-soft/60 p-4">
          <p className="font-semibold">Recommended next session</p>
          <p className="text-sm text-muted">
            {rec.module.title} ({rec.module.level}) · focus on {getGoal(rec.goal).name.toLowerCase()}. {rec.reason}
          </p>
          <div className="mt-3">
            <ButtonLink href={`/practice/${rec.module.id}?goal=${rec.goal}`}>Practise this next</ButtonLink>
          </div>
        </div>
      </Section>

      </div>

      <details className="rounded-card border border-line bg-surface p-5">
        <summary className="cursor-pointer text-lg font-bold">All the numbers</summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Speaking pace" value={sp.wpm !== null ? `${sp.wpm} wpm` : "n/a"} hint={paceLabel(sp.wpm)} />
            <Stat
              label="Filler words"
              value={
                sp.fillerPer100 !== null ? (
                  <>
                    {sp.fillerPer100} <span className="text-sm font-semibold text-muted">per 100 words</span>
                  </>
                ) : (
                  "n/a"
                )
              }
              hint={
                sp.fillerPer100 !== null
                  ? `Fillers like um, uh, you know, basically, for every 100 words you said. Lower is better. You said ${sp.fillerCount} in ${sp.totalWords} words.`
                  : "Not enough words to count"
              }
            />
            <Stat
              label="Long pauses"
              value={sp.voiceTurns > 0 ? sp.pauseCount : "n/a"}
              hint={sp.voiceTurns > 0 ? `Longest ${sp.longestPauseSec}s (over 1s counted)` : "Needs voice answers"}
            />
            <Stat label="Answer length" value={sp.avgAnswerWords !== null ? `${sp.avgAnswerWords} words` : "n/a"} hint="Average per answer" />
            {sp.lexicalVariety !== null && <Stat label="Word variety" value={`${Math.round(sp.lexicalVariety * 100)}%`} hint="Different words in first 200" />}
            <Stat label="Thinking time" value={sp.avgLatencySec !== null ? `${sp.avgLatencySec}s` : "n/a"} hint="Before you started answering" />
            {v && <Stat label="Face in view" value={`${v.facePresentPct}%`} hint={`${v.framesAnalyzed} camera frames`} />}
            {v && <Stat label="Facing camera" value={v.cameraFacingPct !== null ? `${v.cameraFacingPct}%` : "n/a"} />}
          </div>
          <ul className="list-disc space-y-2 pl-5 text-[0.95rem] text-muted">
            {s.report.speechNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      </details>

      <Section title="Conversation transcript">
        {s.transcriptKept && s.turns.length > 0 ? (
          <details>
            <summary className="cursor-pointer font-semibold">Show what was said</summary>
            <ol className="mt-3 space-y-3 text-sm">
              {s.turns.map((t) => (
                <li key={t.id}>
                  <span className="font-semibold">{t.role === "coach" ? "Coach" : "You"}: </span>
                  {t.text}
                  {t.inputMode === "typed" && <span className="ml-2 text-xs text-muted">(typed)</span>}
                </li>
              ))}
            </ol>
          </details>
        ) : (
          <p className="text-muted">The transcript was not saved. You can change this in Settings.</p>
        )}
      </Section>

      <details className="rounded-card border border-line bg-surface p-5 text-sm text-muted">
        <summary className="cursor-pointer font-semibold text-ink">How these results were measured, and what they cannot tell you</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Pace, pauses and thinking time come from the microphone and the words recognised from your speech. Noisy rooms can affect them.</li>
          <li>Speech recognition often leaves out &ldquo;um&rdquo; and &ldquo;uh&rdquo;, so filler counts can be lower than the truth.</li>
          <li>We do not score pronunciation or accent. Reading-aloud results only show which words the recogniser did not hear clearly.</li>
          <li>Grammar, vocabulary, structure and relevance are written by an AI model. They are helpful opinions, not exam marks.</li>
          <li>Camera numbers describe what a camera can see. They do not show emotion, confidence, personality or honesty.</li>
        </ul>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/progress" className="inline-flex items-center gap-1.5 font-semibold text-accent-ink underline-offset-4 hover:underline">
          See your progress
          <ArrowRight size={16} aria-hidden />
        </Link>
        {!confirmDelete ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete this session
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
            <span className="text-sm font-semibold">Delete this report permanently?</span>
            <Button
              variant="danger"
              onClick={() => {
                deleteSession(s.id);
                router.replace("/progress");
              }}
            >
              Yes, delete
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
