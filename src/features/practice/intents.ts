/*
 * What the student means when they say a short thing out loud to the coach: end the session, move on,
 * or say more. These are plain phrase checks on the text the app heard, so they run on the device and
 * the same words always give the same answer.
 */

export type ConfirmIntent = "end" | "yes" | "more" | "other";

const clean = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordCount = (text: string) => (text ? text.split(" ").length : 0);

/** Only a short sentence counts as a command. A long answer that happens to contain the words does not. */
const MAX_COMMAND_WORDS = 16;

const END_PATTERNS: RegExp[] = [
  /\b(end|stop|finish|quit|close|exit|cancel)\b( the| this| my| our| it)?( practice| learning)? (session|practice|lesson|conversation|class|call|chat)\b/,
  /\b(i|we) (want|would like|wanna|need|have) to (end|stop|finish|quit|leave|exit|go)\b/,
  /\b(i|we) (want|would like|wanna) (to )?(the )?(report|feedback)\b/,
  /\b(let'?s|lets|let us) (end|stop|finish|quit)\b/,
  /\bthat('?s| is) (enough|all) for (today|now)\b/,
  /\b(end|stop|finish) (it|now|here|this)\b/,
  /\b(i'?m|i am) (done|finished) (for today|for now|with (the |this )?(session|practice|lesson))\b/,
  /\b(give|show|get) me (my |the )?(report|feedback|result|results)\b/,
  /\bi (want|would like|wanna) to (see|get) (my |the )?(report|feedback)\b/,
];

/** True when the student is asking to end the session. */
export function endIntent(text: string): boolean {
  const t = clean(text);
  if (!t || wordCount(t) > MAX_COMMAND_WORDS) return false;
  return END_PATTERNS.some((re) => re.test(t));
}

const MORE_PATTERNS: RegExp[] = [
  /\bnot yet\b/,
  /\bwait\b/,
  /\bhold on\b/,
  /\bhang on\b/,
  /\bone (more|second|moment|minute)\b/,
  /\bmore\b/,
  /\badd\b/,
  /\bi (have|had) more\b/,
  /\bthere'?s more\b/,
  /\banother (thing|point)\b/,
  /\blet me\b/,
  /\bi (want|would like|wanna|need) to (say|add|tell|explain|continue|finish|talk)\b/,
  /\bkeep (going|listening)\b/,
  /\bnot (done|finished|finish)\b/,
  /\bi'?m not (done|finished)\b/,
  /\b(go back|again)\b/,
  /^no\b/,
  /\bno,/,
];

const YES_PATTERNS: RegExp[] = [
  /\b(yes|yeah|yep|yup|yea|sure|okay|ok|alright|fine|correct|right|absolutely|definitely|please)\b/,
  /\b(done|finished|complete|completed)\b/,
  /\bthat('?s| is) (all|it|enough)\b/,
  /\b(next|move on|move to|go ahead|go on|proceed|let'?s go|continue to|carry on)\b/,
];

/**
 * What a short reply means after the coach asked "Are you done?" or "Should we move to the next question?".
 * A long reply that is not a command is more of the answer ("other").
 */
export function confirmIntent(text: string): ConfirmIntent {
  const t = clean(text);
  if (!t) return "other";
  if (endIntent(t)) return "end";
  const short = wordCount(t) <= 10;
  if (!short) return "other";
  // "No problem" and "no worries" are a yes, not a no.
  const s = t.replace(/\bno (problem|worries|issue)\b/g, "yes");
  if (MORE_PATTERNS.some((re) => re.test(s))) return "more";
  if (YES_PATTERNS.some((re) => re.test(s))) return "yes";
  return "other";
}

const NEXT_AT_END: RegExp[] = [
  /\b(next question|next one|next please|move on|move to the next( question)?|go to the next( question)?|go on to the next|skip (this |the )?question|skip it)( please| now)?$/,
  /\b(i'?m|i am|we are|we'?re) (done|finished)( speaking| talking| with (this|my) answer)?$/,
  /\bthat('?s| is) (all|it|enough)( for this question| from me)?$/,
  /\b(nothing more|no more|that is all i have)( to say)?$/,
];

/** True when the student ends what they say with "next question", "that's all" or "I'm done": they want to move on. */
export function nextCommand(text: string): boolean {
  const t = clean(text);
  return !!t && NEXT_AT_END.some((re) => re.test(t));
}

/** The words the student said without the "next question" at the end, which is a command and not part of the answer. */
export function stripNextCommand(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t
      .replace(/[\s,.;!?]*\b(next question|next one|next please|move on|move to the next( question)?|go to the next( question)?|skip (this |the )?question|skip it)( please| now)?[\s.!?]*$/i, "")
      .replace(/[\s,.;!?]*\b(i'?m|i am|we are|we'?re) (done|finished)( speaking| talking| with (this|my) answer)?[\s.!?]*$/i, "")
      .replace(/[\s,.;!?]*\bthat('?s| is) (all|it|enough)( for this question| from me)?[\s.!?]*$/i, "")
      .replace(/[\s,.;!?]*\b(nothing more|no more|that is all i have)( to say)?[\s.!?]*$/i, "")
      .trim();
    if (t === before) break;
  }
  return t;
}

export type Command = "repeat" | "hint" | "hold";

/** A short request to the coach that the app can do itself: say the question again, give a hint, or wait. */
export function commandIntent(text: string): Command | null {
  const t = clean(text);
  if (!t || wordCount(t) > 12) return null;
  if (holdIntent(t)) return "hold";
  if (/\b(repeat|say) (the |that |it |your )?(question|that|it)?( again)?\b/.test(t) && /\b(repeat|again)\b/.test(t)) return "repeat";
  if (/\b(pardon|come again|once more|one more time|sorry what|what was (the|that) question|what is (the|that) question|i did not hear|i didn'?t hear|i couldn'?t hear)\b/.test(t)) return "repeat";
  if (/\b(give me a hint|i need a hint|hint please|can i have a hint|can you give me a hint|help me (with|to) (start|answer)|how do i start)\b/.test(t)) return "hint";
  return null;
}

/** "Wait", "hold on", "let me think": the student wants more time, so the coach must stay quiet and wait. */
export function holdIntent(text: string): boolean {
  const t = clean(text);
  if (!t || wordCount(t) > 9) return false;
  return HOLD_PATTERNS.some((re) => re.test(t));
}

const HOLD_PATTERNS: RegExp[] = [
  /^(sorry )?(wait|hold on|hang on)( a (second|minute|moment|sec|min))?( please)?$/,
  /^(sorry )?((wait|hold on|hang on) )?(let me think|let me think about it|i am thinking|i'?m thinking)( please)?$/,
  /^(sorry )?(one|just a|a) (second|sec|minute|moment|min)( please)?$/,
  /^(sorry )?give me (a )?(second|sec|minute|moment|some time|a little time)( please)?$/,
];

/** Words that a sentence does not end on: the student is probably still thinking of what to say. */
const OPEN_ENDINGS = new Set([
  "and", "but", "because", "so", "or", "then", "like", "um", "umm", "uh", "uhh", "uhm", "hmm", "er", "erm", "aa", "aah", "haa", "that", "which", "who", "when", "if", "the", "a", "an", "to", "of", "in", "on", "with", "for", "is", "are", "was", "were", "my", "your", "our", "their", "also", "as", "at", "by", "from", "about", "i", "we", "they", "it", "he", "she", "have", "has", "had", "can", "will", "would", "should", "could",
]);

/** True when what the student has said so far stops in the middle of a sentence ("... and the", "... because"). */
export function endsUnfinished(text: string): boolean {
  const t = clean(text);
  if (!t) return false;
  const last = t.split(" ").pop() ?? "";
  return OPEN_ENDINGS.has(last);
}

const QUESTION_START =
  /^(what|why|how|when|where|who|which|whose|can you|could you|can i|could i|do you|does|did you|is it|is that|are you|will you|would you|should i|may i|please (tell|explain|repeat|say)|tell me|explain|i have a question|i want to ask|i would like to ask|i don'?t understand|i did not understand|i didn'?t understand|what do you mean)/;

/** True when the student is asking the coach something, not answering. */
export function looksLikeQuestion(text: string): boolean {
  const t = clean(text);
  if (!t || wordCount(t) > 30) return false;
  return QUESTION_START.test(t) || /\?\s*$/.test(text.trim());
}

/** A sentence-length reply that is not a command: the student carried on with their answer. */
export function isContinuation(text: string): boolean {
  const t = clean(text);
  return wordCount(t) >= 6 && confirmIntent(t) === "other";
}
