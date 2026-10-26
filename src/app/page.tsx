"use client";

import { ArrowRight, BookOpenText, ChatsCircle, Fire, Microphone } from "@phosphor-icons/react";
import Link from "next/link";
import { BarChart, Ring } from "@/components/charts";
import { Badge, ButtonLink, Card, EmptyState, IconChip, Notice, PageHeader, Stat } from "@/components/ui";
import { getField, getGoal } from "@/features/content/fields";
import { currentStreak, DAILY_LIMIT_SEC, minutesPerDay, planSession } from "@/features/progress/daily-limit";
import { recommendNext } from "@/features/progress/stats";
import { DevModeBanner, useCoachMode } from "@/services/use-coach-mode";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

export default function DashboardPage() {
  const profile = useProfile();
  const sessions = useSessions();
  const hydrated = useHydrated();
  const mode = useCoachMode();
  const now = useNow();
  if (!profile || !hydrated) return null;

  const plan = planSession(sessions, now);
  const rec = recommendNext(profile, sessions);
  const completed = sessions.filter((s) => s.completed);
  const last = sessions[0];
  const streak = currentStreak(sessions, now);
  const totalMinutes = Math.round(sessions.reduce((n, s) => n + s.durationSec, 0) / 60);
  const week = minutesPerDay(sessions, now, 7);
  const usedMin = Math.round(plan.usedSec / 60);
  const leftMin = Math.max(0, Math.round(plan.remainingSec / 60));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hi ${profile.displayName}!`}
        subtitle={`${getField(profile.field).name} · ${getGoal(profile.goal).name}`}
        action={
          <Badge tone={streak > 0 ? "warn" : "neutral"} icon={<Fire size={14} weight="fill" aria-hidden />}>
            {streak > 0 ? `${streak}-day streak` : "Start your streak today"}
          </Badge>
        }
      />
      <DevModeBanner mode={mode} />

      {/* Today: the daily 20-minute allowance and the one thing to do next. */}
      <Card className="grid overflow-hidden !p-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="flex items-center gap-5 p-6 md:flex-col md:justify-center md:gap-3 md:p-8 md:text-center">
          <Ring value={plan.usedSec} max={DAILY_LIMIT_SEC} label={`${usedMin} of 20 practice minutes used today`}>
            <div>
              <p className="text-4xl font-extrabold leading-none tracking-tight">{usedMin}</p>
              <p className="mt-1 text-xs font-semibold text-muted">of 20 min today</p>
            </div>
          </Ring>
          <p className="text-sm leading-relaxed text-muted">
            {plan.canStart ? `${leftMin} minutes left today. Each session is about ${Math.round(plan.budgetSec / 60)} minutes.` : plan.reason}
          </p>
        </div>

        <div className="space-y-4 border-t border-line bg-accent-soft/50 p-6 md:border-l md:border-t-0 md:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">Recommended for you</Badge>
            <Badge>{rec.module.level}</Badge>
            <Badge>Focus: {getGoal(rec.goal).name}</Badge>
          </div>
          <div>
            <h2 className="text-2xl font-extrabold leading-tight tracking-tight md:text-[1.7rem]">{rec.module.title}</h2>
            <p className="mt-1.5 text-muted">{rec.module.summary}</p>
            <p className="mt-2 text-sm text-muted">{rec.reason}</p>
          </div>

          <ol className="grid gap-2 sm:grid-cols-2" aria-label="What a session includes">
            <li className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 text-sm shadow-sm">
              <IconChip>
                <BookOpenText size={20} weight="duotone" />
              </IconChip>
              <span>
                <span className="block font-bold">Phase 1: Reading</span>
                <span className="text-muted">Read the passage out loud</span>
              </span>
            </li>
            <li className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 text-sm shadow-sm">
              <IconChip>
                <ChatsCircle size={20} weight="duotone" />
              </IconChip>
              <span>
                <span className="block font-bold">Phase 2: Conversation</span>
                <span className="text-muted">Talk it through with your coach</span>
              </span>
            </li>
          </ol>

          <div className="flex flex-wrap gap-3 pt-1">
            {plan.canStart ? (
              <ButtonLink href={`/practice/${rec.module.id}?goal=${rec.goal}`} size="lg" icon={<Microphone size={20} weight="fill" aria-hidden />}>
                Start today&apos;s practice
              </ButtonLink>
            ) : (
              <Notice tone="good">{plan.reason}</Notice>
            )}
            <ButtonLink href="/library" variant="secondary" size="lg">
              Browse all modules
            </ButtonLink>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-bold">Your last 7 days</h2>
          <p className="mb-3 text-sm text-muted">Minutes practised each day. The dashed line is your 20-minute daily limit.</p>
          <BarChart data={week.map((d) => ({ label: d.label, value: d.minutes }))} max={20} limit={20} unit="minutes" title="Practice minutes per day" />
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Stat label="Sessions completed" value={completed.length} />
          <Stat label="Total practice" value={`${totalMinutes} min`} />
        </div>
      </div>

      <section aria-labelledby="last-heading">
        <h2 id="last-heading" className="mb-3 text-lg font-bold">
          Latest session
        </h2>
        {last ? (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{new Date(last.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
              <p className="text-sm text-muted">
                {Math.round(last.durationSec / 60)} min · {last.speech.totalWords} words spoken or typed ·{" "}
                {last.mode === "live" ? "AI coach" : "Development mode"}
              </p>
            </div>
            <Link href={`/report/${last.id}`} className="inline-flex items-center gap-1.5 font-semibold text-accent-ink underline-offset-4 hover:underline">
              View feedback report
              <ArrowRight size={16} aria-hidden />
            </Link>
          </Card>
        ) : (
          <EmptyState title="No sessions yet">Your first session takes about 10 minutes: read, talk with the coach, and get your report.</EmptyState>
        )}
      </section>
    </div>
  );
}
