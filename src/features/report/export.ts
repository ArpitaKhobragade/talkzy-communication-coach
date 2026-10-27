import type { CoachingItem, Session } from "../session/types";

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
  | { t: "compare"; said: string; better: string; why: string };

export interface ReportContext {
  displayName: string;
  moduleTitle: string;
  fieldName: string;
  goalName: string;
  /** The recommended next session, if known. */
  next?: { title: string; level: string; reason: string };
}

function group(items: CoachingItem[]) {
  return {
    good: items.filter((i) => i.kind === "good"),
    fix: items.filter((i) => i.kind === "improve"),
    note: items.filter((i) => i.kind === "info"),
  };
}

function bullet(i: CoachingItem): DocBlock {
  return { t: "bullet", topic: i.topic, text: i.observation, why: i.why, how: i.howTo };
}

/** Adds "What went well / What to fix / Good to know" blocks for a list of coaching items. */
function coachingBlocks(items: CoachingItem[]): DocBlock[] {
  const g = group(items);
  const out: DocBlock[] = [];
  // Short on purpose: the best points only. The full detail is on the report page.
  if (g.good.length) out.push({ t: "h3", text: "What went well", tone: "good" }, ...g.good.slice(0, 1).map(bullet));
  if (g.fix.length) out.push({ t: "h3", text: "What to fix", tone: "fix" }, ...g.fix.slice(0, 2).map(bullet));
  if (g.note.length && g.good.length + g.fix.length < 2) out.push({ t: "h3", text: "Good to know", tone: "note" }, ...g.note.slice(0, 1).map(bullet));
  return out;
}

export function buildReportDocument(s: Session, ctx: ReportContext): DocBlock[] {
  const r = s.report;
  const ai = r.ai;
  const when = new Date(s.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const minutes = Math.max(1, Math.round(s.durationSec / 60));
  const blocks: DocBlock[] = [];

  blocks.push({ t: "title", text: "My speaking report" });
  blocks.push({ t: "meta", text: `${ctx.displayName}  |  ${when}  |  ${minutes} min` });
  blocks.push({ t: "meta", text: `${ctx.moduleTitle}  |  ${ctx.fieldName}  |  ${s.level}  |  Goal: ${ctx.goalName}` });

  if (ai) blocks.push({ t: "p", text: ai.headline });
  else blocks.push({ t: "note", text: `${r.aiUnavailableReason ?? "The written feedback could not be made this time."} The tips below still come from what you really said and did.` });

  // 1. Reading
  blocks.push({ t: "h2", text: "1. How you did while reading" });
  if (ai?.reading) {
    blocks.push({ t: "p", text: ai.reading.summary });
    if (ai.reading.wentWell.length) blocks.push({ t: "h3", text: "What went well", tone: "good" }, ...ai.reading.wentWell.slice(0, 1).map((text): DocBlock => ({ t: "bullet", text })));
    if (ai.reading.improve.length) blocks.push({ t: "h3", text: "What to fix", tone: "fix" }, ...ai.reading.improve.slice(0, 2).map((x): DocBlock => ({ t: "bullet", text: x.issue, how: x.howTo })));
  } else if (r.readingCoaching?.length) {
    blocks.push(...coachingBlocks(r.readingCoaching));
  } else {
    blocks.push({ t: "p", text: "No reading information was saved for this session." });
  }

  // 2. Answering
  blocks.push({ t: "h2", text: "2. How you did while answering" });
  if (r.answerCoaching?.length) blocks.push(...coachingBlocks(r.answerCoaching));
  else blocks.push(...r.speechNotes.map((text): DocBlock => ({ t: "bullet", text })));

  if (r.sayItBetter?.length) {
    blocks.push({ t: "h3", text: "Instead of this, say it like this", tone: "good" });
    blocks.push(...r.sayItBetter.slice(0, 2).map((x): DocBlock => ({ t: "compare", said: x.said, better: x.better, why: x.why })));
  }
  if (ai) {
    blocks.push({ t: "h3", text: "What the AI coach noticed", tone: "note" });
    for (const x of ai.strengths.slice(0, 1)) blocks.push({ t: "bullet", text: `Went well: ${x.title}. ${x.detail}${x.quote ? ` You said: "${x.quote}"` : ""}` });
    for (const x of ai.improvements.slice(0, 2)) blocks.push({ t: "bullet", text: `To fix: ${x.title}. ${x.detail}${x.quote ? ` You said: "${x.quote}"` : ""}`, how: x.tip });
    for (const g of ai.grammar.slice(0, 2)) blocks.push({ t: "compare", said: g.quote, better: g.suggestion, why: g.issue });
    for (const u of ai.vocabulary.upgrades.slice(0, 2)) blocks.push({ t: "bullet", text: `Instead of "${u.said}", try "${u.tryInstead}".` });
  }

  // 3. Camera
  blocks.push({ t: "h2", text: "3. Camera: your face and body" });
  if (r.bodyLanguageCoaching?.length) {
    blocks.push(...coachingBlocks(r.bodyLanguageCoaching));
    blocks.push({ t: "note", text: "The camera can only see where your face and body are. This says nothing about how you feel, how sure you are, or whether you are telling the truth." });
  } else if (r.bodyLanguageNotes.length) {
    blocks.push(...r.bodyLanguageNotes.map((text): DocBlock => ({ t: "bullet", text })));
  } else {
    blocks.push({ t: "p", text: "The camera was off, so there are no face or body tips this time. Turn it on at the start of your next session to get them." });
  }

  // Practice
  blocks.push({ t: "h2", text: "Practise before your next session" });
  const exercises = ai ? ai.exercises : r.fallbackExercises;
  for (const e of exercises.slice(0, 2)) blocks.push({ t: "bullet", text: `${e.title} (about ${e.minutes} min): ${e.instructions}` });
  if (ai?.nextSessionFocus) blocks.push({ t: "p", text: `Next time, focus on this: ${ai.nextSessionFocus}` });
  if (ctx.next) blocks.push({ t: "p", text: `Next session we suggest: ${ctx.next.title} (${ctx.next.level}). ${ctx.next.reason}` });

  // Numbers (the three that matter most)
  if (r.speechNotes.length) {
    blocks.push({ t: "h2", text: "Your numbers" });
    blocks.push(...r.speechNotes.slice(0, 3).map((text): DocBlock => ({ t: "bullet", text })));
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
        lines.push(`- Instead of: "${b.said}"`, `    Say it like this: "${b.better}"`, `    Why: ${b.why}`);
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
            heightOf(b.why, 9.5, "normal", cw) +
            3,
        );
        text("Instead of saying:", { size: 9, style: "bold", color: FIX, x: M + 5, width: bodyW - 5 });
        text(`"${b.said}"`, { size: 10.5, style: "italic", color: MUTED, x: M + 5, width: bodyW - 5, gap: 0.5 });
        text("Say it like this:", { size: 9, style: "bold", color: GOOD, x: M + 5, width: bodyW - 5 });
        text(`"${b.better}"`, { size: 10.5, style: "bold", x: M + 5, width: bodyW - 5 });
        text(b.why, { size: 9.5, color: MUTED, x: M + 5, width: bodyW - 5, gap: 2.5 });
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
