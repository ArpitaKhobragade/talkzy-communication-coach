"use client";

import { ArrowRight, Clock } from "@phosphor-icons/react";
import Link from "next/link";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { getField, getGoal } from "@/features/content/fields";
import { modulesForProfile, type ProfileModules } from "@/features/content/modules";
import { planSession } from "@/features/progress/daily-limit";
import { recommendNext } from "@/features/progress/stats";
import type { Profile } from "@/features/session/types";
import { countWords } from "@/features/speech/metrics";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";


/** What the library says about itself. The difficulty is never chosen: it follows the student's sessions. */
function intro(profile: Profile, unsure: ProfileModules["unsure"]): { title: string; subtitle: string } {
  const { field, goal } = profile;
  const title = field !== "unsure" ? `${getField(field).name} modules` : "Modules to try";
  const subtitle =
    field !== "unsure" && goal !== "unsure"
      ? `Made for your goal: ${getGoal(goal).name.toLowerCase()}. The difficulty is picked for you and goes up as you improve.`
      : unsure.goal
        ? "You are not sure what to improve yet, and that is fine. Here is a module for every goal. Pick any one to begin."
        : "Pick any module to begin. The difficulty is picked for you and goes up as you improve.";
  return { title, subtitle };
}

/**
 * The library shows the modules for the subject, difficulty and goal saved in the student's profile,
 * with their own difficulty first. A choice left as "not sure yet" gets a helpful mix instead. There is
 * nothing to filter here: everything is changed in the profile, and this page follows automatically.
 */
export default function LibraryPage() {
  const profile = useProfile();
  const sessions = useSessions();
  const hydrated = useHydrated();
  const now = useNow();
  if (!profile || !hydrated) return null;

  const plan = planSession(sessions, now);
  const rec = recommendNext(profile, sessions);
  const { modules: found, unsure } = modulesForProfile(profile);
  // The module at the student's current difficulty comes first.
  const list = [...found.filter((m) => m.level === rec.module.level), ...found.filter((m) => m.level !== rec.module.level)];
  const anyUnsure = unsure.field || unsure.goal;
  const { title, subtitle } = intro(profile, unsure);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
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

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="library-list">
        {list.map((m, i) => {
          const times = sessions.filter((s) => s.moduleId === m.id && s.completed).length;
          const readMin = Math.max(1, Math.round(countWords(m.passage) / 150));
          const startHere = anyUnsure && i === 0;
          return (
            <li key={m.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="accent">{m.level}</Badge>
                  {startHere && <Badge tone="good">Start here</Badge>}
                  {m.level === rec.module.level && !startHere && <Badge tone="good">Your level now</Badge>}
                  {rec.module.id === m.id && !startHere && <Badge tone="good">Recommended</Badge>}
                  {times > 0 && <Badge>Practised {times}x</Badge>}
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-snug">{m.title}</h2>
                  <p className="text-sm text-muted">
                    {unsure.field ? `${getField(m.field).name} · ` : ""}Focus: {getGoal(m.goal).name}
                  </p>
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
