/*
 * Quality check for the AI parts of Talkzy. Run it with:  npm run eval
 *
 * It makes up practice sessions with known mistakes, sends them through the REAL report and coach
 * services (the same code the website uses, with your real AI key), and marks the results:
 *
 *   A. Measured numbers: are the counts (fillers, missed words, pace) right?   (no AI, exact answers)
 *   B. Written feedback: does it find the planted mistakes, avoid inventing new ones, and is it
 *      short and easy to read?                                                (marked by a second AI)
 *   C. Coach questions: do they go from easy to difficult?                    (marked by a second AI)
 *
 * It costs a few cents of AI usage and takes about two minutes. Results are written to
 * evals/results/latest.json and evals/results/latest.md.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { POST as reportPost } from "@/app/api/coach/report/route";
import { POST as turnPost } from "@/app/api/coach/turn/route";
import { buildSession } from "@/features/practice/finalize";
import { buildQuickReport } from "@/features/report/quick";
import { difficultyOfQuestion } from "@/features/coach/ladder";
import { getModule } from "@/features/content/modules";
import { tokenize } from "@/features/speech/metrics";
import type { AiFeedback, CoachTurnResponse } from "@/features/session/types";
import { judgeQuestions, judgeReport, type JudgeResult } from "./judge";
import { SCENARIOS, buildScenario, ladderQuestions, type BuiltScenario } from "./scenarios";
import { mean, numbersIn, pct, readability, spearman, type Readability } from "./text-metrics";

const RUNS_PER_SCENARIO = Number(process.env.EVAL_RUNS ?? 2);
const OUT_DIR = path.resolve(__dirname, "results");

// ------------------------------------------------------------------ setup

function loadEnv() {
  const candidates = [process.env.EVAL_ENV_FILE, path.resolve(__dirname, "../.env.local"), path.resolve(__dirname, "../.env")].filter(Boolean) as string[];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

let ip = 0;
const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.77.${Math.floor(++ip / 250)}.${ip % 250}` },
    body: JSON.stringify(body),
  });

/** True when `phrase` appears as whole words, so "pivot mean" is not found inside "pivot means". */
const hasPhrase = (text: string, phrase: string) => ` ${norm(text)} `.includes(` ${norm(phrase)} `);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

function flatten(ai: AiFeedback): string {
  const lines = [`Headline: ${ai.headline}`];
  for (const s of ai.strengths) lines.push(`Strength: ${s.title}. ${s.detail}${s.quote ? ` (quote: "${s.quote}")` : ""}`);
  for (const s of ai.improvements) lines.push(`Improve: ${s.title}. ${s.detail}${s.quote ? ` (quote: "${s.quote}")` : ""} Tip: ${s.tip}`);
  for (const g of ai.grammar) lines.push(`Grammar: "${g.quote}" - ${g.issue}. Better: ${g.suggestion}`);
  lines.push(`Vocabulary: ${ai.vocabulary.summary} ${ai.vocabulary.upgrades.map((u) => `"${u.said}" -> "${u.tryInstead}"`).join("; ")}`);
  for (const s of ai.sayItBetter ?? []) lines.push(`Say it better: "${s.said}" -> "${s.better}". ${s.why}`);
  if (ai.reading) lines.push(`Reading: ${ai.reading.summary} Went well: ${ai.reading.wentWell.join(" ")} Improve: ${ai.reading.improve.map((i) => `${i.issue} (${i.howTo})`).join(" ")}`);
  for (const e of ai.exercises) lines.push(`Exercise (${e.minutes} min): ${e.title}. ${e.instructions}`);
  lines.push(`Next focus: ${ai.nextSessionFocus}`);
  return lines.join("\n");
}

function measuredText(b: BuiltScenario): string {
  const s = b.request.speech;
  const r = b.reading;
  return [
    `answers: ${s.totalWords} words in total, average answer ${s.avgAnswerWords} words, speaking pace in the answers ${s.wpm ?? "n/a"} wpm, fillers ${s.fillerCount} (${s.fillers.map((f) => `${f.word}: ${f.count}`).join(", ") || "none"}), repeated phrases: ${s.repetitions.join("; ") || "none"}, pauses over 1 second ${s.pauseCount}`,
    r ? `reading aloud: ${r.accuracyPct}% of reached words matched, ${r.coveragePct}% of the passage read, reading pace ${r.wpm ?? "n/a"} wpm, missed words: ${r.missedWords.join(", ") || "none"}` : "reading: not measured",
  ].join("\n");
}

function transcriptText(b: BuiltScenario): string {
  let n = 0;
  return b.turns.map((t) => (t.role === "coach" ? `Coach: ${t.text}` : `Student answer ${++n}: ${t.text}`)).join("\n");
}

// ------------------------------------------------------------------ A. measured numbers

interface MeasuredResult {
  scenario: string;
  fillers?: { truth: number; found: number; truthIncludingLike: number };
  reading?: { planted: string[]; missed: string[]; recall: number | null; precision: number | null; coveragePct: number | null; expectedCoveragePct: number };
  pace?: { truth: number; found: number | null };
  repetitions?: { found: string[] };
}

function evalMeasured(built: BuiltScenario[]): MeasuredResult[] {
  return built.map((b) => {
    const out: MeasuredResult = { scenario: b.scenario.id };
    const text = b.turns.filter((t) => t.role === "student").map((t) => t.text).join(" ");
    // Exact answer: count the filler words we typed in ourselves. "like" is not counted by design (it is often a real word).
    const tally = (re: RegExp) => (text.match(re) ?? []).length;
    const truth = tally(/\b(um|umm|uhm|uh|uhh|er|erm|hmm|hm|ah|basically|actually|literally)\b/gi) + tally(/\byou know\b/gi) + tally(/\bi mean\b/gi);
    out.fillers = { truth, found: b.request.speech.fillerCount, truthIncludingLike: truth + tally(/\blike\b/gi) };

    if (b.reading) {
      const missed = b.reading.missedWords;
      const planted = b.plantedMisreads;
      const hit = planted.filter((w) => missed.includes(w)).length;
      const expectedCoverage = Math.round(b.scenario.readShare * 100);
      out.reading = {
        planted,
        missed,
        recall: planted.length ? Math.round((hit / planted.length) * 100) : null,
        precision: missed.length ? Math.round((missed.filter((w) => planted.includes(w)).length / missed.length) * 100) : null,
        coveragePct: b.reading.coveragePct,
        expectedCoveragePct: expectedCoverage,
      };
    }
    const spokenWords = b.turns.filter((t) => t.role === "student").reduce((n, t) => n + tokenize(t.text).length, 0);
    const speakingSec = b.turns.reduce((n, t) => n + (t.speakingSec ?? 0), 0);
    out.pace = { truth: Math.round(spokenWords / (speakingSec / 60)), found: b.request.speech.wpm };
    out.repetitions = { found: b.request.speech.repetitions };
    return out;
  });
}

// ------------------------------------------------------------------ B. written feedback

interface ReportRun {
  scenario: string;
  run: number;
  ok: boolean;
  /** True when the report came back the first time, without the test having to ask again. */
  firstTry?: boolean;
  reason?: string;
  seconds: number;
  model?: string;
  droppedQuotes?: number;
  shortText?: string;
  fullText?: string;
  shortReadability?: Readability;
  fullReadability?: Readability;
  quotesChecked?: number;
  quotesFound?: number;
  /** Corrections for a scenario with known wrong phrases: did the "said" quote target a real planted error, and does "better" remove it? */
  corrections?: { said: string; targetsRealError: boolean; fixed: boolean }[];
  unverifiedNumbers?: number[];
  judge?: JudgeResult;
}

function allowedNumbers(b: BuiltScenario): Set<number> {
  const s = b.request.speech;
  const r = b.reading;
  const nums: (number | null | undefined)[] = [
    s.totalWords, s.avgAnswerWords, s.wpm, s.fillerCount, s.fillerPer100, s.pauseCount, s.voiceTurns, s.repetitionCount, s.uniqueWords, s.longestPauseSec,
    b.scenario.answers.length, r?.accuracyPct, r?.coveragePct, r?.wpm, r?.spokenWordCount, b.request.passageWords, b.request.readingSec,
    ...s.fillers.map((f) => f.count),
  ];
  const out = new Set<number>();
  for (const n of nums) if (typeof n === "number") for (const d of [-1, 0, 1]) out.add(Math.round(n) + d);
  for (let i = 0; i <= 10; i++) out.add(i); // small counts and minutes: "2 things", "5 minutes"
  return out;
}

async function evalReportRun(b: BuiltScenario, run: number): Promise<ReportRun> {
  const started = Date.now();
  const res = await reportPost(post("/api/coach/report", b.request));
  const data = (await res.json()) as { ai?: AiFeedback | null; reason?: string; model?: string; droppedQuotes?: number };
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (!data.ai) return { scenario: b.scenario.id, run, ok: false, reason: data.reason ?? `HTTP ${res.status}`, seconds };

  const ai = data.ai;
  const answers = b.scenario.answers;
  const session = buildSession({
    id: `eval-${b.scenario.id}-${run}`,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_900_000,
    budgetSec: 1200,
    moduleId: b.module.id,
    field: b.module.field,
    level: b.module.level,
    goal: b.module.goal,
    liveAi: true,
    readingSec: b.request.readingSec ?? 60,
    passageWords: b.request.passageWords ?? 0,
    reading: { mode: "aloud", durationSec: b.request.readingSec ?? 60, aloud: b.request.readingAloud },
    turns: b.turns,
    vision: null,
    keepTranscript: true,
    ai,
    model: data.model,
  });
  const quick = buildQuickReport(session);
  const shortText = [
    quick.headline,
    ...quick.good.map((g) => `${g.area}: ${g.text}`),
    ...quick.fix.map((f) => `${f.area}: ${f.problem}${f.how ? ` Try this: ${f.how}` : ""}`),
    quick.sayItBetter ? `Say it like this: ${quick.sayItBetter.better}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const fullText = flatten(ai);

  // Quotes must really be in the answers (the service already removes the ones that are not).
  const quotes = [...ai.strengths.map((s) => s.quote), ...ai.improvements.map((s) => s.quote), ...ai.grammar.map((g) => g.quote), ...(ai.sayItBetter ?? []).map((s) => s.said)].filter(Boolean) as string[];
  const haystack = norm(answers.join(" "));
  const found = quotes.filter((q) => haystack.includes(norm(q))).length;

  const wrong = b.scenario.planted.flatMap((p) => p.wrong ?? []);
  const corrections = wrong.length
    ? [...(ai.sayItBetter ?? []).map((s) => ({ said: s.said, better: s.better })), ...ai.grammar.map((g) => ({ said: g.quote, better: g.suggestion }))].map((c) => {
        const said = norm(c.said);
        const hits = wrong.filter((w) => hasPhrase(said, w));
        return { said: c.said, targetsRealError: hits.length > 0, fixed: hits.length > 0 && hits.every((w) => !hasPhrase(c.better, w)) };
      })
    : undefined;

  const allowed = allowedNumbers(b);
  const unverifiedNumbers = [...new Set(numbersIn(fullText).filter((n) => !allowed.has(Math.round(n))))];

  let judge: JudgeResult | undefined;
  try {
    judge = await judgeReport({
      title: b.scenario.title,
      planted: b.scenario.planted.map((p) => ({ id: p.id, what: p.what })),
      transcript: transcriptText(b),
      measured: measuredText(b),
      // The marker reads what the STUDENT sees (the short report), not the AI's full text.
      reportText: shortText,
      control: Boolean(b.scenario.control),
    });
  } catch (e) {
    console.error("judge failed:", e instanceof Error ? e.message : e);
  }

  return {
    scenario: b.scenario.id,
    run,
    ok: true,
    seconds,
    model: data.model,
    droppedQuotes: data.droppedQuotes,
    shortText,
    fullText,
    shortReadability: readability(shortText),
    fullReadability: readability(fullText),
    quotesChecked: quotes.length,
    quotesFound: found,
    corrections,
    unverifiedNumbers,
    judge,
  };
}

// ------------------------------------------------------------------ C. coach questions

const CONVERSATIONS: { moduleId: string; answers: string[] }[] = [
  {
    moduleId: "computer-science-beginner-fluency",
    answers: [
      "Yes, I send messages to my friends every day. I message my best friend the most.",
      "The message goes from her phone to a tall tower. Then it moves through cables.",
      "It travels under the ground and sometimes under the sea, and it only takes a second.",
      "Yesterday I told my mother I would be late, and she replied with a thumbs up. It was a short message but she understood.",
      "On a normal day I wake up, check messages, use maps to reach school, watch videos after dinner, and call my cousin before sleeping.",
      "Once I received a message from my brother who was lost in a new city, and I helped him find the station with my phone.",
    ],
  },
  {
    moduleId: "science-advanced-confidence",
    answers: [
      "Supporters say gene editing can remove the genes that cause painful diseases that families inherit.",
      "Critics worry because a change in an embryo can pass to children who never agreed to it.",
      "Treating a serious disease is about removing suffering, but improving height or intelligence is about wanting an advantage.",
      "My neighbour was unsure about a new vaccine, and many people only trusted it after they saw doctors take it first.",
      "Fairness matters because poor families cannot pay, so only rich children would get stronger bodies and better health.",
      "I would allow it only for serious diseases, because preventing pain is a strong reason, and strict rules can stop people from choosing taller or smarter children.",
    ],
  },
];

interface ConversationResult {
  moduleId: string;
  questions: string[];
  difficulty: number[];
  related: boolean[];
  spearman: number | null;
  nonDecreasingPct: number | null;
  stageMeans: { easy: number | null; medium: number | null; hard: number | null };
  oneQuestionPct: number | null;
  avgWords: number;
  maxWords: number;
}

const lastQuestion = (reply: string) => {
  const sentences = reply.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [reply];
  return [...sentences].reverse().find((s) => s.endsWith("?")) ?? sentences.at(-1) ?? reply;
};

async function evalConversation(c: (typeof CONVERSATIONS)[number]): Promise<ConversationResult> {
  const m = getModule(c.moduleId)!;
  const history: { role: "coach" | "student"; text: string }[] = [{ role: "coach", text: m.openingQuestion }];
  const questions = [m.openingQuestion];
  const replies: string[] = [];
  for (const answer of c.answers) {
    history.push({ role: "student", text: answer });
    const res = await turnPost(
      post("/api/coach/turn", { moduleId: m.id, goal: m.goal, level: m.level, ageBand: "13to17", remainingSec: 900, event: "answer", history }),
    );
    const data = (await res.json()) as CoachTurnResponse;
    history.push({ role: "coach", text: data.text });
    replies.push(data.text);
    questions.push(lastQuestion(data.text));
  }
  // Shuffle so the judge cannot follow the order.
  const order = questions.map((_, i) => i).sort((a, b) => ((a * 7 + 3) % 11) - ((b * 7 + 3) % 11));
  const j = await judgeQuestions(m.passage, order.map((i) => ({ id: i, text: questions[i] })));
  const byId = new Map(j.questions.map((q) => [q.id, q]));
  const difficulty = questions.map((_, i) => byId.get(i)?.difficulty ?? 0);
  const related = questions.map((_, i) => byId.get(i)?.relatedToReading ?? false);
  const pairs = difficulty.slice(1).map((d, i) => d >= difficulty[i]);
  const stage = (from: number, to: number) => {
    const xs = difficulty.slice(from, to);
    return xs.length ? Math.round(mean(xs) * 10) / 10 : null;
  };
  const words = replies.map((r) => tokenize(r).length);
  return {
    moduleId: m.id,
    questions,
    difficulty,
    related,
    spearman: spearman(questions.map((_, i) => i), difficulty),
    nonDecreasingPct: pct(pairs.filter(Boolean).length, pairs.length),
    // Question numbers 1-3 easy, 4-5 medium, 6+ hard (the same rule the coach is given).
    stageMeans: {
      easy: stage(0, questions.findIndex((_, i) => difficultyOfQuestion(i + 1) !== "easy")),
      medium: stage(3, 5),
      hard: stage(5, questions.length),
    },
    oneQuestionPct: pct(replies.filter((r) => (r.match(/\?/g) ?? []).length === 1).length, replies.length),
    avgWords: Math.round(mean(words)),
    maxWords: Math.max(...words),
  };
}

// ------------------------------------------------------------------ summary

function summarise(measured: MeasuredResult[], runs: ReportRun[], convos: ConversationResult[], built: BuiltScenario[]) {
  const ok = runs.filter((r) => r.ok);
  const withJudge = ok.filter((r) => r.judge);
  const mistakeRuns = withJudge.filter((r) => !built.find((b) => b.scenario.id === r.scenario)!.scenario.control);
  const controlRuns = withJudge.filter((r) => built.find((b) => b.scenario.id === r.scenario)!.scenario.control);

  const plantedScores = mistakeRuns.flatMap((r) => r.judge!.planted.map((p): number => (p.verdict === "yes" ? 1 : p.verdict === "partly" ? 0.5 : 0)));
  const claims = withJudge.flatMap((r) => r.judge!.claims);
  const impMistake = mistakeRuns.flatMap((r) => r.judge!.improvements);
  const impControl = controlRuns.flatMap((r) => r.judge!.improvements);
  const strengths = withJudge.flatMap((r) => r.judge!.strengths);
  const rating = (k: keyof JudgeResult["ratings"]) => Math.round(mean(withJudge.map((r) => r.judge!.ratings[k])) * 10) / 10;

  const corrections = ok.flatMap((r) => r.corrections ?? []);
  const quotesChecked = ok.reduce((n, r) => n + (r.quotesChecked ?? 0), 0);
  const quotesFound = ok.reduce((n, r) => n + (r.quotesFound ?? 0), 0);

  // Same session, two runs: did both runs find the same planted mistakes?
  const consistency: number[] = [];
  for (const b of built) {
    const rs = withJudge.filter((r) => r.scenario === b.scenario.id);
    if (rs.length < 2 || b.scenario.planted.length === 0) continue;
    const detected = (r: ReportRun) => new Set(r.judge!.planted.filter((p) => p.verdict !== "no").map((p) => p.id));
    const a = detected(rs[0]);
    const c = detected(rs[1]);
    const union = new Set([...a, ...c]);
    consistency.push(union.size ? [...a].filter((x) => c.has(x)).length / union.size : 1);
  }

  return {
    reports: {
      attempts: runs.length,
      succeeded: ok.length,
      firstTryPct: pct(runs.filter((r) => r.firstTry).length, runs.length),
      successPct: pct(ok.length, runs.length),
      avgSeconds: Math.round(mean(ok.map((r) => r.seconds)) * 10) / 10,
      maxSeconds: Math.max(0, ...ok.map((r) => r.seconds)),
    },
    findsMistakes: {
      plantedMistakesChecked: plantedScores.length,
      recallPct: pct(plantedScores.reduce((a, b) => a + b, 0), plantedScores.length),
      consistencyPct: consistency.length ? Math.round(mean(consistency) * 100) : null,
    },
    honesty: {
      claimsChecked: claims.length,
      supportedPct: pct(claims.filter((c) => c.label === "supported").length, claims.length),
      misleadingPct: pct(claims.filter((c) => c.label === "misleading").length, claims.length),
      strengthsTruePct: pct(strengths.filter((s) => s.label === "true").length, strengths.length),
      inventedProblemsOnMistakeSessionsPct: pct(impMistake.filter((i) => i.label === "invented_problem").length, impMistake.length),
      inventedProblemsOnControlPct: pct(impControl.filter((i) => i.label === "invented_problem").length, impControl.length),
      realIssuesOnControlPct: pct(impControl.filter((i) => i.label === "real_issue").length, impControl.length),
      quotesReallySaidPct: pct(quotesFound, quotesChecked),
      quotesRemovedByServer: ok.reduce((n, r) => n + (r.droppedQuotes ?? 0), 0),
      numbersNotInTheData: ok.reduce((n, r) => n + (r.unverifiedNumbers?.length ?? 0), 0),
    },
    corrections: {
      checked: corrections.length,
      pointAtARealMistakePct: pct(corrections.filter((c) => c.targetsRealError).length, corrections.length),
      mistakeRemovedPct: pct(corrections.filter((c) => c.fixed).length, corrections.filter((c) => c.targetsRealError).length),
    },
    easeOfReading: {
      shortReportWords: Math.round(mean(ok.map((r) => r.shortReadability!.words))),
      shortReportGrade: Math.round(mean(ok.map((r) => r.shortReadability!.grade)) * 10) / 10,
      avgSentenceWords: Math.round(mean(ok.map((r) => r.shortReadability!.avgSentenceWords)) * 10) / 10,
      longestSentenceWords: Math.max(0, ...ok.map((r) => r.shortReadability!.longestSentenceWords)),
      jargonWordsFound: [...new Set(ok.flatMap((r) => r.shortReadability!.jargon))],
      fullReportWords: Math.round(mean(ok.map((r) => r.fullReadability!.words))),
    },
    judgeRatings: { accuracy: rating("accuracy"), specificity: rating("specificity"), actionability: rating("actionability"), simpleLanguage: rating("simpleLanguage"), tone: rating("tone"), outOf: 5 },
    measuredNumbers: {
      fillerCountExactPct: pct(measured.filter((m) => m.fillers && m.fillers.found === m.fillers.truth).length, measured.length),
      fillerCounts: measured.map((m) => `${m.scenario}: found ${m.fillers?.found} of ${m.fillers?.truth}`),
      likeNotCounted: measured.map((m) => `${m.scenario}: ${(m.fillers?.truthIncludingLike ?? 0) - (m.fillers?.truth ?? 0)}`),
      misreadRecallPct: Math.round(mean(measured.filter((m) => m.reading?.recall != null).map((m) => m.reading!.recall!))),
      misreadPrecisionPct: Math.round(mean(measured.filter((m) => m.reading?.precision != null).map((m) => m.reading!.precision!))),
      coverageErrorPoints: measured.map((m) => `${m.scenario}: said ${m.reading?.coveragePct}% (true ${m.reading?.expectedCoveragePct}%)`),
      paceErrorPct: Math.round(mean(measured.filter((m) => m.pace?.found).map((m) => (Math.abs(m.pace!.found! - m.pace!.truth) / m.pace!.truth) * 100))),
    },
    coachQuestions: convos.map((c) => ({
      module: c.moduleId,
      difficultyInOrder: c.difficulty,
      orderCorrelation: c.spearman,
      neverEasierPct: c.nonDecreasingPct,
      meanDifficultyEasyMediumHard: c.stageMeans,
      relatedToReadingPct: pct(c.related.filter(Boolean).length, c.related.length),
      exactlyOneQuestionPct: c.oneQuestionPct,
      avgReplyWords: c.avgWords,
      longestReplyWords: c.maxWords,
    })),
  };
}

const TARGETS: { name: string; get: (s: ReturnType<typeof summarise>) => number | null; ok: (v: number) => boolean; goal: string }[] = [
  { name: "Reports that arrive (first try)", get: (s) => s.reports.firstTryPct, ok: (v) => v >= 95, goal: ">= 95%" },
  { name: "Reports that arrive (after one more try)", get: (s) => s.reports.successPct, ok: (v) => v >= 100, goal: "100%" },
  { name: "Time to write a report (average seconds)", get: (s) => s.reports.avgSeconds, ok: (v) => v <= 6, goal: "<= 6 s" },
  { name: "Planted mistakes found", get: (s) => s.findsMistakes.recallPct, ok: (v) => v >= 80, goal: ">= 80%" },
  { name: "Same answer on a second run", get: (s) => s.findsMistakes.consistencyPct, ok: (v) => v >= 80, goal: ">= 80%" },
  { name: "Statements that are true", get: (s) => s.honesty.supportedPct, ok: (v) => v >= 90, goal: ">= 90%" },
  { name: "Misleading statements", get: (s) => s.honesty.misleadingPct, ok: (v) => v <= 5, goal: "<= 5%" },
  { name: "Praise that is true", get: (s) => s.honesty.strengthsTruePct, ok: (v) => v >= 90, goal: ">= 90%" },
  { name: "Invented problems (strong session)", get: (s) => s.honesty.inventedProblemsOnControlPct, ok: (v) => v <= 10, goal: "<= 10%" },
  { name: "Quotes that were really said", get: (s) => s.honesty.quotesReallySaidPct, ok: (v) => v >= 100, goal: "100%" },
  { name: "Fixes that remove the mistake", get: (s) => s.corrections.mistakeRemovedPct, ok: (v) => v >= 90, goal: ">= 90%" },
  { name: "Reading grade of the short report", get: (s) => s.easeOfReading.shortReportGrade, ok: (v) => v <= 7, goal: "<= grade 7" },
  { name: "Words in the short report", get: (s) => s.easeOfReading.shortReportWords, ok: (v) => v <= 170, goal: "<= 170" },
  { name: "Longest sentence (words)", get: (s) => s.easeOfReading.longestSentenceWords, ok: (v) => v <= 25, goal: "<= 25" },
  { name: "Judge: simple language (of 5)", get: (s) => s.judgeRatings.simpleLanguage, ok: (v) => v >= 4, goal: ">= 4" },
  { name: "Judge: accuracy (of 5)", get: (s) => s.judgeRatings.accuracy, ok: (v) => v >= 4, goal: ">= 4" },
  { name: "Filler counts exactly right", get: (s) => s.measuredNumbers.fillerCountExactPct, ok: (v) => v >= 100, goal: "100%" },
  { name: "Misread words found (reading)", get: (s) => s.measuredNumbers.misreadRecallPct, ok: (v) => v >= 80, goal: ">= 80%" },
  { name: "Coach questions never get easier", get: (s) => Math.round(mean(s.coachQuestions.map((c) => c.neverEasierPct ?? 0))), ok: (v) => v >= 70, goal: ">= 70%" },
  { name: "Coach question order vs difficulty (Spearman)", get: (s) => Math.round(mean(s.coachQuestions.map((c) => c.orderCorrelation ?? 0)) * 100) / 100, ok: (v) => v >= 0.7, goal: ">= 0.7" },
  { name: "Coach asks exactly one question", get: (s) => Math.round(mean(s.coachQuestions.map((c) => c.exactlyOneQuestionPct ?? 0))), ok: (v) => v >= 90, goal: ">= 90%" },
];

function writeResults(summary: ReturnType<typeof summarise>, details: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify({ when: new Date().toISOString(), summary, details }, null, 2));
  const rows = TARGETS.map((t) => {
    const v = t.get(summary);
    return `| ${t.name} | ${v === null ? "n/a" : v} | ${t.goal} | ${v === null ? "-" : t.ok(v) ? "pass" : "FAIL"} |`;
  });
  fs.writeFileSync(path.join(OUT_DIR, "latest.md"), ["| Check | Result | Goal | |", "|---|---|---|---|", ...rows].join("\n") + "\n");
  console.log("\n" + ["| Check | Result | Goal | |", "|---|---|---|---|", ...rows].join("\n"));
}

describe("AI quality check", () => {
  it(
    "marks the report and the coach against planted mistakes",
    async () => {
      loadEnv();
      if (!process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error("No AI key found. Set EVAL_ENV_FILE or add a .env file.");

      const built = SCENARIOS.map((s) => buildScenario(s, ladderQuestions(getModule(s.moduleId)!)));
      const measured = evalMeasured(built);

      // One after another: the AI service lets a key use only a few thousand words a minute.
      const runs: ReportRun[] = [];
      const wait = (sec: number) => new Promise((r) => setTimeout(r, sec * 1000));
      for (const b of built) {
        for (let r = 1; r <= RUNS_PER_SCENARIO; r++) {
          let run = await evalReportRun(b, r);
          const firstTry = run.ok;
          if (!run.ok) {
            await wait(40); // the AI key allows only a few thousand words a minute; let it recover and ask once more
            run = await evalReportRun(b, r);
          }
          runs.push({ ...run, firstTry });
          await wait(Number(process.env.EVAL_GAP_SEC ?? 15));
        }
      }
      const convos: ConversationResult[] = [];
      if (!process.env.EVAL_SKIP_CONVO) for (const c of CONVERSATIONS) convos.push(await evalConversation(c));

      const summary = summarise(measured, runs, convos, built);
      writeResults(summary, { measured, runs, convos });
    },
    900_000,
  );
});
