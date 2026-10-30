import type { Session } from "../session/types";
import { buildQuickReport, FILLER_LIMIT_PER_100 } from "./quick";

/*
 * Turns a saved session into a simple document (a list of blocks). The blocks make the dark blue PDF,
 * which is always one page, and the plain-text file, so they say the same thing as the report page.
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
}

/** A short title such as "Answer relevance" gets a full stop, so the next sentence does not run into it. */
const endSentence = (text: string) => (/[.!?]["')]?$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

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
        blocks.push({ t: "bullet", topic: where, text: x.quote ? `${endSentence(x.problem)} You said: "${x.quote}"` : x.problem, how: x.how });
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
    blocks.push({ t: "p", text: "The camera could not be used this time (it was blocked or not found), so there is no feedback on your face and body. Allow the camera at the start of your next session to get it." });
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

// The report uses only dark blue, blue and soft blue on white, so it is simple and easy to read.
type Rgb = [number, number, number];
const NAVY: Rgb = [10, 31, 68];
const INK: Rgb = [17, 29, 61];
const BLUE: Rgb = [37, 99, 235];
const SOFT: Rgb = [234, 241, 255];
const LINE: Rgb = [191, 210, 247];
const MUTED: Rgb = [84, 103, 140];
const WHITE: Rgb = [255, 255, 255];

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
    opts: { size: number; style?: "normal" | "bold" | "italic"; color?: Rgb; x?: number; width?: number; gap?: number; url?: string },
  ) => {
    const size = opts.size * scale;
    doc.setFont("helvetica", opts.style ?? "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? INK));
    const x = opts.x ?? M;
    const lines = doc.splitTextToSize(pdfSafe(value), opts.width ?? bodyW) as string[];
    const lh = lineH(size);
    for (const line of lines) {
      need(lh);
      const baseline = y + size * 0.3528;
      if (opts.url) {
        doc.textWithLink(line, x, baseline, { url: opts.url });
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.2);
        doc.line(x, baseline + 0.7, x + doc.getTextWidth(line), baseline + 0.7);
      } else {
        doc.text(line, x, baseline);
      }
      y += lh;
    }
    y += (opts.gap ?? 0) * scale;
  };

  /** Breaks `body` into lines. The first line starts after a bold label ("To fix:"), so it is shorter. `size` is already scaled. */
  const layout = (label: string, body: string, size: number, width: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    const labelText = pdfSafe(label);
    // The gap after the label is a fixed share of the letter height (a trailing space is not always counted when measuring).
    const lw = labelText ? doc.getTextWidth(labelText) + size * 0.3528 * 0.45 : 0;
    doc.setFont("helvetica", "normal");
    const words = pdfSafe(body).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const max = width - (lines.length === 0 ? lw : 0);
      const trial = cur ? `${cur} ${word}` : word;
      if (cur && doc.getTextWidth(trial) > max) {
        lines.push(cur);
        cur = word;
      } else cur = trial;
    }
    lines.push(cur);
    return { labelText, lw, lines };
  };
  /** A bold blue label, then the sentence on the same line, wrapped underneath. */
  const labelled = (label: string, body: string, opts: { size: number; x: number; width: number }) => {
    const size = opts.size * scale;
    const { labelText, lw, lines } = layout(label, body, size, opts.width);
    const lh = lineH(size);
    lines.forEach((line, i) => {
      need(lh);
      const baseline = y + size * 0.3528;
      if (i === 0 && labelText) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        doc.setTextColor(...BLUE);
        doc.text(labelText, opts.x, baseline);
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(...INK);
      doc.text(line, i === 0 ? opts.x + lw : opts.x, baseline);
      y += lh;
    });
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    switch (b.t) {
      case "title": {
        // The title in dark blue on white, the name and date under it, and one thin blue line. No coloured band.
        text(b.text, { size: 20, style: "bold", color: NAVY, gap: 0.5 });
        const next = blocks[i + 1];
        if (next?.t === "meta") {
          text(next.text, { size: 9.5, color: MUTED });
          i++;
        }
        y += 1.5 * scale;
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.7);
        doc.line(M, y, W - M, y);
        y += 5 * scale;
        break;
      }
      case "meta":
        text(b.text, { size: 9.5, color: MUTED, gap: 1 });
        break;
      case "h2": {
        y += 3.5 * scale;
        need(22); // keep the heading together with the first lines under it
        const top = y;
        text(b.text, { size: 12.5, style: "bold", color: NAVY, x: M + 4.5, gap: 0.5 });
        doc.setFillColor(...BLUE);
        doc.rect(M, top + 0.4, 1.6, y - top - 1.2 * scale, "F");
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.3);
        doc.line(M, y, W - M, y);
        y += 2 * scale;
        break;
      }
      case "p": {
        if (blocks[i - 1]?.t === "meta") {
          // The first sentence of the report is set in a soft blue box.
          const pad = 2.5 * scale;
          const cw = bodyW - 8;
          const boxH = pad * 2 + heightOf(b.text, 10.5 * scale, "bold", cw);
          need(boxH + 1);
          doc.setFillColor(...SOFT);
          doc.rect(M, y, bodyW, boxH, "F");
          doc.setFillColor(...BLUE);
          doc.rect(M, y, 1.4, boxH, "F");
          const top = y;
          y += pad;
          text(b.text, { size: 10.5, style: "bold", color: NAVY, x: M + 5, width: cw });
          y = top + boxH + 2 * scale;
          break;
        }
        y += 0.5 * scale;
        text(b.text, { size: 10, gap: 1 });
        break;
      }
      case "bullet": {
        const numbered = b.topic !== undefined && /^\d+$/.test(b.topic);
        const indent = numbered ? 8 : 5;
        const w = bodyW - indent;
        const label = numbered || !b.topic ? "" : `${b.topic}:`;
        const main = layout(label, b.text, 10 * scale, w);
        const how = b.how ? layout("How to fix it:", b.how, 9.5 * scale, w) : null;
        need(main.lines.length * lineH(10 * scale) + (how ? how.lines.length * lineH(9.5 * scale) : 0) + 1);
        const mid = y + lineH(10 * scale) / 2;
        doc.setFillColor(...BLUE);
        if (numbered) {
          const r = 2.2 * scale;
          doc.circle(M + r, mid, r, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8 * scale);
          doc.setTextColor(...WHITE);
          doc.text(b.topic ?? "", M + r, mid + 8 * scale * 0.3528 * 0.35, { align: "center" });
        } else {
          doc.circle(M + 1.2, mid, 0.55, "F");
        }
        labelled(label, b.text, { size: 10, x: M + indent, width: w });
        if (b.how) labelled("How to fix it:", b.how, { size: 9.5, x: M + indent, width: w });
        y += 1 * scale;
        break;
      }
      case "compare": {
        // "Instead of saying / Say it like this" sits in a soft blue box.
        const pad = 2.5 * scale;
        const cw = bodyW - 8;
        const tag = lineH(8.5 * scale);
        const said = heightOf(`"${b.said}"`, 10 * scale, "italic", cw);
        const better = heightOf(`"${b.better}"`, 10 * scale, "bold", cw);
        const boxH = pad + tag + said + 0.3 * scale + tag + better + pad;
        need(boxH + 2);
        const top = y;
        doc.setFillColor(...SOFT);
        doc.rect(M, top, bodyW, boxH, "F");
        doc.setFillColor(...BLUE);
        doc.rect(M, top, 1.4, boxH, "F");
        y += pad;
        text("Instead of saying:", { size: 8.5, style: "bold", color: MUTED, x: M + 5, width: cw });
        text(`"${b.said}"`, { size: 10, style: "italic", color: MUTED, x: M + 5, width: cw, gap: 0.3 });
        text("Say it like this:", { size: 8.5, style: "bold", color: BLUE, x: M + 5, width: cw });
        text(`"${b.better}"`, { size: 10, style: "bold", color: NAVY, x: M + 5, width: cw });
        y = top + boxH + 2.5 * scale;
        break;
      }
      case "link":
        y += 0.5 * scale;
        text(b.text, { size: 10.5, style: "bold", color: BLUE, url: b.url, gap: 1 });
        break;
    }
  }

  // No footer. Only when the content did not fit on one page, a plain page number is added.
  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.text(`Page ${p} of ${pages}`, W / 2, H - 7, { align: "center" });
    }
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
