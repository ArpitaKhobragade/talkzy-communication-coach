import type { Session } from "../session/types";
import { buildQuickReport } from "./quick";

/*
 * Turns a saved session into a simple document (a list of blocks). The same blocks make the PDF, the
 * page that shows the report, and the plain-text file, so they always say the same thing. Everything
 * is made on the student's own device: nothing is uploaded. The report is black and white only.
 */

export type DocBlock =
  | { t: "title"; text: string }
  | { t: "meta"; text: string }
  | { t: "h2"; text: string }
  | { t: "p"; text: string }
  | { t: "bullet"; text: string; topic?: string; how?: string }
  | { t: "compare"; said: string; better: string }
  /** A link to a practice module. `url` is the full address, so it also works inside the PDF. */
  | { t: "link"; text: string; url: string };

export interface ReportContext {
  displayName: string;
  /** The module to practise next, as a link. */
  next?: { title: string; url: string };
}

export function buildReportDocument(s: Session, ctx: ReportContext): DocBlock[] {
  const q = buildQuickReport(s);
  const when = new Date(s.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const blocks: DocBlock[] = [];

  blocks.push({ t: "title", text: "My speaking report" });
  blocks.push({ t: "meta", text: `${ctx.displayName}  |  ${when}` });
  blocks.push({ t: "p", text: q.headline });

  if (!q.noAnswers) {
    if (q.good.length) {
      blocks.push({ t: "h2", text: "What went well" });
      blocks.push(...q.good.map((g): DocBlock => ({ t: "bullet", topic: g.area, text: g.text })));
    }
    blocks.push({ t: "h2", text: "What to fix" });
    if (q.fix.length) {
      blocks.push(...q.fix.map((x): DocBlock => ({ t: "bullet", topic: x.area, text: x.quote ? `${x.problem} You said: "${x.quote}"` : x.problem, how: x.how })));
    } else {
      blocks.push({ t: "p", text: "Nothing big to fix this time. Keep practising." });
    }
    if (q.sayItBetter) {
      blocks.push({ t: "h2", text: "Instead of this, say it like this" });
      blocks.push({ t: "compare", said: q.sayItBetter.said, better: q.sayItBetter.better });
    }
  }

  const cam = q.camera;
  blocks.push({ t: "h2", text: "Your face and body" });
  if (cam.status === "ok") {
    if (cam.looked) blocks.push({ t: "p", text: cam.looked });
    blocks.push(...cam.good.map((text): DocBlock => ({ t: "bullet", text })));
    blocks.push(...cam.fix.map((x): DocBlock => ({ t: "bullet", text: x.problem, how: x.how })));
  } else if (cam.status === "unavailable") {
    blocks.push({ t: "p", text: "The camera could not be used this time, so there is no feedback on your face and body." });
  } else {
    blocks.push({ t: "p", text: "The camera was off. Turn it on at the start of your next session to get feedback on how you look and sit." });
  }

  if (ctx.next) {
    blocks.push({ t: "h2", text: "Practise next" });
    blocks.push({ t: "link", text: ctx.next.title, url: ctx.next.url });
  }
  return blocks;
}

/** Plain text version: easy to open anywhere, paste into a message, or print. */
export function documentToText(blocks: DocBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "title":
        lines.push(b.text.toUpperCase(), "=".repeat(b.text.length), "");
        break;
      case "meta":
        lines.push(b.text);
        break;
      case "h2":
        lines.push("", b.text.toUpperCase(), "-".repeat(b.text.length));
        break;
      case "p":
        lines.push("", b.text);
        break;
      case "bullet":
        lines.push(`- ${b.topic ? `${b.topic}: ` : ""}${b.text}`);
        if (b.how) lines.push(`    How to fix it: ${b.how}`);
        break;
      case "compare":
        lines.push(`- Instead of: "${b.said}"`, `    Say it like this: "${b.better}"`);
        break;
      case "link":
        lines.push(`- ${b.text}: ${b.url}`);
        break;
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** jsPDF's built-in fonts only know basic Latin letters, so swap curly quotes, dashes and other symbols. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[·•]/g, "-")
    .replace(/ /g, " ")
    // Anything else outside Latin-1 cannot be drawn by the built-in font.
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

// The report is black and white only.
const BLACK: [number, number, number] = [0, 0, 0];
const GREY: [number, number, number] = [90, 90, 90];

/** Draws the document as an A4 PDF. Runs in the browser (and in Node for tests). Returns the file bytes. */
export async function renderPdf(blocks: DocBlock[]): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18;
  const bodyW = W - M * 2;
  let y = M;

  const lineH = (size: number) => size * 0.3528 * 1.4;
  const need = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  /** Height a piece of text will take, so a whole item can be kept together on one page. */
  const heightOf = (value: string, size: number, style: "normal" | "bold" | "italic", width: number) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    return (doc.splitTextToSize(pdfSafe(value), width) as string[]).length * lineH(size);
  };
  const text = (
    value: string,
    opts: { size: number; style?: "normal" | "bold" | "italic"; color?: [number, number, number]; x?: number; width?: number; gap?: number; url?: string },
  ) => {
    doc.setFont("helvetica", opts.style ?? "normal");
    doc.setFontSize(opts.size);
    doc.setTextColor(...(opts.color ?? BLACK));
    const x = opts.x ?? M;
    const lines = doc.splitTextToSize(pdfSafe(value), opts.width ?? bodyW) as string[];
    const lh = lineH(opts.size);
    for (const line of lines) {
      need(lh);
      const baseline = y + opts.size * 0.3528;
      if (opts.url) {
        doc.textWithLink(line, x, baseline, { url: opts.url });
        doc.setDrawColor(...BLACK);
        doc.setLineWidth(0.2);
        doc.line(x, baseline + 0.7, x + doc.getTextWidth(line), baseline + 0.7);
      } else {
        doc.text(line, x, baseline);
      }
      y += lh;
    }
    y += opts.gap ?? 0;
  };

  doc.setDrawColor(...BLACK);
  for (const b of blocks) {
    switch (b.t) {
      case "title": {
        text(b.text, { size: 22, style: "bold", gap: 1 });
        doc.setLineWidth(0.8);
        doc.line(M, y, W - M, y);
        y += 4;
        break;
      }
      case "meta":
        text(b.text, { size: 10, color: GREY, gap: 1 });
        break;
      case "h2":
        y += 5;
        need(28); // keep the heading together with the first lines under it
        text(b.text, { size: 14, style: "bold", gap: 1 });
        doc.setLineWidth(0.3);
        doc.line(M, y, W - M, y);
        y += 3;
        break;
      case "p":
        y += 1;
        text(b.text, { size: 10.5, gap: 1.5 });
        break;
      case "bullet": {
        const w = bodyW - 5;
        need(
          (b.topic ? heightOf(b.topic, 10.5, "bold", w) : 0) +
            heightOf(b.text, 10.5, "normal", w) +
            (b.how ? heightOf(`How to fix it: ${b.how}`, 10, "bold", w) : 0) +
            1.5,
        );
        doc.setFillColor(...BLACK);
        doc.circle(M + 1.2, y + 2.1, 0.55, "F");
        if (b.topic) text(b.topic, { size: 10.5, style: "bold", x: M + 5, width: w });
        text(b.text, { size: 10.5, x: M + 5, width: w });
        if (b.how) text(`How to fix it: ${b.how}`, { size: 10, style: "bold", x: M + 5, width: w });
        y += 1.5;
        break;
      }
      case "compare": {
        const cw = bodyW - 5;
        need(lineH(9) * 2 + heightOf(`"${b.said}"`, 10.5, "italic", cw) + heightOf(`"${b.better}"`, 10.5, "bold", cw) + 3);
        text("Instead of saying:", { size: 9, style: "bold", x: M + 5, width: cw });
        text(`"${b.said}"`, { size: 10.5, style: "italic", color: GREY, x: M + 5, width: cw, gap: 0.5 });
        text("Say it like this:", { size: 9, style: "bold", x: M + 5, width: cw });
        text(`"${b.better}"`, { size: 10.5, style: "bold", x: M + 5, width: cw, gap: 2.5 });
        break;
      }
      case "link":
        y += 1;
        text(b.text, { size: 11, style: "bold", url: b.url, gap: 1.5 });
        break;
    }
  }

  // Page numbers.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...GREY);
    doc.text(`Talkzy  |  Page ${p} of ${pages}`, W / 2, H - 8, { align: "center" });
  }
  return doc.output("arraybuffer");
}

export function reportFileName(startedAt: number, ext: "pdf" | "txt"): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `talkzy-report-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`;
}

/** Browser only: saves bytes or text as a file on the student's device. */
export function downloadFile(data: BlobPart, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
