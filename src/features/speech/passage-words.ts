import { tokenize } from "./metrics";

export interface PassageWord {
  text: string;
  /** Number of passage words (as counted by `tokenize`) up to and including this word. The last one of this word is at `tokenEnd - 1`. */
  tokenEnd: number;
}

/** The passage split into paragraphs of words, each word knowing which counted word it ends on. Shared by the reading screen and the report. */
export function splitPassage(passage: string): { paragraphs: PassageWord[][]; tokens: string[] } {
  const paras = passage.split(/\n\n+/);
  const flat = paras.flatMap((p, para) => p.split(/\s+/).filter(Boolean).map((text) => ({ text, para, n: tokenize(text).length })));
  const ends = flat.reduce<number[]>((acc, w) => {
    acc.push((acc[acc.length - 1] ?? 0) + w.n);
    return acc;
  }, []);
  const paragraphs = paras.map((_, para) => flat.flatMap((w, i) => (w.para === para ? [{ text: w.text, tokenEnd: ends[i] }] : [])));
  return { paragraphs, tokens: tokenize(passage) };
}
