"use client";

import { CaretDown, CheckCircle } from "@phosphor-icons/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { FIELDS, GOALS, NOT_SURE_NAME, STUDENT_FIELDS, fieldChoiceName, goalChoiceName } from "@/features/content/fields";
import { cleanName, NAME_MAX, stripName } from "@/features/session/name";
import type { Profile } from "@/features/session/types";
import { ConsentNotice } from "./privacy-explainer";
import { Button, Card } from "./ui";

function Choice({
  checked,
  onChange,
  name,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  title: string;
  description?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
        checked ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-paper"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      {checked && <CheckCircle size={22} weight="fill" className="shrink-0 text-accent" aria-hidden />}
    </label>
  );
}

/** A profile section that opens when tapped, and shows the current choice while it is closed. */
function Fold({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      data-section={id}
      className="group rounded-card border border-line bg-surface shadow-card"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card p-5 md:p-6 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-lg font-bold">{title}</span>
          <span className="block text-sm text-muted">{summary}</span>
        </span>
        <CaretDown size={22} weight="bold" aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-line p-5 md:p-6">{children}</div>
    </details>
  );
}

export function ProfileForm({
  initial,
  submitLabel,
  askConsent,
  collapsible = false,
  onSubmit,
}: {
  initial?: Profile | null;
  submitLabel: string;
  /** First-time setup: show the privacy explanation and require consent. */
  askConsent: boolean;
  /** Profile page: each section opens when tapped. First-time setup shows everything. */
  collapsible?: boolean;
  onSubmit: (profile: Profile) => void;
}) {
  const [name, setName] = useState(initial?.displayName ?? "");
  const [field, setField] = useState<Profile["field"]>(initial?.field ?? "management-leadership");
  const [goal, setGoal] = useState<Profile["goal"]>(initial?.goal ?? "confidence");
  const [understood, setUnderstood] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const fold = (id: string) => ({ id, open: !!open[id], onToggle: (v: boolean) => setOpen((o) => ({ ...o, [id]: v })) });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!cleanName(name)) next.name = "Please enter your name using letters.";
    if (askConsent && !understood) next.consent = "Please tick the box to agree before you start.";
    setErrors(next);
    if (next.name) setOpen((o) => ({ ...o, about: true }));
    if (Object.keys(next).length) return;

    // Nobody is asked their age or the difficulty: every student is an adult learner, and the difficulty follows their sessions.
    onSubmit({
      displayName: cleanName(name),
      ageBand: "18plus",
      field,
      level: "unsure",
      goal,
      consent: initial?.consent ?? { acceptedAt: Date.now(), guardianConfirmed: false },
    });
  }

  const aboutFields = (
    <>
      <div>
        <label htmlFor="displayName" className="block text-sm font-semibold">
          Your name
        </label>
        <input
          id="displayName"
          value={name}
          onChange={(e) => setName(stripName(e.target.value))}
          maxLength={NAME_MAX}
          autoComplete="off"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "name-error" : "name-help"}
          className="mt-1 min-h-11 w-full max-w-sm rounded-xl border border-line bg-surface px-3"
        />
        <p id="name-help" className="mt-1 text-sm text-muted">
          Use the name your college knows you by. Your college admin sees it with your reports. Emojis are not allowed.
        </p>
        {errors.name && (
          <p id="name-error" className="mt-1 text-sm font-semibold text-bad">
            {errors.name}
          </p>
        )}
      </div>
    </>
  );

  const fieldChoices = (
    <fieldset>
      <legend className="text-sm font-semibold">Your management specialization</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {FIELDS.filter((f) => STUDENT_FIELDS.includes(f.id))
          .sort((a, b) => STUDENT_FIELDS.indexOf(a.id) - STUDENT_FIELDS.indexOf(b.id))
          .map((f) => (
          <Choice key={f.id} name="field" title={f.name} description={f.description} checked={field === f.id} onChange={() => setField(f.id)} />
          ))}
        <Choice name="field" title={NOT_SURE_NAME} description="Not sure? We will show you a mix of management subjects to try." checked={field === "unsure"} onChange={() => setField("unsure")} />
      </div>
    </fieldset>
  );
  const goalChoices = (
    <fieldset>
      <legend className="text-sm font-semibold">What do you want to improve?</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {GOALS.map((g) => (
          <Choice key={g.id} name="goal" title={g.name} description={g.description} checked={goal === g.id} onChange={() => setGoal(g.id)} />
        ))}
        <Choice name="goal" title={NOT_SURE_NAME} description="Not sure? We will show you a module for every goal to try." checked={goal === "unsure"} onChange={() => setGoal("unsure")} />
      </div>
    </fieldset>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {collapsible ? (
        <div className="space-y-4">
          <Fold {...fold("about")} title="About you" summary={name.trim() || "No name yet"}>
            {aboutFields}
          </Fold>
          <Fold {...fold("subject")} title="Your specialization" summary={fieldChoiceName(field)}>
            {fieldChoices}
          </Fold>
          <Fold {...fold("goal")} title="What do you want to improve?" summary={goalChoiceName(goal)}>
            {goalChoices}
          </Fold>
        </div>
      ) : (
        <>
          <Card className="space-y-5">
            <h2 className="text-lg font-bold">1. About you</h2>
            {aboutFields}
          </Card>
          <Card className="space-y-5">
            <h2 className="text-lg font-bold">2. Your specialization and goal</h2>
            {fieldChoices}
            {goalChoices}
          </Card>
        </>
      )}

      {askConsent && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">3. Permission</h2>
          <ConsentNotice />
          <Card className="space-y-3">
            <label className="flex gap-3">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--color-accent)]" />
              <span>I understand and agree.</span>
            </label>
            {errors.consent && <p className="text-sm font-semibold text-bad">{errors.consent}</p>}
          </Card>
        </div>
      )}

      <Button type="submit" className="w-full sm:w-auto">
        {submitLabel}
      </Button>
    </form>
  );
}
