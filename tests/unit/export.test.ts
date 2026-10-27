import { describe, expect, it } from "vitest";
import { buildReportDocument, documentToText, pdfSafe, renderPdf, reportFileName, type DocBlock, type ReportContext } from "@/features/report/export";
import { buildSession } from "@/features/practice/finalize";
import type { Turn, VisionMetrics } from "@/features/session/types";

const turn = (role: Turn["role"], text: string, extra: Partial<Turn> = {}): Turn => ({ id: Math.random().toString(), role, text, at: 0, ...extra });

const vision: VisionMetrics = {
  framesAnalyzed: 120, durationSec: 60, facePresentPct: 92, cameraFacingPct: 64, avgHeadYawDeg: 12, avgHeadPitchDeg: 8,
  shoulderTiltDeg: 3, uprightPct: 78, bodyVisiblePct: 90, handsVisiblePct: 40, movementIndex: 0.04, movementLevel: "moderate",
  facialMovementIndex: 0.005, facialMovementLevel: "low",
};

const session = (over: { keepTranscript?: boolean; withVision?: boolean } = {}) =>
  buildSession({
    id: "s1",
    startedAt: new Date(2026, 9, 26, 10, 30).getTime(),
    endedAt: new Date(2026, 9, 26, 10, 41).getTime(),
    budgetSec: 720,
    moduleId: "computer-science-intermediate",
    field: "computer-science",
    level: "intermediate",
    goal: "clarity",
    liveAi: false,
    readingSec: 100,
    passageWords: 160,
    reading: { mode: "aloud", durationSec: 100, aloud: { accuracyPct: 82, coveragePct: 95, wpm: 140, spokenWordCount: 140, missedWords: ["passphrase", "authentication"] } },
    turns: [
      turn("coach", "Why are long passwords better?"),
      turn("student", "um I think basically a long password is harder to guess because it has more combinations you know", { inputMode: "voice", speakingSec: 9, pauseCount: 1, longestPauseSec: 1.4, latencySec: 2 }),
      turn("coach", "Can you give an example?"),
      turn("student", "Passwords keep accounts safe", { inputMode: "voice", speakingSec: 3, pauseCount: 0, longestPauseSec: 0, latencySec: 2.2 }),
    ],
    vision: over.withVision === false ? null : vision,
    keepTranscript: over.keepTranscript ?? true,
    ai: null,
    aiReason: "Development mode: no AI key.",
  });

const ctx: ReportContext = {
  displayName: "Asha",
  moduleTitle: "Strong Passwords and Staying Safe Online",
  fieldName: "Computer Science & Technology",
  goalName: "Explain ideas clearly",
  next: { title: "How a Startup Tests a New Idea", level: "intermediate", reason: "Keep the habit going." },
};

const headings = (blocks: DocBlock[]) => blocks.filter((b) => b.t === "h2").map((b) => (b as { text: string }).text);

describe("buildReportDocument", () => {
  it("is the short report: what went well, what to fix, say it like this, practise today", () => {
    const h = headings(buildReportDocument(session(), ctx));
    expect(h).toEqual(["What went well", "What to fix", "Instead of this, say it like this", "Practise today"]);
  });

  it("says what to fix and how to fix it", () => {
    const text = documentToText(buildReportDocument(session(), ctx));
    expect(text).toMatch(/what to fix/i);
    expect(text).toMatch(/How to fix it:/);
  });

  it("shows at most two points of each kind", () => {
    const blocks = buildReportDocument(session(), ctx);
    const section = (title: string) => {
      const i = blocks.findIndex((b) => b.t === "h2" && b.text === title);
      const rest = blocks.slice(i + 1);
      const end = rest.findIndex((b) => b.t === "h2");
      return (end < 0 ? rest : rest.slice(0, end)).filter((b) => b.t === "bullet");
    };
    expect(section("What went well").length).toBeLessThanOrEqual(2);
    expect(section("What to fix").length).toBeLessThanOrEqual(2);
    expect(section("What to fix").length).toBeGreaterThan(0);
  });

  it("includes one 'instead of this, say it like this' from the student's own words", () => {
    const blocks = buildReportDocument(session(), ctx);
    const cmp = blocks.filter((b) => b.t === "compare") as Extract<DocBlock, { t: "compare" }>[];
    expect(cmp).toHaveLength(1);
    expect(cmp[0].said).toContain("um I think basically");
    expect(cmp[0].better).toBe("I think a long password is harder to guess because it has more combinations.");
    expect(documentToText(blocks)).toMatch(/Say it like this:/);
  });

  it("is short: no transcript, no long sections, about one page", () => {
    const text = documentToText(buildReportDocument(session({ keepTranscript: true }), ctx));
    expect(text).not.toMatch(/what was said/i);
    expect(text).not.toMatch(/How you did while/);
    expect(text.split("\n").length).toBeLessThan(40);
  });

  it("explains why AI feedback is missing and names the student and topic", () => {
    const text = documentToText(buildReportDocument(session(), ctx));
    expect(text).toMatch(/Development mode: no AI key./);
    expect(text).toContain("Asha");
    expect(text).toContain("Strong Passwords and Staying Safe Online");
  });
});

describe("pdfSafe and file name", () => {
  it("replaces symbols the PDF font cannot draw", () => {
    expect(pdfSafe("It’s “good” – really… a · b")).toBe("It's \"good\" - really... a - b");
    expect(pdfSafe("snow ☃ man")).toBe("snow  man");
  });
  it("makes a dated file name", () => {
    expect(reportFileName(new Date(2026, 9, 5).getTime(), "pdf")).toBe("talkzy-report-2026-10-05.pdf");
    expect(reportFileName(new Date(2026, 9, 5).getTime(), "txt")).toMatch(/\.txt$/);
  });
});

describe("renderPdf", () => {
  it("produces a real PDF file", async () => {
    const bytes = new Uint8Array(await renderPdf(buildReportDocument(session(), ctx)));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("adds pages for long content and numbers them", async () => {
    const many: DocBlock[] = [{ t: "title", text: "Long report" }];
    for (let i = 0; i < 80; i++) many.push({ t: "bullet", text: `Item ${i}: ${"word ".repeat(40)}`, how: "Do this." });
    const raw = new TextDecoder("latin1").decode(new Uint8Array(await renderPdf(many)));
    const pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThan(2);
  });

  it("handles unusual characters without throwing", async () => {
    const bytes = await renderPdf([{ t: "title", text: "Résumé ✓" }, { t: "p", text: "Quote “x” — done ☃" }]);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
