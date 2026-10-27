"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button, ButtonLink, EmptyState } from "@/components/ui";
import { recommendNext } from "@/features/progress/stats";
import type { Session } from "@/features/session/types";
import { buildReportDocument, downloadFile, renderPdf, reportFileName, type DocBlock } from "@/features/report/export";
import { useHydrated, useProfile, useSessions } from "@/services/use-storage";

/** Can this browser show a PDF inside the page? Phones and tablets cannot, so they see the same report as a page. */
function canShowPdf(): boolean {
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
  return nav.pdfViewerEnabled === true && !/Android|iPhone|iPad|iPod|Mobi/i.test(nav.userAgent);
}

/** The same report as the PDF, drawn as a page: black text on white paper. */
function Paper({ blocks }: { blocks: DocBlock[] }) {
  return (
    <article data-testid="report-paper" className="mx-auto w-full max-w-3xl border-2 border-black bg-white px-6 py-8 font-[Arial,Helvetica,sans-serif] text-black md:px-12 md:py-12 [&_h2]:[font-family:inherit] [&_h3]:[font-family:inherit]">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "title":
            return (
              <h2 key={i} className="border-b-4 border-black pb-2 text-3xl font-extrabold">
                {b.text}
              </h2>
            );
          case "meta":
            return (
              <p key={i} className="mt-1 text-sm text-neutral-600">
                {b.text}
              </p>
            );
          case "h2":
            return (
              <h3 key={i} className="mt-8 border-b border-black pb-1 text-xl font-extrabold">
                {b.text}
              </h3>
            );
          case "p":
            return (
              <p key={i} className="mt-3 leading-relaxed">
                {b.text}
              </p>
            );
          case "bullet":
            return (
              <div key={i} className="mt-3 flex gap-3">
                <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-black" />
                <div className="leading-relaxed">
                  {b.topic && <p className="font-bold">{b.topic}</p>}
                  <p>{b.text}</p>
                  {b.how && (
                    <p className="font-bold">
                      How to fix it: <span>{b.how}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          case "compare":
            return (
              <div key={i} className="mt-3 space-y-1 pl-5 leading-relaxed">
                <p className="text-sm font-bold">Instead of saying:</p>
                <p className="italic text-neutral-600">&ldquo;{b.said}&rdquo;</p>
                <p className="pt-1 text-sm font-bold">Say it like this:</p>
                <p className="font-bold">&ldquo;{b.better}&rdquo;</p>
              </div>
            );
          case "link":
            return (
              <p key={i} className="mt-3">
                <a href={b.url} className="font-bold underline underline-offset-4">
                  {b.text}
                </a>
              </p>
            );
        }
      })}
    </article>
  );
}

/**
 * The finished report: the PDF, and a button to download it. The report is made on this device from the
 * saved session. Browsers that cannot show a PDF in a page (phones, for example) show the same report as
 * a page, and the button still gives the real PDF.
 */
function ReportBody({ session, displayName, next }: { session: Session; displayName: string; next: { title: string; url: string } }) {
  const [made, setMade] = useState<{ blocks: DocBlock[]; bytes: ArrayBuffer; url: string | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    const blocks = buildReportDocument(session, { displayName, next });
    renderPdf(blocks)
      .then((bytes) => {
        if (!alive) return;
        if (canShowPdf()) url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setMade({ blocks, bytes, url });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [session, displayName, next]);

  if (failed) {
    return (
      <p role="alert" className="text-center font-semibold">
        We could not make your report. Please reload the page.
      </p>
    );
  }
  if (!made) {
    return (
      <p role="status" className="py-16 text-center font-semibold">
        Opening your report...
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {made.url ? (
        <iframe title="Your feedback report" data-testid="report-pdf" src={`${made.url}#toolbar=0&navpanes=0&view=FitH`} className="h-[78vh] w-full border-2 border-black bg-white" />
      ) : (
        <Paper blocks={made.blocks} />
      )}
      <div className="flex justify-center">
        <Button
          size="lg"
          className="!border-black !bg-black !text-white"
          icon={<DownloadSimple size={20} weight="bold" aria-hidden />}
          onClick={() => downloadFile(made.bytes, reportFileName(session.startedAt, "pdf"), "application/pdf")}
        >
          Download PDF
        </Button>
      </div>
    </div>
  );
}

export function ReportView({ sessionId }: { sessionId: string }) {
  const sessions = useSessions();
  const profile = useProfile();
  const hydrated = useHydrated();

  if (!hydrated || !profile) return null;
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) {
    return (
      <EmptyState title="We could not find that report" action={<ButtonLink href="/progress">See your history</ButtonLink>}>
        It may have been deleted, or it was saved in a different browser.
      </EmptyState>
    );
  }
  const rec = recommendNext(profile, sessions);
  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="sr-only">Your feedback report</h1>
      <ReportBody session={s} displayName={profile.displayName} next={{ title: rec.module.title, url: `${window.location.origin}/practice/${rec.module.id}` }} />
    </div>
  );
}
