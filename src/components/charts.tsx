// Small dependency-free SVG charts. Each has a text summary for screen readers.

export function Ring({ value, max, label, children }: { value: number; max: number; label: string; children?: React.ReactNode }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative h-40 w-40 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-line)" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function BarChart({
  data,
  max,
  limit,
  unit,
  title,
}: {
  data: { label: string; value: number }[];
  max?: number;
  /** Draws a dashed reference line at this value (for example the 20-minute daily limit). */
  limit?: number;
  unit: string;
  title: string;
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  const summary = data.map((d) => `${d.label}: ${d.value} ${unit}`).join(", ");
  const limitY = limit !== undefined ? 110 - (Math.min(limit, top) / top) * 100 : null;
  return (
    <figure>
      <svg viewBox="0 0 320 140" className="mx-auto w-full max-w-lg" role="img" aria-label={`${title}. ${summary}`}>
        <line x1="0" y1="110" x2="320" y2="110" stroke="var(--color-line)" />
        {limitY !== null && (
          <>
            <line x1="0" y1={limitY} x2="320" y2={limitY} stroke="var(--color-muted)" strokeDasharray="4 4" opacity="0.5" />
            <text x="318" y={limitY - 4} textAnchor="end" fontSize="9" fill="var(--color-muted)">
              {limit} min limit
            </text>
          </>
        )}
        {data.map((d, i) => {
          const w = 320 / data.length;
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / top) * 100);
          const isLast = i === data.length - 1;
          return (
            <g key={d.label + i}>
              <rect x={i * w + w * 0.22} y={110 - h} width={w * 0.56} height={h} rx="6" fill={isLast ? "var(--color-accent-dark)" : "var(--color-accent)"} opacity={d.value > 0 ? 1 : 0.15} />
              <text x={i * w + w / 2} y="129" textAnchor="middle" fontSize="11" fontWeight={isLast ? 700 : 500} fill={isLast ? "var(--color-ink)" : "var(--color-muted)"}>
                {d.label}
              </text>
              {d.value > 0 && (
                <text x={i * w + w / 2} y={104 - h} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-ink)">
                  {d.value}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function LineChart({
  values,
  labels,
  unit,
  title,
}: {
  values: (number | null)[];
  labels: string[];
  unit: string;
  title: string;
}) {
  const nums = values.filter((v): v is number => v !== null);
  // With fewer than two measurements there is nothing to plot, so show nothing rather than a message.
  if (nums.length < 2) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const W = 320;
  const H = 130;
  const pad = 22;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, values.length - 1);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);

  const pts = values.map((v, i) => (v === null ? null : { x: x(i), y: y(v), v }));
  const path = pts
    .filter((p): p is { x: number; y: number; v: number } => p !== null)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const summary = values.map((v, i) => `${labels[i]}: ${v === null ? "no data" : `${v} ${unit}`}`).join(", ");

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title}. ${summary}`}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--color-line)" />
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(
          (p, i) =>
            p && (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="4" fill="var(--color-accent)" />
                <text x={p.x} y={p.y - 9} textAnchor="middle" fontSize="10" fill="var(--color-ink)">
                  {p.v}
                </text>
              </g>
            ),
        )}
        {labels.map((l, i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--color-muted)">
            {l}
          </text>
        ))}
      </svg>
    </figure>
  );
}
