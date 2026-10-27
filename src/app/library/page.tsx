"use client";

import { ArrowRight, Clock } from "@phosphor-icons/react";
import Link from "next/link";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { LEVELS, getField, getGoal } from "@/features/content/fields";
import { modulesFor } from "@/features/content/modules";
import { planSession } from "@/features/progress/daily-limit";
import { recommendNext } from "@/features/progress/stats";
import { countWords } from "@/features/speech/metrics";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

/**
 * The library shows only the modules for the subject and goal saved in the student's profile, with
 * their own difficulty first. There is nothing to filter here: the subject, difficulty and goal are
 * changed in the profile, and this page follows automatically.
 */
export default function LibraryPage() {
  const profile = useProfile();
  const sessions = useSessions();
  const hydrated = useHydrated();
  const now = useNow();
  if (!profile || !hydrated) return null;

  const plan = planSession(sessions, now);
  const rec = recommendNext(profile, sessions);
  const field = getField(profile.field);
  const goal = getGoal(profile.goal);
  const levelOrder = (id: string) => LEVELS.findIndex((l) => l.id === id);
  const list = modulesFor(profile.field, profile.goal).sort((a, b) => {
    if (a.level === profile.level) return -1;
    if (b.level === profile.level) return 1;
    return levelOrder(a.level) - levelOrder(b.level);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${field.name} modules`}
        subtitle={`Made for your goal: ${goal.name.toLowerCase()}. Your own level comes first.`}
        action={
          <Link href="/profile" className="text-sm font-bold text-accent-ink underline-offset-4 hover:underline">
            Change subject or goal in your profile
          </Link>
        }
      />

      {!plan.canStart && (
        <p role="status" className="rounded-xl border border-good/20 bg-good-soft px-4 py-3 text-sm font-semibold text-good">
          {plan.reason}
        </p>
      )}

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((m) => {
          const times = sessions.filter((s) => s.moduleId === m.id && s.completed).length;
          const readMin = Math.max(1, Math.round(countWords(m.passage) / 150));
          return (
            <li key={m.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="accent">{m.level}</Badge>
                  {m.level === profile.level && <Badge tone="good">Your level</Badge>}
                  {rec.module.id === m.id && <Badge tone="good">Recommended</Badge>}
                  {times > 0 && <Badge>Practised {times}x</Badge>}
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-snug">{m.title}</h2>
                  <p className="text-sm text-muted">Focus: {goal.name}</p>
                </div>
                <p className="flex-1 text-[0.95rem] text-muted">{m.summary}</p>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <Clock size={14} aria-hidden />
                  About {readMin} min reading · 5-8 min conversation
                </p>
                {plan.canStart ? (
                  <ButtonLink href={`/practice/${m.id}`}>
                    Start this module
                    <ArrowRight size={16} aria-hidden />
                  </ButtonLink>
                ) : (
                  <p className="text-sm text-muted">Come back tomorrow to practise.</p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
