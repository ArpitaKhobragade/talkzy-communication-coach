"use client";

import Link from "next/link";
import { BarChart, LineChart } from "@/components/charts";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { getGoal } from "@/features/content/fields";
import { getModule } from "@/features/content/modules";
import { currentStreak, minutesPerDay } from "@/features/progress/daily-limit";
import { progressInsights, recommendNext, trendSeries } from "@/features/progress/stats";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

/** A trend chart with a plain-language explanation. Shown only when there are two or more measurements. */
function ChartCard({
  title,
  explain,
  values,
  labels,
  unit,
  chartTitle,
}: {
  title: string;
  explain: string;
  values: (number | null)[];
  labels: string[];
  unit: string;
  chartTitle: string;
}) {
  if (values.filter((v) => v !== null).length < 2) return null;
  return (
    <Card>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mb-2 text-sm text-muted">{explain}</p>
      <LineChart values={values} labels={labels} unit={unit} title={chartTitle} />
    </Card>
  );
}

const shortDate =(ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function ProgressPage() {
  const profile = useProfile();
  const sessions = useSessions();
  const hydrated = useHydrated();
  const now = useNow();
  if (!profile || !hydrated) return null;

  const completed = sessions.filter((s) => s.completed);
  const pts = trendSeries(sessions).slice(-10);
  const labels = pts.map((p) => shortDate(p.startedAt));
  const insights = progressInsights(sessions);
  const rec = recommendNext(profile, sessions);
  const totalMin = Math.round(sessions.reduce((n, s) => n + s.durationSec, 0) / 60);
  const week = minutesPerDay(sessions, now, 7);

  return (
    <div className="space-y-6">
      <PageHeader title="Progress and history" subtitle="See how your speaking changes over time." />

      {sessions.length === 0 ? (
        <EmptyState title="Nothing here yet" action={<ButtonLink href={`/practice/${rec.module.id}?goal=${rec.goal}`}>Start your first session</ButtonLink>}>
          Your sessions will appear here after you practise.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Completed sessions" value={completed.length} />
            <Stat label="Total practice" value={`${totalMin} min`} />
            <Stat label="Current streak" value={`${currentStreak(sessions, now)} day${currentStreak(sessions, now) === 1 ? "" : "s"}`} />
            <Stat label="Last 7 days" value={`${Math.round(week.reduce((n, d) => n + d.minutes, 0))} min`} />
          </div>

          {/* Appears by itself once there are two sessions to compare. */}
          {insights.length > 0 && (
            <Card className="space-y-3">
              <h2 className="text-lg font-bold">What is changing</h2>
              <ul className="space-y-2">
                {insights.map((i) => (
                  <li key={i.label} className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.direction === "better" ? "good" : i.direction === "worse" ? "warn" : "neutral"}>
                      {i.direction === "better" ? "Improving" : i.direction === "worse" ? "Needs attention" : "Steady"}
                    </Badge>
                    <span className="font-semibold">{i.label}:</span>
                    <span className="text-muted">{i.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <ChartCard
              title="Speaking pace (words per minute)"
              explain="How many words you say each minute while speaking. Around 120 to 150 is comfortable."
              values={pts.map((p) => p.wpm)}
              labels={labels}
              unit="wpm"
              chartTitle="Speaking pace by session"
            />
            <ChartCard
              title="Filler words per 100 words"
              explain="How many filler words (um, uh, you know, basically) you said for every 100 words. Lower is better."
              values={pts.map((p) => p.fillerPer100)}
              labels={labels}
              unit="per 100 words"
              chartTitle="Filler words per 100 words, by session"
            />
            <ChartCard
              title="Average answer length (words)"
              explain="The average number of words in each of your answers. Longer answers show more of your thinking."
              values={pts.map((p) => p.avgAnswerWords)}
              labels={labels}
              unit="words"
              chartTitle="Answer length by session"
            />
            <Card>
              <h2 className="mb-2 text-lg font-bold">Practice minutes, last 7 days</h2>
              <BarChart data={week.map((d) => ({ label: d.label, value: d.minutes }))} max={20} unit="minutes" title="Practice minutes per day" />
            </Card>
          </div>

          <Card className="space-y-2">
            <Badge tone="good">Recommended next</Badge>
            <h2 className="text-lg font-bold">{rec.module.title}</h2>
            <p className="text-muted">
              Focus: {getGoal(rec.goal).name}. {rec.reason}
            </p>
            <ButtonLink href={`/practice/${rec.module.id}?goal=${rec.goal}`}>Practise this</ButtonLink>
          </Card>

          <section aria-labelledby="history-heading" className="space-y-3">
            <h2 id="history-heading" className="text-lg font-bold">
              Session history
            </h2>
            <ul className="space-y-3">
              {sessions.map((s) => {
                const m = getModule(s.moduleId);
                return (
                  <li key={s.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
                      <div className="space-y-1">
                        <p className="font-semibold">{m?.title ?? "Practice session"}</p>
                        <p className="text-sm text-muted">
                          {new Date(s.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {Math.max(1, Math.round(s.durationSec / 60))} min ·{" "}
                          {s.speech.wpm !== null ? `${s.speech.wpm} wpm · ` : ""}
                          {s.speech.totalWords} words
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge>{s.level}</Badge>
                          <Badge tone={s.mode === "live" ? "good" : "warn"}>{s.mode === "live" ? "AI coach" : "Dev mode"}</Badge>
                          {!s.completed && <Badge tone="warn">Short session</Badge>}
                        </div>
                      </div>
                      <Link href={`/report/${s.id}`} className="font-semibold text-accent underline-offset-4 hover:underline">
                        Open report
                      </Link>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
