import type { Session } from "../session/types";
import { buildQuickReport } from "./quick";

/*
 * Turns a saved session into a simple document (a list of blocks). The same blocks are used to
 * make the PDF and the plain-text file, so both always say the same thing. Everything is made on
 * the student's own device: nothing is uploaded.
 */

export type Tone = "good" | "fix" | "note";

export type DocBlock =
  | { t: "title"; text: string }
  | { t: "meta"; text: string }
  | { t: "h2"; text: string }
  | { t: "h3"; text: string; tone: Tone }
  | { t: "p"; text: string }
  | { t: "note"; text: string }
  | { t: "bullet"; text: string; topic?: string; why?: string; how?: string }
  | { t: "compare"; said: string; better: string; why?: string };

export interface ReportContext {
  displayName: string;
  moduleTitle: string;
  fieldName: string;
  goalName: string;
  /** The recommended next session, if known. */
  next?: { title: string; level: string; reason: string };
}

export function buildReportDocument(s: Session, ctx: ReportContext): DocBlock[] {
  const r = s.report;
  const ai = r.ai;
  const q = buildQuickReport(s);
  const when = new Date(s.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const minutes = Math.max(1, Math.round(s.durationSec / 60));
  const blocks: DocBlock[] = [];

  blocks.push({ t: "title", text: "My speaking report" });
  blocks.push({ t: "meta", text: `${ctx.displayName}  |  ${when}  |  ${minutes} min` });
  blocks.push({ t: "meta", text: `${ctx.moduleTitle}  |  ${ctx.fieldName}  |  ${s.level}  |  Goal: ${ctx.goalName}` });

  if (ai) blocks.push({ t: "p", text: q.headline });
  else blocks.push({ t: "note", text: `${r.aiUnavailableReason ?? "The written feedback could not be made this time."} The tips below still come from what you really said and did.` });

  if (q.good.length) {
    blocks.push({ t: "h2", text: "What went well" });
    blocks.push(...q.good.map((g): DocBlock => ({ t: "bullet", topic: g.area, text: g.text })));
  }
  if (q.fix.length) {
    blocks.push({ t: "h2", text: "What to fix" });
    blocks.push(...q.fix.map((x): DocBlock => ({ t: "bullet", topic: x.area, text: x.quote ? `${x.problem} You said: "${x.quote}"` : x.problem, how: x.how })));
  }
  if (q.sayItBetter) {
    blocks.push({ t: "h2", text: "Instead of this, say it like this" });
    blocks.push({ t: "compare", said: q.sayItBetter.said, better: q.sayItBetter.better });
  }
  if (q.practice) {
    blocks.push({ t: "h2", text: "Practise today" });
    blocks.push({ t: "bullet", text: `${q.practice.title} (about ${q.practice.minutes} min): ${q.practice.instructions}` });
  }
  if (ctx.next) blocks.push({ t: "p", text: `Next session we suggest: ${ctx.next.title} (${ctx.next.level}). ${ctx.next.reason}` });

  if ([...q.good, ...q.fix].some((x) => x.area === "Camera")) {
    blocks.push({ t: "note", text: "The camera can only see where your face and body are. This says nothing about how you feel, how sure you are, or whether you are telling the truth." });
  }
  blocks.push({ t: "note", text: "This report is a guide to help you practise. It is not an exam mark." });
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
      case "h3":
        lines.push("", `${b.text}:`);
        break;
      case "p":
        lines.push("", b.text);
        break;
      case "note":
        lines.push("", `Note: ${b.text}`);
        break;
      case "bullet":
        lines.push(`- ${b.topic ? `${b.topic}: ` : ""}${b.text}`);
        if (b.why) lines.push(`    Why: ${b.why}`);
        if (b.how) lines.push(`    How to fix it: ${b.how}`);
        break;
      case "compare":
        lines.push(`- Instead of: "${b.said}"`, `    Say it like this: "${b.better}"`);
        if (b.why) lines.push(`    Why: ${b.why}`);
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
    .replace(/ /g, " ")
    // Anything else outside Latin-1 cannot be drawn by the built-in font.
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

const INDIGO: [number, number, number] = [79, 70, 229];
const INK: [number, number, number] = [26, 29, 51];
const MUTED: [number, number, number] = [86, 95, 122];
const GOOD: [number, number, number] = [11, 127, 112];
const FIX: [number, number, number] = [180, 83, 9];

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
    opts: { size: number; style?: "normal" | "bold" | "italic"; color?: [number, number, number]; x?: number; width?: number; gap?: number },
  ) => {
    doc.setFont("helvetica", opts.style ?? "normal");
    doc.setFontSize(opts.size);
    doc.setTextColor(...(opts.color ?? INK));
    const x = opts.x ?? M;
    const lines = doc.splitTextToSize(pdfSafe(value), opts.width ?? bodyW) as string[];
    const lh = lineH(opts.size);
    for (const line of lines) {
      need(lh);
      doc.text(line, x, y + opts.size * 0.3528);
      y += lh;
    }
    y += opts.gap ?? 0;
  };

  for (const b of blocks) {
    switch (b.t) {
      case "title": {
        doc.setFillColor(...INDIGO);
        doc.rect(0, 0, W, 26, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(255, 255, 255);
        doc.text(pdfSafe(b.text), M, 16);
        y = 34;
        break;
      }
      case "meta":
        text(b.text, { size: 10, color: MUTED, gap: 1 });
        break;
      case "h2":
        y += 5;
        need(40); // keep the heading together with the first lines under it
        text(b.text, { size: 14, style: "bold", color: INDIGO, gap: 1 });
        doc.setDrawColor(225, 228, 240);
        doc.line(M, y, W - M, y);
        y += 3;
        break;
      case "h3":
        y += 2;
        need(34); // never leave a sub-heading alone at the bottom of a page
        text(b.text, { size: 11, style: "bold", color: b.tone === "good" ? GOOD : b.tone === "fix" ? FIX : MUTED, gap: 1 });
        break;
      case "p":
        y += 1;
        text(b.text, { size: 10.5, gap: 1.5 });
        break;
      case "note":
        y += 1;
        text(b.text, { size: 9.5, style: "italic", color: MUTED, gap: 2 });
        break;
      case "bullet": {
        const w = bodyW - 5;
        need(
          (b.topic ? heightOf(b.topic, 10.5, "bold", w) : 0) +
            heightOf(b.text, 10.5, "normal", w) +
            (b.why ? heightOf(`Why: ${b.why}`, 9.5, "normal", w) : 0) +
            (b.how ? heightOf(`How to fix it: ${b.how}`, 10, "bold", w) : 0) +
            1.5,
        );
        doc.setFillColor(...INK);
        doc.circle(M + 1.2, y + 2.1, 0.55, "F");
        if (b.topic) text(b.topic, { size: 10.5, style: "bold", x: M + 5, width: bodyW - 5 });
        text(b.text, { size: 10.5, x: M + 5, width: bodyW - 5 });
        if (b.why) text(`Why: ${b.why}`, { size: 9.5, color: MUTED, x: M + 5, width: bodyW - 5 });
        if (b.how) text(`How to fix it: ${b.how}`, { size: 10, style: "bold", color: GOOD, x: M + 5, width: bodyW - 5 });
        y += 1.5;
        break;
      }
      case "compare": {
        const cw = bodyW - 5;
        need(
          lineH(9) * 2 +
            heightOf(`"${b.said}"`, 10.5, "italic", cw) +
            heightOf(`"${b.better}"`, 10.5, "bold", cw) +
            (b.why ? heightOf(b.why, 9.5, "normal", cw) : 0) +
            3,
        );
        text("Instead of saying:", { size: 9, style: "bold", color: FIX, x: M + 5, width: bodyW - 5 });
        text(`"${b.said}"`, { size: 10.5, style: "italic", color: MUTED, x: M + 5, width: bodyW - 5, gap: 0.5 });
        text("Say it like this:", { size: 9, style: "bold", color: GOOD, x: M + 5, width: bodyW - 5 });
        text(`"${b.better}"`, { size: 10.5, style: "bold", x: M + 5, width: bodyW - 5 });
        if (b.why) text(b.why, { size: 9.5, color: MUTED, x: M + 5, width: bodyW - 5, gap: 2.5 });
        else y += 2.5;
        break;
      }
    }
  }

  // Page numbers.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
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
