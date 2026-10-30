/*
 * Simple help for saying a word clearly. There is no pronunciation dictionary in the app, so the parts
 * come from spelling rules and are a guide for saying the word slowly, not a dictionary respelling.
 */

const VOWELS = new Set("aeiouy");
const DIGRAPHS = ["tch", "th", "sh", "ch", "ph", "wh", "ck", "ng", "gh", "qu"];
/** Pairs that usually start a syllable together (as in "pla-net" or "a-stro"). */
const BLENDS = new Set(["bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tr", "tw", "str", "spr", "scr", "spl", "thr", "shr", "sch"]);
// "st", "sp", "sk" and similar are split between two parts inside a word ("cus-tom", "whis-per"), so they are not listed.

type Unit = { v: boolean; text: string };

/** Splits a word into vowel groups and consonant units, so "th" and "ck" count as one sound. */
function units(word: string): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < word.length) {
    if (VOWELS.has(word[i])) {
      let j = i;
      while (j < word.length && VOWELS.has(word[j])) j++;
      out.push({ v: true, text: word.slice(i, j) });
      i = j;
      continue;
    }
    const digraph = DIGRAPHS.find((d) => word.startsWith(d, i));
    if (digraph) {
      out.push({ v: false, text: digraph });
      i += digraph.length;
    } else {
      out.push({ v: false, text: word[i] });
      i++;
    }
  }
  return out;
}

/** Splits an English word into parts to say one at a time: "password" gives ["pass", "word"]. */
export function syllabify(raw: string): string[] {
  const word = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length <= 3) return word ? [word] : [];
  let u = units(word);

  // A silent final "e" ("make", "time") or "ed"/"es" after most sounds ("walked", "makes") is not a part of its own.
  const last = u[u.length - 1];
  const beforeLast = u[u.length - 2];
  if (u.filter((x) => x.v).length > 1) {
    const endsLe = last.text === "e" && u.length >= 3 && u[u.length - 2].text === "l" && !u[u.length - 3].v;
    if (last.v && last.text === "e" && !endsLe && beforeLast && !beforeLast.v) {
      u = [...u.slice(0, -2), { v: false, text: beforeLast.text + "e" }];
    } else if (!last.v && (last.text === "d" || last.text === "s") && beforeLast?.text === "e" && u.length >= 4) {
      // "walked" and "makes": the "e" is silent after most sounds, but "wanted" and "boxes" keep it.
      const sound = u[u.length - 3];
      const keepsE = last.text === "d" ? /^(t|d)$/ : /^(s|x|z|ch|sh|c|g|tch)$/;
      if (!sound.v && !keepsE.test(sound.text)) u = [...u.slice(0, -2), { v: false, text: "e" + last.text }];
    }
  }

  // Cut points: after each vowel group, decide where the consonants in between are shared.
  const parts: string[] = [];
  let current = "";
  let k = 0;
  while (k < u.length) {
    const unit = u[k];
    current += unit.text;
    k++;
    if (!unit.v) continue;
    // Gather the consonant units that follow this vowel group, up to the next vowel group.
    let end = k;
    while (end < u.length && !u[end].v) end++;
    if (end >= u.length) {
      // No vowel group after this one: the rest belongs to this part.
      while (k < u.length) current += u[k++].text;
      break;
    }
    const cons = u.slice(k, end).map((c) => c.text);
    let keep = 0; // how many of the consonants stay with the current part
    if (cons.length === 0) keep = 0;
    else if (cons.length === 1) keep = 0;
    else if (cons[0] === cons[1]) keep = 2; // "pass-word", "let-ter"
    else if (cons.length === 2) keep = BLENDS.has(cons.join("")) ? 0 : 1; // "pla-net", "dis-cuss"
    else {
      // Three or more: "in-struct", "ex-plain", "hand-some"
      const tail = cons.slice(-2).join("");
      const tail3 = cons.slice(-3).join("");
      keep = BLENDS.has(tail3) ? cons.length - 3 : BLENDS.has(tail) ? cons.length - 2 : cons.length - 1;
      keep = Math.max(1, keep);
    }
    for (let c = 0; c < keep; c++) current += cons[c];
    parts.push(current);
    current = "";
    k += keep;
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

const ENDINGS = ["ing", "est", "ly", "ed", "es", "er", "s", "d"];

export interface PronunciationHelp {
  /** The word in parts, such as "pass-word". */
  parts: string;
  /** One sentence that says what to change. */
  tip: string;
}

/** What to do when the app heard `heard` while the passage says `word`. */
export function pronunciationHelp(word: string, heard?: string): PronunciationHelp {
  const w = word.toLowerCase();
  const h = (heard ?? "").toLowerCase();
  const parts = syllabify(w).join("-") || w;
  if (h && h !== w && w.startsWith(h)) {
    const suffix = ENDINGS.find((e) => w === h + e);
    if (suffix) return { parts, tip: `Say the ending "${suffix}" clearly at the end of the word.` };
  }
  if (h && h !== w && h.startsWith(w) && h.length - w.length <= 3) {
    return { parts, tip: "Stop at the end of the word without adding a sound after it." };
  }
  const split = parts.includes("-");
  return { parts, tip: split ? "Say each part slowly, then join the parts together." : "Say it slowly and clearly, and make every sound." };
}
