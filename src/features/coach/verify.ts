import type { AiFeedback } from "../session/types";

/** Lowercase, drop punctuation, collapse spaces, so quotes match speech-recognition text. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/'/g, "")
    .trim();
}

export function quoteAppears(quote: string, haystackNormalized: string): boolean {
  const q = normalizeText(quote);
  return q.length >= 3 && haystackNormalized.includes(q);
}

/**
 * The model must quote the student verbatim. We enforce that: quotes that are not in the
 * transcript are removed (examples) or the item is dropped (grammar corrections), so the
 * report never shows words the student did not say.
 */
export function verifyFeedback(
  feedback: AiFeedback,
  studentAnswers: string[],
): { feedback: AiFeedback; droppedQuotes: number } {
  const haystack = normalizeText(studentAnswers.join(" . "));
  let dropped = 0;

  const keepQuote = <T extends { quote?: string }>(item: T): T => {
    if (item.quote && !quoteAppears(item.quote, haystack)) {
      dropped++;
      return { ...item, quote: undefined };
    }
    return item;
  };

  const grammar = feedback.grammar.filter((g) => {
    const ok = quoteAppears(g.quote, haystack);
    if (!ok) dropped++;
    return ok;
  });

  // A "say it better" example must start from something the student really said.
  const sayItBetter = feedback.sayItBetter?.filter((x) => {
    const ok = quoteAppears(x.said, haystack);
    if (!ok) dropped++;
    return ok;
  });

  const answerCount = studentAnswers.length;
  // Evaluate before building the result so `dropped` is final when read.
  const strengths = feedback.strengths.map(keepQuote);
  const improvements = feedback.improvements.map(keepQuote);
  return {
    droppedQuotes: dropped,
    feedback: {
      ...feedback,
      strengths,
      improvements,
      grammar,
      ...(sayItBetter ? { sayItBetter } : {}),
      structure: {
        ...feedback.structure,
        perAnswer: feedback.structure.perAnswer.filter((a) => a.answerNumber >= 1 && a.answerNumber <= answerCount),
      },
    },
  };
}

/** Pull the first balanced JSON object out of model output (tolerates code fences / prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object in model output");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON object in model output");
}
