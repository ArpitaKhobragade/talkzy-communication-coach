import type { Goal } from "../content/types";
import type { CoachingItem, ReadingResult, Report, SpeechMetrics, Turn, VisionMetrics } from "../session/types";
import { cleanSpeech, countWords, findFillers, findRepetitions, paceLabel } from "../speech/metrics";

type Aloud = NonNullable<ReadingResult["aloud"]>;
type Exercise = Report["fallbackExercises"][number];
export type SayItBetter = NonNullable<Report["sayItBetter"]>[number];

/*
 * Everything in this file is worked out from measured values. Nothing here is written by a model.
 * The wording is deliberately simple: short sentences, everyday words, and always "what to do".
 */

/** Short notes shown next to the numbers. They explain what each number means and its limits. */
export function buildSpeechNotes(speech: SpeechMetrics, aloud?: Aloud): string[] {
  const notes: string[] = [];

  if (speech.wpm !== null) {
    notes.push(
      `Speaking speed: about ${speech.wpm} words a minute (${paceLabel(speech.wpm).toLowerCase()}). We work this out from the words the app heard and how long you were speaking.`,
    );
  } else if (speech.voiceTurns === 0) {
    notes.push("Speaking speed could not be measured because your answers were typed, or the microphone did not hear you.");
  } else {
    notes.push("Speaking speed could not be measured because there was not enough speech (we need about 20 seconds and 30 words).");
  }

  if (speech.fillerPer100 !== null) {
    const list = speech.fillers.slice(0, 3).map((f) => `"${f.word}" x${f.count}`).join(", ");
    notes.push(
      speech.fillerCount === 0
        ? "We did not hear filler words (like um, uh, you know). Apps often miss \"um\" and \"uh\", so the real number could be a little higher."
        : `Filler words: ${speech.fillerCount} (${speech.fillerPer100} for every 100 words): ${list}. Apps often miss "um" and "uh", so the real number could be higher.`,
    );
  }

  if (speech.repetitionCount > 0) {
    notes.push(`Repeated words: ${speech.repetitionCount} time${speech.repetitionCount === 1 ? "" : "s"} (for example "${speech.repetitions[0]}").`);
  }

  if (speech.voiceTurns > 0) {
    notes.push(
      speech.pauseCount === 0
        ? "You did not stop for more than 1 second in the middle of an answer."
        : `You stopped for more than 1 second ${speech.pauseCount} time${speech.pauseCount === 1 ? "" : "s"} in the middle of answers. The longest stop was ${speech.longestPauseSec} seconds.`,
    );
    if (speech.avgLatencySec !== null) {
      notes.push(`You took about ${speech.avgLatencySec} seconds to start answering.`);
    }
  }

  if (speech.avgAnswerWords !== null) {
    notes.push(`Your answers were about ${speech.avgAnswerWords} words long on average.`);
  }

  if (speech.lexicalVariety !== null && speech.longWordPct !== null) {
    notes.push(
      `Word variety: ${Math.round(speech.lexicalVariety * 100)} out of every 100 words (in your first 200) were different words. ${speech.longWordPct}% of your words had 7 or more letters. These are simple counts, not a full vocabulary test.`,
    );
  }

  if (aloud) {
    const parts = [`Reading aloud: the app understood ${aloud.accuracyPct}% of the words you read, and you read ${aloud.coveragePct}% of the passage.`];
    if (aloud.wpm !== null) parts.push(`You read about ${aloud.wpm} words a minute.`);
    if (aloud.missedWords.length) {
      parts.push(`Words that were not clear (the app is guessing, this is not a pronunciation mark): ${aloud.missedWords.slice(0, 8).join(", ")}.`);
    }
    notes.push(parts.join(" "));
  }

  return notes;
}

export function buildBodyLanguageNotes(v: VisionMetrics | null): string[] {
  if (!v || v.framesAnalyzed < 10) return [];
  const notes: string[] = [];
  notes.push(`Your face was in the camera picture ${v.facePresentPct}% of the time (${v.framesAnalyzed} pictures checked).`);
  if (v.cameraFacingPct !== null) {
    notes.push(`Your head was turned toward the camera about ${v.cameraFacingPct}% of the time. Looking at the screen counts as facing the camera.`);
  }
  if (v.uprightPct !== null && v.shoulderTiltDeg !== null) {
    notes.push(`Your shoulders were fairly level (${v.shoulderTiltDeg} degrees tilt on average), and you sat upright about ${v.uprightPct}% of the time.`);
  } else if (v.bodyVisiblePct < 30) {
    notes.push("The camera rarely saw your shoulders, so we could not check how you sat. Sit a little further back next time.");
  }
  if (v.handsVisiblePct !== null && v.movementLevel) {
    notes.push(`Your hands were in view about ${v.handsVisiblePct}% of the time. Your body movement was ${v.movementLevel}.`);
  }
  if (v.facialMovementLevel) {
    notes.push(`Your face movement was ${v.facialMovementLevel}. This measures how much your face changed on camera.`);
  }
  notes.push("These are only things the camera can see. They say nothing about how you feel or how sure you are, because a camera cannot tell that.");
  return notes;
}

const item = (kind: CoachingItem["kind"], topic: string, observation: string, why?: string, howTo?: string): CoachingItem => ({
  kind,
  topic,
  observation,
  why,
  howTo,
});

/** How the student did while reading, from the reading results only. */
export function buildReadingCoaching(reading: ReadingResult, passageWords: number): CoachingItem[] {
  const out: CoachingItem[] = [];
  const a = reading.aloud;

  if (a) {
    if (a.accuracyPct >= 90 && a.missedWords.length >= 3) {
      // A high percentage can still hide a few skipped words. Say so instead of praising the reading.
      out.push(
        item(
          "improve",
          "Words to practise",
          `The app understood ${a.accuracyPct}% of the words you read, but these were not clear: ${a.missedWords.slice(0, 6).join(", ")}.`,
          "Skipped or changed words can change what the sentence means.",
          "Say each of these words slowly three times, then read the passage again.",
        ),
      );
    } else if (a.accuracyPct >= 90) {
      out.push(item("good", "How clear you were", `The app understood ${a.accuracyPct}% of the words you read.`));
    } else if (a.accuracyPct >= 75) {
      out.push(
        item(
          "improve",
          "How clear you were",
          `The app understood ${a.accuracyPct}% of the words you read. A few words were not clear.`,
          "When the ends of words are clear, people can follow you more easily.",
          "Read a little slower and say the end of each word. Say the words listed below three times, then read the passage again.",
        ),
      );
    } else {
      out.push(
        item(
          "improve",
          "How clear you were",
          `The app understood only ${a.accuracyPct}% of the words you read.`,
          "This can happen when the room is noisy, the microphone is far away, or words are said too fast. We cannot tell which one it was.",
          "Sit close to the microphone in a quiet room. Read slowly and open your mouth well. Then read the first paragraph again.",
        ),
      );
    }
    if (a.coveragePct < 80) {
      out.push(
        item(
          "improve",
          "How much you read",
          `You read about ${a.coveragePct}% of the passage out loud.`,
          "The talk with your coach uses ideas from the whole passage.",
          "Read all the way to the end before you start the talk, even if you read slowly.",
        ),
      );
    }
    if (a.wpm !== null) {
      if (a.wpm > 170) {
        out.push(item("improve", "Your speed", `You read fast: about ${a.wpm} words a minute.`, "When we read fast, words blur together.", "Take a breath at every full stop. Try for about 130 to 150 words a minute."));
      } else if (a.wpm < 90) {
        out.push(item("improve", "Your speed", `You read slowly: about ${a.wpm} words a minute.`, "Very slow reading sounds broken into small pieces.", "Look ahead to the end of the sentence, then read the whole sentence in one breath."));
      } else {
        out.push(item("good", "Your speed", `About ${a.wpm} words a minute. That is a good speed for reading out loud.`));
      }
    }
    if (a.missedWords.length) {
      out.push(
        item(
          "info",
          "Words to practise",
          `These words were not clear: ${a.missedWords.slice(0, 8).join(", ")}.`,
          "The app is only guessing here. This is not a mark for your pronunciation.",
          "Say each word slowly three times. Then say it inside a sentence.",
        ),
      );
    }
    return out;
  }

  const sec = Math.round(reading.durationSec);
  const wpm = sec > 0 && passageWords > 0 ? Math.round(passageWords / (sec / 60)) : null;
  out.push(
    item(
      "info",
      "Reading out loud",
      `You read silently for ${sec} seconds, so reading accuracy and speed could not be measured.`,
      undefined,
      "Next time, press \"Start reading\" and read the passage out loud. Then we can tell you how clear you were.",
    ),
  );
  if (wpm !== null && sec >= 5) {
    if (wpm > 450) {
      out.push(item("improve", "Reading time", `You finished the passage in about ${sec} seconds. That is very fast (about ${wpm} words a minute).`, "When we read too fast, we miss the ideas we need for the talk.", "Read it once slowly. Then pick the two most important ideas before you start the talk."));
    } else if (wpm < 100) {
      out.push(item("info", "Reading time", `You took your time with the passage (about ${wpm} words a minute). That is fine for careful reading.`, undefined, "Underline the key words so you can use them in your answers."));
    }
  }
  return out;
}

/** How the student did while answering, from the speech numbers only. */
export function buildAnswerCoaching(s: SpeechMetrics): CoachingItem[] {
  const out: CoachingItem[] = [];

  if (s.avgAnswerWords !== null) {
    if (s.avgAnswerWords < 20) {
      out.push(
        item(
          "improve",
          "Answer length",
          `Your answers were short: about ${s.avgAnswerWords} words each.`,
          "A short answer does not show how well you think. It also gives the coach less to ask about.",
          "Use three steps: say your main idea, give one reason, then give one real example. Try for three or four sentences.",
        ),
      );
    } else if (s.avgAnswerWords < 35) {
      out.push(item("info", "Answer length", `Your answers were about ${s.avgAnswerWords} words each. That is a good start.`, undefined, "Add one real example to each answer. Examples make your answer easy to remember."));
    } else {
      out.push(item("good", "Answer length", `You gave full answers: about ${s.avgAnswerWords} words each.`));
    }
  }

  if (s.voiceTurns === 0) {
    out.push(item("info", "Speaking", "Your answers were typed, so we could not check your speed, stops or thinking time.", undefined, "Try answering with your voice next time. Then we can tell you how you sound."));
  } else {
    if (s.wpm !== null) {
      if (s.wpm > 165) {
        out.push(item("improve", "Your speed", `You spoke fast: about ${s.wpm} words a minute.`, "The listener needs a moment to understand each idea.", "Finish one sentence, take a breath, then start the next. Try for 120 to 150 words a minute."));
      } else if (s.wpm < 95) {
        out.push(item("improve", "Your speed", `You spoke slowly: about ${s.wpm} words a minute.`, "Very slow talking can sound unsure, and the listener may lose the idea.", "Plan your first few words, then keep going. Read aloud a little faster each day for practice."));
      } else {
        out.push(item("good", "Your speed", `About ${s.wpm} words a minute. That is a good speed for talking.`));
      }
    }
    if (s.pauseCount >= s.voiceTurns * 2) {
      out.push(
        item(
          "improve",
          "Stopping in the middle",
          `You stopped for more than 1 second ${s.pauseCount} times. The longest stop was ${s.longestPauseSec} seconds.`,
          "Many long stops make it hard to follow your idea.",
          "Before you speak, take 5 seconds to choose your first sentence. If you need time, say \"let me think\" instead of staying quiet.",
        ),
      );
    } else if (s.longestPauseSec >= 4) {
      out.push(item("info", "Stopping in the middle", `Your longest stop was ${s.longestPauseSec} seconds.`, undefined, "Short stops to think are fine. For a longer stop, say \"let me think about that\" so the listener waits with you."));
    }
    if (s.avgLatencySec !== null && s.avgLatencySec >= 5) {
      out.push(item("improve", "Starting your answer", `You took about ${s.avgLatencySec} seconds to start answering.`, "A long wait can make the talk feel stuck.", "Start with a small opener like \"I think...\" or \"One example is...\" while you get your ideas ready."));
    }
  }

  if (s.fillerPer100 !== null) {
    if (s.fillerPer100 >= 4) {
      out.push(
        item(
          "improve",
          "Filler words",
          `You used many filler words: ${s.fillerCount} (${s.fillerPer100} for every 100 words)${s.fillers[0] ? `, mostly "${s.fillers[0].word}"` : ""}.`,
          "Fillers hide your good ideas. The real number may be even higher, because apps often miss \"um\" and \"uh\".",
          "When you feel a filler coming, stay quiet for one second instead. To practise, talk for one minute and notice each filler.",
        ),
      );
    } else if (s.fillerPer100 >= 2) {
      out.push(item("info", "Filler words", `You used a few filler words (${s.fillerPer100} for every 100 words).`, undefined, "Try to stay quiet for a second instead of saying a filler."));
    } else {
      out.push(item("good", "Filler words", "You used very few filler words. Well done."));
    }
  }

  if (s.repetitionCount >= 3) {
    out.push(item("improve", "Repeated words", `You repeated words or phrases ${s.repetitionCount} times (for example "${s.repetitions[0]}").`, "We repeat words when the next idea is not ready yet.", "Stay quiet until the next words are ready. Do not start the sentence again."));
  }

  if (s.lexicalVariety !== null) {
    if (s.lexicalVariety < 0.45) {
      out.push(item("improve", "Using different words", `You used the same words again and again (${Math.round(s.lexicalVariety * 100)} out of 100 were different).`, "Different, exact words make you sound clear and strong.", "Before you answer, pick two key words from the passage and use both."));
    } else if (s.lexicalVariety >= 0.6 && (s.avgAnswerWords ?? 0) >= 18) {
      // Short answers always look varied, so variety is only praised when the answers were long enough to show it.
      out.push(item("good", "Using different words", "You used many different words. That makes your speech interesting."));
    }
  }
  return out;
}

const trimTo = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30))}...`;
};

/**
 * "Instead of this, say it like this", worked out from the student's own words (no AI):
 * 1) the same sentence without fillers and repeats, 2) a short answer with a simple frame to grow it.
 */
export function buildSayItBetter(turns: Turn[]): SayItBetter[] {
  const answers = turns.filter((t) => t.role === "student" && t.text.trim() && countWords(t.text) >= 3);
  const out: SayItBetter[] = [];

  const cleanable = answers
    .map((t) => {
      const removed = findFillers(t.text).reduce((n, f) => n + f.count, 0) + findRepetitions(t.text).length;
      return { t, removed };
    })
    .filter((x) => x.removed > 0)
    .sort((a, b) => b.removed - a.removed)
    .slice(0, 2);
  for (const { t } of cleanable) {
    const said = trimTo(t.text, 220);
    const better = cleanSpeech(said);
    if (better && better !== said) {
      out.push({
        said,
        better,
        why: "Same idea, but without the extra words (like um, basically, or repeated words). It sounds smoother and more sure.",
        source: "rule",
      });
    }
  }

  const shortest = [...answers].sort((a, b) => countWords(a.text) - countWords(b.text)).find((t) => countWords(t.text) < 20);
  if (shortest && !out.some((o) => o.said === trimTo(shortest.text, 220))) {
    const said = trimTo(shortest.text, 220);
    const start = cleanSpeech(said).replace(/[.!?]+$/, "");
    out.push({
      said,
      better: `${start}, because [give one reason]. For example, [give one real example].`,
      why: "A longer answer shows how you think. Say your idea, then a reason, then an example. Fill in the two spaces with your own words.",
      source: "rule",
    });
  }
  return out.slice(0, 3);
}

/**
 * What the camera could see, and what to change. It only talks about where your face and body were.
 * It never says anything about feelings, how sure you are, or whether you are telling the truth.
 */
export function buildBodyLanguageCoaching(v: VisionMetrics | null): CoachingItem[] {
  if (!v || v.framesAnalyzed < 10) return [];
  const out: CoachingItem[] = [];

  if (v.facePresentPct < 70) {
    out.push(
      item(
        "improve",
        "Your face in the picture",
        `Your face was out of view for ${Math.round(100 - v.facePresentPct)}% of the time.`,
        "When your face leaves the picture, the listener loses eye contact with you.",
        "Sit so your whole face stays in the picture. Put a light in front of you (not behind you) and the camera at eye level.",
      ),
    );
  } else {
    out.push(item("good", "Your face in the picture", `Your face stayed in the picture ${v.facePresentPct}% of the time.`));
  }

  if (v.cameraFacingPct !== null) {
    if (v.cameraFacingPct >= 75) {
      out.push(item("good", "Looking at the camera", `You faced the camera about ${v.cameraFacingPct}% of the time. This helps the listener feel you are talking to them.`));
    } else {
      out.push(
        item(
          "improve",
          "Looking at the camera",
          `Your head was turned away from the camera about ${Math.round(100 - v.cameraFacingPct)}% of the time. (We can see which way your head points. We cannot see exactly where your eyes look.)`,
          "When you face the person you talk to, they feel you are speaking to them.",
          "Put your notes or the question close to the camera, so looking at them still faces the camera. Look at the camera lens when you start and finish each point.",
        ),
      );
    }
  }
  if (v.avgHeadPitchDeg !== null && v.avgHeadPitchDeg >= 15) {
    out.push(item("improve", "Head up and down", `Your head was tilted up or down by about ${Math.round(v.avgHeadPitchDeg)} degrees on average.`, "Looking down at a low screen hides your face and can hurt your neck.", "Raise your laptop or camera to eye level so you can look straight ahead."));
  }
  if (v.avgHeadYawDeg !== null && v.avgHeadYawDeg >= 20) {
    out.push(item("improve", "Head turned to the side", `Your head was turned to the side by about ${Math.round(v.avgHeadYawDeg)} degrees on average.`, undefined, "Sit straight in front of the screen and the camera, not at an angle."));
  }

  if (v.facialMovementLevel === "low") {
    out.push(
      item(
        "improve",
        "Your face while talking",
        "Your face did not move much while you spoke. (This only measures how much your face changed on camera. It says nothing about how you feel.)",
        "A face that moves a little, like a smile or raised eyebrows, helps people follow your ideas and feel welcome.",
        "Smile when you say hello and goodbye. Let your eyebrows go up when you say something important. Practise one answer in front of a mirror.",
      ),
    );
  } else if (v.facialMovementLevel === "moderate") {
    out.push(item("good", "Your face while talking", "Your face moved in a natural way while you spoke."));
  } else if (v.facialMovementLevel === "high") {
    out.push(item("info", "Your face while talking", "Your face moved a lot. That is normal, because your mouth moves when you talk.", undefined, "Keep it natural. When the coach is asking a question, keep your face calm and listen."));
  }

  if (v.uprightPct !== null) {
    if (v.uprightPct >= 75) {
      out.push(item("good", "How you sat", `You sat upright and balanced about ${v.uprightPct}% of the time.`));
    } else {
      const tilt = v.shoulderTiltDeg !== null && v.shoulderTiltDeg >= 8 ? ` Your shoulders were tilted by about ${Math.round(v.shoulderTiltDeg)} degrees on average.` : "";
      out.push(
        item(
          "improve",
          "How you sat",
          `You sat upright and balanced only ${v.uprightPct}% of the time.${tilt}`,
          "Sitting tall helps your voice come out clearly, and you look steady on camera.",
          "Sit tall with both feet flat on the floor. Relax your shoulders and keep them level. Sit in the middle of the picture and do not lean to one side.",
        ),
      );
    }
  } else if (v.bodyVisiblePct < 30) {
    out.push(item("info", "How you sat", "Your shoulders were rarely in view, so we could not check how you sat.", undefined, "Move your chair back a little so your head and both shoulders fit in the picture."));
  }

  if (v.movementLevel === "high") {
    out.push(item("improve", "Your body and hands", "You moved a lot during the session.", "A lot of movement can pull attention away from what you say.", "Rest your hands on the desk between gestures. Keep your body still while you make a point."));
  } else if (v.movementLevel === "low" && v.handsVisiblePct !== null && v.handsVisiblePct < 15) {
    out.push(item("info", "Your body and hands", "Your hands were hardly seen, and you stayed very still.", "Small hand movements can help people follow your ideas.", "Try one or two small hand movements when you explain an example. Keep your hands inside the picture."));
  } else if (v.movementLevel === "moderate") {
    out.push(item("good", "Your body and hands", "Your body movement looked natural."));
  }
  return out;
}

export function buildFallbackExercises(speech: SpeechMetrics, goal: Goal): Exercise[] {
  const out: Exercise[] = [];
  if (speech.fillerPer100 !== null && speech.fillerPer100 >= 3) {
    out.push({
      title: "Stay quiet instead of saying a filler",
      minutes: 3,
      instructions: "Pick a topic you like and talk for one minute. When you feel a filler word coming, close your mouth and stay quiet for one second. Record yourself on your phone and listen to the difference.",
    });
  }
  if (speech.wpm !== null && speech.wpm > 160) {
    out.push({ title: "Slow reading", minutes: 3, instructions: "Read one paragraph out loud. Stop at every full stop and count slowly to two. Keep a calm, steady speed." });
  } else if (speech.wpm !== null && speech.wpm < 100) {
    out.push({ title: "Warm-up reading", minutes: 3, instructions: "Read a short paragraph out loud three times. Read a little faster each time, but keep every word clear." });
  }
  if (speech.avgAnswerWords !== null && speech.avgAnswerWords < 25) {
    out.push({ title: "Idea, reason, example", minutes: 4, instructions: "Answer a question in three sentences: your main idea, one reason, and one real example. Do this for three different questions." });
  }
  if (speech.pauseCount >= 4) {
    out.push({ title: "Plan, then speak", minutes: 3, instructions: "Before you answer, take five seconds to choose your first sentence and one example. Then speak for 30 seconds without stopping." });
  }
  if (goal === "vocabulary") {
    out.push({ title: "Key word challenge", minutes: 3, instructions: "Pick three key words from today's passage. Use each one in a sentence about your own life." });
  }
  if (out.length < 2) {
    out.push({ title: "One-minute talk", minutes: 3, instructions: "Pick any idea from today's passage and talk about it for one full minute without stopping. Then think of one thing to do better." });
  }
  if (out.length < 2) {
    out.push({ title: "Teach it to a friend", minutes: 4, instructions: "Explain the main idea of today's passage to a friend or family member in your own words. Ask them what was clear and what was confusing." });
  }
  return out.slice(0, 4);
}
