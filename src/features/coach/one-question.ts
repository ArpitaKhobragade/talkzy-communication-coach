/*
 * The coach must ask exactly one question per turn, because the student answers by voice and cannot
 * tell which of two questions to answer. If the AI asks more than one, everything after the first
 * question is dropped.
 */
export function keepOneQuestion(reply: string): string {
  // The smaller model sometimes starts with a stray closing quote mark, which would be read aloud.
  const text = reply.replace(/\s+/g, " ").replace(/^[”’"']+\s*/, "").trim();
  const first = text.indexOf("?");
  if (first === -1 || first === text.length - 1) return text;
  const rest = text.slice(first + 1);
  // Nothing after the question mark, or only closing quotes/brackets: keep it all.
  if (!/[A-Za-z0-9]/.test(rest)) return text;
  // A second question follows (possibly after a sentence): keep the text up to the first question.
  if (rest.includes("?")) return text.slice(0, first + 1).trim();
  return text;
}
