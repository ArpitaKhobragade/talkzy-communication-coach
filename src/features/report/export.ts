import type { Session } from "../session/types";
import { buildQuickReport, FILLER_LIMIT_PER_100 } from "./quick";

/*
 * Turns a saved session into a simple document (a list of blocks). The blocks make the black-and-white
 * PDF, which is always one page, and the plain-text file, so they say the same thing as the report page.
 * Everything is made on the student's own device: nothing is uploaded.
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

const cutText = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 3).trimEnd()}...` : text);

export function buildReportDocument(s: Session, ctx: ReportContext): DocBlock[] {
  const q = buildQuickReport(s);
  const when = new Date(s.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const blocks: DocBlock[] = [];

  blocks.push({ t: "title", text: "My speaking report" });
  blocks.push({ t: "meta", text: `${ctx.displayName}  |  ${when}` });
  blocks.push({ t: "p", text: q.headline });

  // Your plan for next time: the few things to do first.
  if (q.plan.length) {
    blocks.push({ t: "h2", text: "Your plan for next time" });
    q.plan.forEach((step, i) => blocks.push({ t: "bullet", topic: `${i + 1}`, text: step }));
  }

  // 1. Reading: how much was read, what was skipped, which words were not clear, and the speed.
  const rd = q.reading;
  blocks.push({ t: "h2", text: "Reading" });
  for (const l of rd.lines) blocks.push({ t: "bullet", topic: l.kind === "good" ? "Went well" : "To fix", text: l.text, how: l.how });
  if (rd.skipped.length) blocks.push({ t: "bullet", topic: "You skipped", text: rd.skipped.map((x) => `"${x}"`).join(" and ") });
  if (rd.unreadTail) blocks.push({ t: "bullet", topic: "You stopped before", text: `"${rd.unreadTail}"` });
  if (rd.pronunciation.length) {
    blocks.push({ t: "bullet", topic: "Say these clearly", text: rd.pronunciation.map((w) => `${w.word} (${w.parts})`).join(", ") });
  }

  // 2. The conversation: what was wrong, in which question, and how to fix it.
  if (!q.noAnswers) {
    blocks.push({ t: "h2", text: "Conversation" });
    for (const g of q.good) blocks.push({ t: "bullet", topic: "Went well", text: g.text });
    if (q.fix.length) {
      for (const x of q.fix) {
        const where = x.where ? `Question ${x.where.n}: "${cutText(x.where.question, 80)}"` : "In your answers";
        blocks.push({ t: "bullet", topic: where, text: x.quote ? `${x.problem} You said: "${x.quote}"` : x.problem, how: x.how });
      }
    } else {
      blocks.push({ t: "bullet", topic: "To fix", text: "Nothing big to fix this time. Keep practising." });
    }
    if (q.sayItBetter) blocks.push({ t: "compare", said: q.sayItBetter.said, better: q.sayItBetter.better });
  }

  // 3. Fillers and wrong words.
  if (!q.noAnswers) {
    const w = q.words;
    blocks.push({ t: "h2", text: "Your words" });
    if (w.fillerTotal === 0) blocks.push({ t: "bullet", topic: "Went well", text: "No filler words heard." });
    else {
      const list = w.fillers.map((f) => `"${f.word}" x${f.count}`).join(", ");
      const rate = w.fillersPer100 !== null ? ` (about ${w.fillersPer100} in every 100 words)` : "";
      const where = w.worstQuestion ? ` Most were in question ${w.worstQuestion.where.n}.` : "";
      blocks.push({
        t: "bullet",
        topic: w.fillersPer100 !== null && w.fillersPer100 > FILLER_LIMIT_PER_100 ? "To fix" : "Filler words",
        text: `${w.fillerTotal} filler ${w.fillerTotal === 1 ? "word" : "words"}: ${list}${rate}.${where}`,
        how: w.fillersPer100 !== null && w.fillersPer100 > FILLER_LIMIT_PER_100 ? "When you want to say a filler, stay quiet for one second instead." : undefined,
      });
    }
    if (w.mistakes.length === 0) blocks.push({ t: "bullet", topic: "Went well", text: "No clear wrong words found." });
    for (const m of w.mistakes) {
      blocks.push({ t: "bullet", topic: m.where ? `Question ${m.where.n}` : "Say this instead", text: `You said "${m.said}". Say "${m.better}". ${m.why}` });
    }
  }

  // 4. The camera: how you looked, and how to improve.
  const cam = q.camera;
  blocks.push({ t: "h2", text: "Face and body" });
  if (cam.status === "ok") {
    if (cam.looked) blocks.push({ t: "bullet", topic: "Went well", text: cam.looked });
    blocks.push(...cam.good.map((text): DocBlock => ({ t: "bullet", topic: "Went well", text })));
    blocks.push(...cam.fix.map((x): DocBlock => ({ t: "bullet", topic: "To fix", text: x.problem, how: x.how })));
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

/** The report is one page. If the content is long, the writing is made a little smaller until it fits. */
const SCALES = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62];

type Jspdf = InstanceType<(typeof import("jspdf"))["jsPDF"]>;

function drawPdf(doc: Jspdf, blocks: DocBlock[], scale: number): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const bodyW = W - M * 2;
  let y = M;

  const lineH = (size: number) => size * 0.3528 * (scale < 0.8 ? 1.3 : 1.4);
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
    const size = opts.size * scale;
    doc.setFont("helvetica", opts.style ?? "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? BLACK));
    const x = opts.x ?? M;
    const lines = doc.splitTextToSize(pdfSafe(value), opts.width ?? bodyW) as string[];
    const lh = lineH(size);
    for (const line of lines) {
      need(lh);
      const baseline = y + size * 0.3528;
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
    y += (opts.gap ?? 0) * scale;
  };

  doc.setDrawColor(...BLACK);
  for (const b of blocks) {
    switch (b.t) {
      case "title": {
        text(b.text, { size: 20, style: "bold", gap: 1 });
        doc.setLineWidth(0.8);
        doc.line(M, y, W - M, y);
        y += 3 * scale;
        break;
      }
      case "meta":
        text(b.text, { size: 9.5, color: GREY, gap: 1 });
        break;
      case "h2":
        y += 3.5 * scale;
        need(22); // keep the heading together with the first lines under it
        text(b.text, { size: 12.5, style: "bold", gap: 0.5 });
        doc.setLineWidth(0.3);
        doc.line(M, y, W - M, y);
        y += 2 * scale;
        break;
      case "p":
        y += 0.5 * scale;
        text(b.text, { size: 10, gap: 1 });
        break;
      case "bullet": {
        const w = bodyW - 5;
        const label = b.topic ? `${b.topic}: ` : "";
        need(heightOf(label + b.text, 10 * scale, "normal", w) + (b.how ? heightOf(`How to fix it: ${b.how}`, 9.5 * scale, "bold", w) : 0) + 1);
        doc.setFillColor(...BLACK);
        doc.circle(M + 1.2, y + 1.9 * scale, 0.5, "F");
        text(label + b.text, { size: 10, x: M + 5, width: w });
        if (b.how) text(`How to fix it: ${b.how}`, { size: 9.5, style: "bold", x: M + 5, width: w });
        y += 1 * scale;
        break;
      }
      case "compare": {
        const cw = bodyW - 5;
        need(lineH(9 * scale) * 2 + heightOf(`"${b.said}"`, 10 * scale, "italic", cw) + heightOf(`"${b.better}"`, 10 * scale, "bold", cw) + 2);
        text("Instead of saying:", { size: 8.5, style: "bold", x: M + 5, width: cw });
        text(`"${b.said}"`, { size: 10, style: "italic", color: GREY, x: M + 5, width: cw, gap: 0.3 });
        text("Say it like this:", { size: 8.5, style: "bold", x: M + 5, width: cw });
        text(`"${b.better}"`, { size: 10, style: "bold", x: M + 5, width: cw, gap: 1.5 });
        break;
      }
      case "link":
        y += 0.5 * scale;
        text(b.text, { size: 10.5, style: "bold", url: b.url, gap: 1 });
        break;
    }
  }

  // Page numbers (only when the content did not fit on one page).
  const pages = doc.getNumberOfPages();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.text(pages > 1 ? `Talkzy  |  Page ${p} of ${pages}` : "Talkzy", W / 2, H - 7, { align: "center" });
  }
}

/** Draws the document as an A4 PDF, on one page when it can. Runs in the browser (and in Node for tests). Returns the file bytes. */
export async function renderPdf(blocks: DocBlock[]): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  let doc: Jspdf | null = null;
  for (const scale of SCALES) {
    doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    drawPdf(doc, blocks, scale);
    if (doc.getNumberOfPages() === 1) break;
  }
  return doc!.output("arraybuffer");
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
