"use client";

import { DownloadSimple, MagnifyingGlass, SignOut } from "@phosphor-icons/react";
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import type { SessionSummary, StudentRecord } from "@/features/admin/types";
import { downloadFile, renderPdf, reportFileName, type DocBlock } from "@/features/report/export";

type View = "loading" | "not-configured" | "sign-in" | "ready" | "error";

const mean = (v: (number | null)[]) => {
  const n = v.filter((x): x is number => x !== null && Number.isFinite(x));
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};
const fmt = (n: number | null, digits = 0) => (n === null ? "-" : n.toFixed(digits));
const day = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "student";

/** The summary of one student: all their sessions are counted, and the numbers come from the last three full ones (or the last three of any kind when none is full). */
function summarise(r: StudentRecord) {
  const full = r.sessions.filter((s) => s.completed);
  const recent = (full.length ? full : r.sessions).slice(0, 3);
  return {
    count: r.sessions.length,
    last: r.sessions[0]?.startedAt ?? null,
    level: r.sessions[0]?.level ?? null,
    answerWords: mean(recent.map((s) => s.avgAnswerWords)),
    fillers: mean(recent.map((s) => s.fillerPer100)),
    wpm: mean(recent.map((s) => s.wpm)),
  };
}

function csvOf(students: StudentRecord[]): string {
  const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Name", "Date", "Module", "Level", "Goal", "Minutes", "Words per minute", "Fillers per 100 words", "Words per answer", "Camera on"]];
  for (const r of students)
    for (const s of r.sessions)
      rows.push([r.name, day(s.startedAt), s.moduleTitle, s.level, s.goal, String(Math.round(s.durationSec / 60)), fmt(s.wpm), fmt(s.fillerPer100, 1), fmt(s.avgAnswerWords), s.cameraOn ? "yes" : "no"]);
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

export default function AdminPage() {
  const [view, setView] = useState<View>("loading");
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [storage, setStorage] = useState<"database" | "memory">("memory");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadStudents = useCallback(async () => {
    const res = await fetch("/api/admin/students", { cache: "no-store" });
    if (res.status === 401) {
      setView("sign-in");
      return;
    }
    if (!res.ok) {
      setView("error");
      return;
    }
    const data = (await res.json()) as { storage: "database" | "memory"; students: StudentRecord[] };
    setStudents(data.students);
    setStorage(data.storage);
    setView("ready");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/login", { cache: "no-store" });
        const state = (await res.json()) as { configured: boolean; signedIn: boolean };
        if (!alive) return;
        if (!state.configured) setView("not-configured");
        else if (!state.signedIn) setView("sign-in");
        else await loadStudents();
      } catch {
        if (alive) setView("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadStudents]);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    setPassword("");
    if (res.ok) {
      await loadStudents();
      return;
    }
    setMessage(
      res.status === 429 ? "Too many tries. Please wait ten minutes." : res.status === 503 ? "The admin password is not set up yet." : "That password is not right.",
    );
  }

  async function signOut() {
    await fetch("/api/admin/login", { method: "DELETE" });
    setStudents([]);
    setView("sign-in");
  }

  async function downloadReport(r: StudentRecord, s: SessionSummary) {
    setBusy(s.id);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/report?studentId=${encodeURIComponent(r.studentId)}&sessionId=${encodeURIComponent(s.id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("missing");
      const { blocks } = (await res.json()) as { blocks: DocBlock[] };
      const bytes = await renderPdf(blocks);
      downloadFile(bytes, `${slug(r.name)}-${reportFileName(s.startedAt, "pdf")}`, "application/pdf");
    } catch {
      setMessage("That report could not be downloaded.");
    } finally {
      setBusy(null);
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((r) => !q || r.name.toLowerCase().includes(q)).map((r) => ({ r, sum: summarise(r) }));
  }, [students, query]);

  if (view === "loading") return <Spinner label="Opening the admin panel" />;

  if (view === "not-configured")
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="Admin panel" />
        <Notice tone="warn" title="The admin password is not set up">
          Add a setting called ADMIN_PASSWORD (at least 8 characters) to the server, then open this page again.
        </Notice>
      </div>
    );

  if (view === "error")
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageHeader title="Admin panel" />
        <Notice tone="warn" role="alert" title="The student list could not be loaded">
          The database did not answer. Check its settings and try again.
        </Notice>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </div>
    );

  if (view === "sign-in")
    return (
      <div className="mx-auto max-w-md space-y-4">
        <PageHeader title="Admin panel" subtitle="Sign in to see your students' progress." />
        <Card>
          <form onSubmit={signIn} className="space-y-4">
            <div>
              <label htmlFor="admin-password" className="block text-sm font-semibold">
                Admin password
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
              />
            </div>
            {message && (
              <p role="alert" className="text-sm font-semibold text-bad">
                {message}
              </p>
            )}
            <Button type="submit" disabled={!password}>
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    );

  return (
    <div className="space-y-6" data-testid="admin-ready">
      <PageHeader
        title="Student progress"
        subtitle={`${students.length} ${students.length === 1 ? "student" : "students"}. Open a student to download their reports.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<DownloadSimple size={18} aria-hidden />}
              disabled={!students.length}
              onClick={() => downloadFile(csvOf(students), "talkzy-students.csv", "text/csv;charset=utf-8")}
            >
              Download all (CSV)
            </Button>
            <Button variant="ghost" icon={<SignOut size={18} aria-hidden />} onClick={signOut}>
              Sign out
            </Button>
          </div>
        }
      />

      {storage === "memory" && (
        <Notice tone="warn" title="No database is connected">
          Students&apos; progress is only kept until the server restarts. Connect a database (Upstash Redis) so that nothing is lost.
        </Notice>
      )}
      {message && (
        <Notice tone="warn" role="alert">
          {message}
        </Notice>
      )}

      <label className="flex max-w-sm items-center gap-2 rounded-xl border border-line bg-surface px-3">
        <MagnifyingGlass size={18} aria-hidden className="text-muted" />
        <span className="sr-only">Search students by name</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" className="min-h-11 w-full bg-transparent outline-none" />
      </label>

      {rows.length === 0 ? (
        <Card>
          <p className="text-muted">{students.length === 0 ? "No student has finished a session yet." : "No student matches that name."}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0 md:p-0">
          <table className="w-full min-w-[44rem] text-left text-sm" data-testid="admin-students">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Sessions</th>
                <th className="px-4 py-3">Last practised</th>
                <th className="px-4 py-3">Level now</th>
                <th className="px-4 py-3">Words per answer</th>
                <th className="px-4 py-3">Fillers per 100</th>
                <th className="px-4 py-3">Words per minute</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, sum }) => (
                <Fragment key={r.studentId}>
                  <tr className="border-b border-line">
                    <td className="px-4 py-3 font-semibold">{r.name}</td>
                    <td className="px-4 py-3">{sum.count}</td>
                    <td className="px-4 py-3">{sum.last ? day(sum.last) : "-"}</td>
                    <td className="px-4 py-3">{sum.level ? <Badge tone="accent">{sum.level}</Badge> : "-"}</td>
                    <td className="px-4 py-3">{fmt(sum.answerWords)}</td>
                    <td className="px-4 py-3">{fmt(sum.fillers, 1)}</td>
                    <td className="px-4 py-3">{fmt(sum.wpm)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === r.studentId ? null : r.studentId)}
                        aria-expanded={openId === r.studentId}
                        className="font-bold text-accent-ink underline-offset-4 hover:underline"
                      >
                        {openId === r.studentId ? "Hide" : "Open"}
                      </button>
                    </td>
                  </tr>
                  {openId === r.studentId && (
                    <tr className="border-b border-line bg-paper">
                      <td colSpan={8} className="px-4 py-4">
                        <ul className="space-y-3" data-testid="admin-sessions">
                          {r.sessions.map((s) => (
                            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold">
                                  {s.moduleTitle} <span className="font-normal text-muted">· {day(s.startedAt)}</span>
                                </p>
                                <p className="text-muted">
                                  {s.level} · {Math.max(1, Math.round(s.durationSec / 60))} min · {s.cameraOn ? "camera on" : "camera off"}{s.completed ? "" : " · short session"}
                                  {s.headline ? ` · ${s.headline}` : ""}
                                </p>
                              </div>
                              <Button variant="secondary" disabled={busy === s.id} icon={<DownloadSimple size={18} aria-hidden />} onClick={() => downloadReport(r, s)}>
                                {busy === s.id ? "Preparing..." : "Download report"}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

