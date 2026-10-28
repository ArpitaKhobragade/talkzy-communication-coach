/*
 * Wrong words and wrong word forms in what a student said, found with rules. Every rule is a mistake that
 * students in India often make when they speak, and each one is written so that it hardly ever flags a
 * correct sentence. The AI report finds more; these rules work on their own, with no internet, and the same
 * words always give the same result.
 */

export interface WordMistake {
  /** The student's own words. */
  said: string;
  /** The same words, said correctly. */
  better: string;
  /** Why, in one short sentence of simple English. */
  why: string;
}

interface Rule {
  re: RegExp;
  to: string | ((substring: string, ...groups: string[]) => string);
  why: string;
}

const PAST_TO_BASE: Record<string, string> = {
  went: "go", came: "come", saw: "see", took: "take", gave: "give", ate: "eat", wrote: "write", knew: "know",
  made: "make", said: "say", did: "do", got: "get", found: "find", told: "tell", thought: "think", bought: "buy",
  brought: "bring", spoke: "speak", began: "begin", ran: "run", read: "read", had: "have", felt: "feel", met: "meet",
};

const ING_TO_BASE: Record<string, string> = {
  knowing: "know", understanding: "understand", liking: "like", loving: "love", wanting: "want", needing: "need",
  believing: "believe", remembering: "remember", hating: "hate", preferring: "prefer",
};

/** The verb for he or she: go becomes goes, study becomes studies, like becomes likes. */
function thirdPerson(verb: string): string {
  if (verb === "go") return "goes";
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

const MODALS_AND_HELPERS = "can|could|will|would|should|must|may|might|did|does|do|let|to|not|didn't|doesn't|don't|cannot|can't|won't|make|makes|made|help|helps|see|saw|hear|heard|watch|if|that";

const RULES: Rule[] = [
  { re: /\bI am agree\b/gi, to: "I agree", why: "\"Agree\" is already a verb, so do not put \"am\" before it." },
  { re: /\b(he|she|it) (don't|do not)\b/gi, to: (_m, who, neg) => `${who} ${neg.toLowerCase() === "don't" ? "doesn't" : "does not"}`, why: "With he, she and it, use \"doesn't\"." },
  { re: /\b(I|we|you|they) (doesn't|does not)\b/gi, to: (_m, who, neg) => `${who} ${neg.toLowerCase() === "doesn't" ? "don't" : "do not"}`, why: "With I, we, you and they, use \"don't\"." },
  { re: /\bmore (better|easier|faster|bigger|cheaper|smaller|stronger|clearer|simpler|harder|happier|nicer)\b/gi, to: "$1", why: "\"-er\" already means \"more\", so do not say both." },
  { re: /\bmost (best|easiest|biggest|cheapest|smallest|strongest)\b/gi, to: "$1", why: "\"-est\" already means \"most\", so do not say both." },
  { re: /\bdiscuss about\b/gi, to: "discuss", why: "\"Discuss\" already means \"talk about\"." },
  { re: /\bexplain me\b/gi, to: "explain to me", why: "After \"explain\", use \"to\" before the person." },
  { re: /\b(return|revert|reply) back\b/gi, to: "$1", why: "\"Back\" is not needed here; the word already has that meaning." },
  { re: /\bcousin (brother|sister)\b/gi, to: "cousin", why: "\"Cousin\" alone is correct; it is the child of an uncle or aunt." },
  {
    re: /\bI am having (a |an |some |two |three )?(doubts?|questions?|problems?|car|phone|brother|sister|fever|headache|cough|cold)\b/gi,
    to: (_m, art = "", noun) => `I have ${art}${noun}`,
    why: "Use \"have\" (not \"am having\") for things you own or feel.",
  },
  { re: /\bsince (\d+|two|three|four|five|six|seven|eight|nine|ten) (years?|months?|weeks?|days?|hours?)\b/gi, to: "for $1 $2", why: "Use \"for\" with a length of time. \"Since\" is for a starting point, such as \"since 2020\"." },
  { re: /\bfrom last (\d+|two|three|four|five|six|seven|eight|nine|ten) (years?|months?|weeks?|days?)\b/gi, to: "for the last $1 $2", why: "Say \"for the last\" with a length of time." },
  {
    re: /\b(didn't|did not|doesn't|does not|don't|do not|can't|cannot|couldn't|won't|wouldn't|shouldn't) (went|came|saw|took|gave|ate|wrote|knew|made|said|did|got|found|told|thought|bought|brought|spoke|began|ran|felt|met)\b/gi,
    to: (_m, neg, past) => `${neg} ${PAST_TO_BASE[past.toLowerCase()] ?? past}`,
    why: "After \"didn't\" or \"can't\", use the base form of the verb, not the past form.",
  },
  { re: /\b(doesn't|does not) (like|want|know|need|have|play|go|speak|work|study|live|think|say|feel)s\b/gi, to: "$1 $2", why: "After \"doesn't\", the verb has no \"s\"." },
  { re: /\bpeoples\b/gi, to: "people", why: "\"People\" is already plural." },
  { re: /\binformations\b/gi, to: "information", why: "\"Information\" has no plural." },
  { re: /\badvices\b/gi, to: "advice", why: "\"Advice\" has no plural." },
  { re: /\bknowledges\b/gi, to: "knowledge", why: "\"Knowledge\" has no plural." },
  { re: /\bequipments\b/gi, to: "equipment", why: "\"Equipment\" has no plural." },
  { re: /\bfurnitures\b/gi, to: "furniture", why: "\"Furniture\" has no plural." },
  { re: /\bhomeworks\b/gi, to: "homework", why: "\"Homework\" has no plural." },
  { re: /\bluggages\b/gi, to: "luggage", why: "\"Luggage\" has no plural." },
  {
    re: /\bI am (knowing|understanding|liking|loving|wanting|needing|believing|remembering|hating|preferring)\b/gi,
    to: (_m, ing) => `I ${ING_TO_BASE[ing.toLowerCase()] ?? ing}`,
    why: "Verbs of knowing, liking and wanting are not used with \"am ...ing\".",
  },
  { re: /\b(they|we|you|I) has\b/gi, to: (_m, who) => `${who} have`, why: "With I, you, we and they, use \"have\"." },
  { re: new RegExp(`(?<!\\b(?:${MODALS_AND_HELPERS})\\s)\\b(he|she|it) have\\b`, "gi"), to: (_m, who) => `${who} has`, why: "With he, she and it, use \"has\"." },
  {
    re: new RegExp(`(?<!\\b(?:${MODALS_AND_HELPERS})\\s)\\b(he|she) (go|want|like|need|know|think|say|make|take|give|get|play|work|study|live|speak|help|feel|come|love)\\b(?!\\w)`, "gi"),
    to: (_m, who, verb) => `${who} ${thirdPerson(verb.toLowerCase())}`,
    why: "With he and she, the verb needs an \"s\" (he goes, she likes).",
  },
  { re: /(^|[.!?]\s+)Myself\s+([A-Z][a-z]+)/g, to: (_m, start, name) => `${start}My name is ${name}`, why: "To say your name, use \"My name is ...\"." },
  { re: /\byour good name\b/gi, to: "your name", why: "Just say \"your name\" when you ask someone." },
  { re: /\b(very|so) much (good|nice|beautiful|easy|difficult|tall|big|small)\b/gi, to: "very $2", why: "Say \"very\" before an adjective, not \"very much\"." },
  { re: /\b(years?|months?) experience\b/gi, to: "$1 of experience", why: "Say \"years of experience\"." },
  { re: /(?<!\ba )\bfew (water|time|money|information|rice|milk|help|food)\b/gi, to: "little $1", why: "Use \"little\" for things you cannot count." },
  { re: /\bless (students|friends|books|things|cars|mistakes)\b/gi, to: "fewer $1", why: "Use \"fewer\" for things you can count." },
  { re: /\b(go|goes|went|going|come|comes|came|coming|reach|reached|reaching) to home\b/gi, to: "$1 home", why: "Say \"go home\", with no \"to\"." },
  { re: /\bangry on\b/gi, to: "angry with", why: "You are angry with a person." },
  { re: /\bgood in (english|maths?|science|studies|drawing|singing|sports?|cricket|speaking)\b/gi, to: "good at $1", why: "Say \"good at\" a subject or skill." },
  { re: /\bproud for\b/gi, to: "proud of", why: "You are proud of something." },
  { re: /\bsuffering with\b/gi, to: "suffering from", why: "Say \"suffering from\" a problem." },
  { re: /\b(should|must|can|could|will|would|may|might) to ([a-z]+)\b/gi, to: "$1 $2", why: "After \"can\", \"should\" and similar words, do not use \"to\"." },
  {
    re: /\b(I|we) (will |am going to |have to |had to |did |must |can )?give (the |an |my |our |a )?(exams?|tests?)\b/gi,
    to: (_m, who, aux = "", art = "", noun) => `${who} ${aux}take ${art}${noun}`,
    why: "A student takes (or writes) an exam. The teacher gives it.",
  },
];

/** A student said \"a\" before a vowel sound, or \"an\" before a consonant sound. */
const A_BEFORE_VOWEL = /\ba ([aeiou][a-z]*)\b/gi;
const SOUNDS_LIKE_CONSONANT = /^(uni|use|usu|usa|ura|eu|one|once|ewe|euro)/i;
const NOT_A_WORD = /^(um+|uh+|uhm|er+m?|erm|ah+|aa+h?|haa+|hmm+)$/i;

/** The same text with every wrong word or form put right. */
export function applyWordFixes(text: string): string {
  let out = text;
  for (const m of findWordMistakes(text, 20)) {
    out = out.split(m.said).join(m.better);
  }
  return out;
}

/** The mistakes found in one answer, at most `max`, without repeats. */
export function findWordMistakes(text: string, max = 6): WordMistake[] {
  const out: WordMistake[] = [];
  const seen = new Set<string>();
  const add = (said: string, better: string, why: string) => {
    const key = said.toLowerCase();
    if (seen.has(key) || said.trim().toLowerCase() === better.trim().toLowerCase()) return;
    seen.add(key);
    out.push({ said: said.trim(), better: better.trim(), why });
  };

  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const said = m[0];
      const single = new RegExp(rule.re.source, rule.re.flags.replace("g", ""));
      const better = said.replace(single, rule.to as string);
      add(said, better, rule.why);
    }
  }

  for (const m of text.matchAll(A_BEFORE_VOWEL)) {
    if (SOUNDS_LIKE_CONSONANT.test(m[1]) || NOT_A_WORD.test(m[1])) continue;
    add(m[0], `an ${m[1]}`, "Use \"an\" before a vowel sound (an apple, an hour).");
  }

  return out.slice(0, max);
}
