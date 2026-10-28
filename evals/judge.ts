/*
 * A second AI (Qwen) reads the report and marks it, like a teacher checking homework. It is a
 * different model from the one that writes the report, so it does not simply agree with it.
 * It is told what mistakes were planted, so it can say whether each one was found.
 */
import { extractJson } from "../src/features/coach/verify";

export interface JudgeInput {
  title: string;
  planted: { id: string; what: string }[];
  transcript: string;
  measured: string;
  reportText: string;
  control: boolean;
}

export interface JudgeResult {
  planted: { id: string; verdict: "yes" | "partly" | "no"; evidence?: string }[];
  claims: { text: string; label: "supported" | "unsupported" | "misleading" }[];
  improvements: { title: string; label: "real_issue" | "reasonable_tip" | "invented_problem" }[];
  strengths: { title: string; label: "true" | "exaggerated" | "false" }[];
  ratings: { accuracy: number; specificity: number; actionability: number; simpleLanguage: number; tone: number };
  notes?: string;
}

const SYSTEM = `You are a strict, fair teacher marking a feedback report that an AI coach wrote for a school student. You are given the student's real answers, the measured numbers, the mistakes that were put into the session ON PURPOSE (the answer key), and the report. Judge ONLY from what you are given.

Reply with ONE JSON object and nothing else:
{
 "planted": [{"id": string, "verdict": "yes" | "partly" | "no", "evidence": string}],
 "claims": [{"text": string, "label": "supported" | "unsupported" | "misleading"}],
 "improvements": [{"title": string, "label": "real_issue" | "reasonable_tip" | "invented_problem"}],
 "strengths": [{"title": string, "label": "true" | "exaggerated" | "false"}],
 "ratings": {"accuracy": 1-5, "specificity": 1-5, "actionability": 1-5, "simpleLanguage": 1-5, "tone": 1-5},
 "notes": string
}

How to mark:
- "planted": one entry for EVERY item in the answer key. "yes" = the report clearly points the problem out (the student would learn about it). "partly" = hinted at, or only one example, or vague. "no" = not mentioned. If the answer key is empty, return an empty list.
- "claims": list each factual claim the report makes about what the student said, did or how they read (at most 12, the most important). "supported" = true according to the answers or the measured numbers. "unsupported" = cannot be checked or is not in the data. "misleading" = wrong, or the wrong amount (for example calls a few mistakes "many", or praises something that did not happen). Do NOT count general advice as a claim.
- "improvements": one entry for each item under improvements. "real_issue" = a real weakness in the answers or numbers. "reasonable_tip" = not a real weakness here, but a sensible next step for any student. "invented_problem" = the problem does not exist in the data.
- "strengths": one entry for each strength. "true", "exaggerated" or "false".
- ratings (1 = bad, 5 = excellent): accuracy (everything stated is true), specificity (points to the student's own words and numbers, not general tips), actionability (the student knows exactly what to do next), simpleLanguage (a 12-year-old learning English understands it at once), tone (kind and honest).
- "notes": ONE sentence on the biggest weakness of the report.`;

/** The marking AI is Qwen, run on Groq. It is a different model family from the one that writes the reports. */
async function ask(system: string, user: string, maxTokens = 3000): Promise<string> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY is needed for the judge");
  const model = process.env.EVAL_JUDGE_MODEL?.trim() || "qwen/qwen3.8-27b";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, (Number.isFinite(wait) && wait > 0 ? wait : 5 * (attempt + 1)) * 1000));
      continue;
    }
    throw new Error(`judge HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error("judge failed after retries");
}

export async function judgeReport(input: JudgeInput): Promise<JudgeResult> {
  const user = `SESSION: ${input.title}${input.control ? " (a control session: the student made NO mistakes)" : ""}

ANSWER KEY (mistakes planted on purpose):
${input.planted.length ? input.planted.map((p) => `- [${p.id}] ${p.what}`).join("\n") : "(none)"}

THE STUDENT'S ANSWERS:
${input.transcript}

MEASURED NUMBERS:
${input.measured}

THE REPORT TO MARK:
${input.reportText}`;
  const raw = await ask(SYSTEM, user);
  const j = extractJson(raw) as Partial<JudgeResult>;
  return {
    planted: j.planted ?? [],
    claims: j.claims ?? [],
    improvements: j.improvements ?? [],
    strengths: j.strengths ?? [],
    ratings: j.ratings ?? { accuracy: 0, specificity: 0, actionability: 0, simpleLanguage: 0, tone: 0 },
    notes: j.notes,
  };
}

export interface QuestionJudgement {
  questions: { id: number; difficulty: 1 | 2 | 3 | 4 | 5; relatedToReading: boolean }[];
}

/** Rates how hard each question is. The questions are shuffled, so the judge cannot just follow their order. */
export async function judgeQuestions(passage: string, questions: { id: number; text: string }[]): Promise<QuestionJudgement> {
  const system = `You rate spoken questions that a coach asks a school student after they read a short passage. For each question give "difficulty" from 1 to 5: 1 = a very easy question with a short answer from the text or daily life, 3 = needs a reason or an example, 5 = needs an opinion, a comparison or a trade-off with reasons. Also say whether the question is related to the passage or its subject ("relatedToReading"). Reply with ONLY JSON: {"questions":[{"id":number,"difficulty":number,"relatedToReading":boolean}]}`;
  const raw = await ask(system, `PASSAGE:\n${passage}\n\nQUESTIONS:\n${questions.map((q) => `${q.id}. ${q.text}`).join("\n")}`, 1500);
  return extractJson(raw) as QuestionJudgement;
}
