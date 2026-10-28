import type { SpeechMetrics, Turn } from "../session/types";

/** A silence of at least this long inside an answer counts as a pause. */
export const PAUSE_THRESHOLD_SEC = 1.0;
/** We only report pace when we heard at least this much speech from the microphone. */
export const MIN_SPEAKING_SEC_FOR_PACE = 20;
export const MIN_WORDS_FOR_PACE = 30;
export const MIN_WORDS_FOR_VARIETY = 50;

/**
 * Single-word fillers. "like", "so" and "well" are deliberately NOT counted: they are normal
 * words and cannot be told apart from filler use without prosody.
 * Note: browser speech recognisers often drop "um"/"uh", so counts are a lower bound.
 */
const SINGLE_FILLERS = new Set([
  "um", "umm", "ummm", "uh", "uhh", "uhm", "er", "erm", "hmm", "hmmm", "hm", "mm", "ah", "ahh", "aa", "aah", "aaa", "ee", "eee",
  // Sounds and words that students in India often use to fill a pause.
  "haa", "haan", "han", "hanji", "ha", "acha", "achha", "matlab", "basically", "actually", "literally",
]);
const PHRASE_FILLERS = ["you know", "i mean", "kind of", "sort of", "you see"];

export function tokenize(text: string): string[] {
  return (text.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []).map((w) => w.replace(/'/g, ""));
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

export function findFillers(text: string): { word: string; count: number }[] {
  const words = tokenize(text);
  const counts = new Map<string, number>();
  const bump = (k: string, n = 1) => counts.set(k, (counts.get(k) ?? 0) + n);

  for (const w of words) if (SINGLE_FILLERS.has(w)) bump(w);
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (PHRASE_FILLERS.includes(pair)) bump(pair);
  }
  return [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
}

/** Immediate repeats of a word ("the the") or of a two-word phrase ("i think i think"). */
export function findRepetitions(text: string): string[] {
  const words = tokenize(text);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i + 3 < words.length && words[i] === words[i + 2] && words[i + 1] === words[i + 3] && words[i] !== words[i + 1]) {
      out.push(`${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`);
      i += 3;
      continue;
    }
    if (i + 1 < words.length && words[i] === words[i + 1] && !SINGLE_FILLERS.has(words[i])) {
      out.push(`${words[i]} ${words[i + 1]}`);
      i += 1;
    }
  }
  return out;
}

/**
 * The same sentence without fillers ("um", "basically", "you know") and accidental repeats ("the the").
 * This is the clean version a student could say instead. It never adds or changes any ideas.
 */
export function cleanSpeech(text: string): string {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "").replace(/'/g, "");
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = norm(raw[i]);
    if (!w) continue;
    const next = i + 1 < raw.length ? norm(raw[i + 1]) : "";
    if (PHRASE_FILLERS.includes(`${w} ${next}`)) {
      i++;
      continue;
    }
    if (SINGLE_FILLERS.has(w)) continue;
    if (out.length && norm(out[out.length - 1]) === w) continue;
    out.push(raw[i]);
  }
  let s = out.join(" ").replace(/^[,;:\s]+/, "");
  if (!s) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function computeSpeechMetrics(turns: Turn[]): SpeechMetrics {
  const student = turns.filter((t) => t.role === "student" && t.text.trim().length > 0);
  const voice = student.filter((t) => t.inputMode === "voice");

  const allText = student.map((t) => t.text).join(" ");
  const allWords = tokenize(allText);
  const voiceWords = voice.reduce((n, t) => n + countWords(t.text), 0);
  const speakingSec = voice.reduce((n, t) => n + (t.speakingSec ?? 0), 0);

  const wpm =
    speakingSec >= MIN_SPEAKING_SEC_FOR_PACE && voiceWords >= MIN_WORDS_FOR_PACE
      ? Math.round(voiceWords / (speakingSec / 60))
      : null;

  const fillerMap = new Map<string, number>();
  for (const t of student) for (const f of findFillers(t.text)) fillerMap.set(f.word, (fillerMap.get(f.word) ?? 0) + f.count);
  const fillers = [...fillerMap.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
  const fillerCount = fillers.reduce((n, f) => n + f.count, 0);

  const repetitions = student.flatMap((t) => findRepetitions(t.text));

  const latencies = voice.map((t) => t.latencySec).filter((x): x is number => typeof x === "number");
  const sample = allWords.slice(0, 200);
  const uniqueInSample = new Set(sample).size;

  return {
    voiceTurns: voice.length,
    typedTurns: student.length - voice.length,
    totalWords: allWords.length,
    voiceWords,
    speakingSec: round(speakingSec),
    wpm,
    fillerCount,
    fillerPer100: allWords.length >= 20 ? round((fillerCount / allWords.length) * 100) : null,
    fillers: fillers.slice(0, 8),
    repetitionCount: repetitions.length,
    repetitions: repetitions.slice(0, 20),
    pauseCount: voice.reduce((n, t) => n + (t.pauseCount ?? 0), 0),
    longestPauseSec: round(Math.max(0, ...voice.map((t) => t.longestPauseSec ?? 0))),
    avgLatencySec: latencies.length ? round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    avgAnswerWords: student.length ? Math.round(allWords.length / student.length) : null,
    uniqueWords: new Set(allWords).size,
    lexicalVariety: sample.length >= MIN_WORDS_FOR_VARIETY ? round(uniqueInSample / sample.length, 2) : null,
    longWordPct: allWords.length >= 20 ? round((allWords.filter((w) => w.length >= 7).length / allWords.length) * 100) : null,
  };
}

/** Plain-language pace band. 110-160 wpm is a commonly cited comfortable range for presenting. */
export function paceLabel(wpm: number | null): string {
  if (wpm === null) return "Not enough speech to measure";
  if (wpm < 100) return "Slower than typical";
  if (wpm <= 160) return "In a comfortable range";
  return "Faster than typical";
}
