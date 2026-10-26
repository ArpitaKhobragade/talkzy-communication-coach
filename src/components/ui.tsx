import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-extrabold transition duration-150 active:translate-y-px active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
const sizes: Record<Size, string> = {
  md: "min-h-11 px-5 text-[0.95rem]",
  lg: "min-h-13 px-7 text-base",
};
const variants: Record<Variant, string> = {
  primary: "border-2 border-ink bg-ink text-white shadow-sm hover:bg-[#44305c] hover:shadow-lift",
  secondary: "border-2 border-ink bg-transparent text-ink hover:bg-white",
  ghost: "text-accent-ink hover:bg-accent-soft",
  danger: "border-2 border-bad bg-transparent text-bad hover:bg-bad-soft",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <button type="button" className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {icon}
      {children}
    </Link>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-card border border-line bg-surface p-5 shadow-card md:p-6 ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[1.02rem] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "accent";
const tones: Record<Tone, string> = {
  neutral: "bg-paper text-muted border-line",
  good: "bg-good-soft text-good border-good/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  bad: "bg-bad-soft text-bad border-bad/20",
  accent: "bg-accent-soft text-accent-ink border-accent/20",
};

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

/** A rounded square holding an icon, used to anchor section headings. Decorative: always aria-hidden. */
export function IconChip({ tone = "accent", children }: { tone?: Tone; children: ReactNode }) {
  const t: Record<Tone, string> = {
    neutral: "bg-paper text-muted",
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    accent: "bg-accent-soft text-accent-ink",
  };
  return (
    <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${t[tone]}`}>
      {children}
    </span>
  );
}

export function Notice({
  tone = "neutral",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div role={role} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs leading-snug text-muted">{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className="h-3 w-full overflow-hidden rounded-full bg-line"
    >
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/** Tag that separates numbers we measured from opinions the AI wrote. */
export function SourceTag({ kind }: { kind: "measured" | "ai" | "rule" }) {
  if (kind === "ai") return <Badge tone="accent">AI assessment</Badge>;
  if (kind === "rule") return <Badge tone="neutral">Calculated</Badge>;
  return <Badge tone="good">Measured</Badge>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface/60 p-8 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** The two-phase session indicator: Reading, then Conversation. The visible text is the label for assistive tech. */
export function PhaseSteps({ current }: { current: 1 | 2 }) {
  const seg = (on: boolean) => `h-1.5 flex-1 rounded-full ${on ? "bg-accent" : "bg-line"}`;
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      <span className={seg(true)} />
      <span className={seg(current === 2)} />
    </div>
  );
}
