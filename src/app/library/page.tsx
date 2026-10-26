"use client";

import { ArrowRight, Clock } from "@phosphor-icons/react";
import { useState } from "react";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { FIELDS, LEVELS } from "@/features/content/fields";
import { MODULES } from "@/features/content/modules";
import type { FieldId, Level } from "@/features/content/types";
import { planSession } from "@/features/progress/daily-limit";
import { recommendNext } from "@/features/progress/stats";
import { countWords } from "@/features/speech/metrics";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

export default function LibraryPage() {
  const profile = useProfile();
  const sessions = useSessions();
  const hydrated = useHydrated();
  const now = useNow();
  const [field, setField] = useState<FieldId | "all" | null>(null);
  const [level, setLevel] = useState<Level | "all">("all");
  if (!profile || !hydrated) return null;

  const activeField = field ?? profile.field;
  const plan = planSession(sessions, now);
  const rec = recommendNext(profile, sessions);
  const list = MODULES.filter((m) => (activeField === "all" || m.field === activeField) && (level === "all" || m.level === level));

  const chip = (active: boolean) =>
    `min-h-10 rounded-full border px-4 text-sm font-semibold ${active ? "border-accent bg-accent-soft text-accent-dark" : "border-line bg-surface text-muted hover:text-ink"}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Learning modules" subtitle="Each module has a reading passage and conversation questions for one field and difficulty." />

      <div className="space-y-3">
        <div role="group" aria-label="Filter by field" className="flex flex-wrap gap-2">
          <button type="button" className={chip(activeField === "all")} aria-pressed={activeField === "all"} onClick={() => setField("all")}>
            All fields
          </button>
          {FIELDS.map((f) => (
            <button key={f.id} type="button" className={chip(activeField === f.id)} aria-pressed={activeField === f.id} onClick={() => setField(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Filter by difficulty" className="flex flex-wrap gap-2">
          <button type="button" className={chip(level === "all")} aria-pressed={level === "all"} onClick={() => setLevel("all")}>
            Any level
          </button>
          {LEVELS.map((l) => (
            <button key={l.id} type="button" className={chip(level === l.id)} aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      </div>

      {!plan.canStart && (
        <p role="status" className="rounded-xl border border-good/20 bg-good-soft px-4 py-3 text-sm font-semibold text-good">
          {plan.reason}
        </p>
      )}

      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.map((m) => {
          const field = FIELDS.find((f) => f.id === m.field)!;
          const times = sessions.filter((s) => s.moduleId === m.id && s.completed).length;
          const readMin = Math.max(1, Math.round(countWords(m.passage) / 150));
          return (
            <li key={m.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="accent">{m.level}</Badge>
                  {rec.module.id === m.id && <Badge tone="good">Recommended</Badge>}
                  {times > 0 && <Badge>Practised {times}x</Badge>}
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-snug">{m.title}</h2>
                  <p className="text-sm text-muted">{field.name}</p>
                </div>
                <p className="flex-1 text-[0.95rem] text-muted">{m.summary}</p>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <Clock size={14} aria-hidden />
                  About {readMin} min reading · 5-8 min conversation
                </p>
                {plan.canStart ? (
                  <ButtonLink href={`/practice/${m.id}?goal=${profile.goal}`}>
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
      {list.length === 0 && <p className="text-muted">No modules match these filters.</p>}
    </div>
  );
}
