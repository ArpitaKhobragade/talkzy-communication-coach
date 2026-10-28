"use client";

import { ArrowRight, Clock } from "@phosphor-icons/react";
import Link from "next/link";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { fieldChoiceName, getField, getGoal, levelChoiceName } from "@/features/content/fields";
import { modulesForProfile, type ProfileModules } from "@/features/content/modules";
import { planSession } from "@/features/progress/daily-limit";
import { recommendNext } from "@/features/progress/stats";
import type { Profile } from "@/features/session/types";
import { countWords } from "@/features/speech/metrics";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

const joinWords = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** What the library says about itself. When the student made all three choices it is the usual heading; otherwise it explains the mix. */
function intro(profile: Profile, unsure: ProfileModules["unsure"]): { title: string; subtitle: string } {
  const { field, level, goal } = profile;
  if (field !== "unsure" && level !== "unsure" && goal !== "unsure") {
    return {
      title: `${getField(field).name} modules`,
      subtitle: `Made for your goal: ${getGoal(goal).name.toLowerCase()}. Your own level comes first.`,
    };
  }
  const chosen: string[] = [];
  if (field !== "unsure") chosen.push(fieldChoiceName(field));
  if (level !== "unsure") chosen.push(levelChoiceName(level));
  if (goal !== "unsure") chosen.push(getGoal(goal).name.toLowerCase());
  const notSure = joinWords([
    ...(unsure.goal ? ["what to improve"] : []),
    ...(unsure.field ? ["which subject to practise"] : []),
    ...(unsure.level ? ["which difficulty to start with"] : []),
  ]);
  const what =
    unsure.field && unsure.level && unsure.goal
      ? "easy modules to try, covering every goal"
      : unsure.goal && unsure.level
        ? "one easy module for every goal"
        : unsure.goal && unsure.field
          ? "one module for every goal, each in a different subject"
          : unsure.field && unsure.level
            ? "one easy module for every subject"
            : unsure.goal
              ? "one module for every goal"
              : unsure.level
                ? "all three difficulties, easiest first"
                : "one module for every subject";
  const subtitle =
    chosen.length === 0
      ? `You are not sure yet, and that is fine. Here are ${what}. Pick any one to begin.`
      : `You chose ${joinWords(chosen)} but are not sure ${notSure}, so here is ${what}.`;
  return { title: "Modules to try", subtitle };
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
  const { modules: list, unsure } = modulesForProfile(profile);
  const anyUnsure = unsure.field || unsure.level || unsure.goal;
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
                  {!unsure.level && m.level === profile.level && <Badge tone="good">Your level</Badge>}
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
