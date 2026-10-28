"use client";

import {
  ArrowCounterClockwise,
  CheckCircle,
  DotsThreeOutline,
  Keyboard,
  Lightbulb,
  Microphone,
  PaperPlaneRight,
  Pause,
  SignOut,
  SkipForward,
  SpeakerHigh,
  Timer,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Notice, PhaseSteps } from "@/components/ui";
import { devCoachReply, openingMessage } from "@/features/coach/dev-coach";
import { DIFFICULTY_LABEL, difficultyOfQuestion, questionNumberAfter } from "@/features/coach/ladder";
import type { Goal, LearningModule } from "@/features/content/types";
import { commandIntent, confirmIntent, endIntent, endsUnfinished, isContinuation, looksLikeQuestion, nextCommand, stripNextCommand } from "@/features/practice/intents";
import type { CoachTurnRequest, CoachTurnResponse, Profile, Settings, Turn } from "@/features/session/types";
import type { CaptureFatal, CaptureResult, TurnCaptureLike } from "@/features/speech/capture";
import { createCapture, fallbackEngine, pickEngine, type EngineKind } from "@/features/speech/engine";
import { watchForInterruption } from "@/features/speech/energy-barge";
import { recognitionSupported } from "@/features/speech/recognition";
import { prefetchSpeech, speakCoach } from "@/features/speech/speaker";
import { stopSpeaking, ttsSupported, type SpeakHandle } from "@/features/speech/synthesis";
import type { VadSession } from "@/features/speech/vad-session";
import { newId } from "@/services/storage";
import { requestCoachTurn } from "@/services/coach-api";
import type { CoachMode } from "@/services/use-coach-mode";

/*
 * When the student has stopped for a moment with words on the screen, the coach asks "Are you done?". "Yes" (or "done", "next")
 * moves on to the next question; "no", or more words, carries the same answer on. The "Next question" button (or the words "next
 * question") does the same at any time. The coach's next reply is prepared while she asks, so it starts at once after a "yes".
 */
/** After this much quiet, the coach asks whether the answer is finished. */
const DONE_CHECK_MS = 2200;
/** After a very short answer the coach waits longer: the student may still be thinking of what to add. */
const DONE_CHECK_SHORT_MS = 4000;
const SHORT_ANSWER_WORDS = 8;
/** When the last words stop in the middle of a sentence ("and the", "because", "umm") the student is still thinking. */
const DONE_CHECK_OPEN_MS = 6000;
/** The student asked for time ("wait", "let me think"), so the coach keeps quiet for longer. */
const DONE_CHECK_PATIENT_MS = 9000;
/** An answer with this many words counts as finished even if the student does not reply to "Are you done?". */
const ENOUGH_WORDS = 12;
/** After the student replies to "Are you done?", this much quiet means the reply is complete. */
const REPLY_IDLE_MS = 900;
/** A plain "yes" or "no" is acted on after this much quiet, without waiting for the accurate transcript. */
const QUICK_REPLY_IDLE_MS = 450;
/** No reply at all to "Are you done?" for this long: a full answer is taken as finished. */
const CONFIRM_WAIT_MS = 7000;
/** A spoken question to the coach (it ends with a question mark) is answered after this much quiet. */
const QUESTION_WAIT_MS = 1800;
/** The same when the words only look like a question, without a question mark: wait longer, the student may be mid-answer. */
const QUESTION_WAIT_PLAIN_MS = 3500;
/** A spoken command ("repeat the question", "wait", "give me a hint") is done after this much quiet. */
const COMMAND_WAIT_MS = 800;
/** After this much quiet with words on the screen, the "Next question" button is pointed out. */
const NUDGE_MS = 3500;
/** Nothing heard for this long: the coach gently offers help. */
const SILENCE_MS = 14_000;
/** The same, after the student asked for time to think. */
const PATIENT_SILENCE_MS = 35_000;
/** Safety cap for a single spoken answer: after this long, and a moment of quiet, the answer is sent. */
const MAX_ANSWER_MS = 180_000;
/** After this many silent prompts in a row, wait for the student to press a button. */
const MAX_SILENCES = 3;
/** Interrupting the coach: speech must be clear (probability) and last this many frames (about half a second). */
const BARGE_PROB = 0.85;
const BARGE_FRAMES = 16;
/** The coach's first moments are never interrupted, so a breath or a click cannot cut it off. */
const BARGE_AFTER_MS = 900;

type Status = "starting" | "coach" | "listening" | "confirming" | "thinking" | "paused";

const FATAL_TEXT: Record<CaptureFatal, string> = {
  "not-allowed": "Voice is blocked in this browser. Allow the microphone from the lock icon in the address bar, then press \"Try voice again\". You can also type.",
  "no-device": "No microphone was found. You can type your answers instead.",
  network: "The voice connection was interrupted. Press \"Try voice again\" to keep speaking, or type your answer.",
  unsupported: "This browser can't recognise speech. Try Chrome or Edge for voice, or type your answers.",
  unknown: "The voice connection was interrupted. Press \"Try voice again\" to keep speaking, or type your answer.",
  "cloud-stt": "The voice connection was interrupted. Press \"Try voice again\" to keep speaking, or type your answer.",
  vad: "Voice detection could not start. Press \"Try voice again\", or type your answer.",
};

/** An answer the student has spoken so far. It can grow if they say they want to add more. */
interface PendingAnswer {
  text: string;
  speakingSec: number;
  pauseCount: number;
  longestPauseSec: number;
  latencySec?: number;
  lowConfidence?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What the coach says when the student ends the session. */
export const GOODBYE = "Okay, we will end the session now and generate your report based on this conversation.";
const ASK_DONE = "Are you done?";
/** The second time the coach asks, after the student said "no" and carried on. */
const ASK_NEXT = "Are you done now?";
const ASK_AGAIN = "Sorry, I did not catch that. Are you done?";
/** What the coach says when the student answers "no" to "Are you done?". */
const SAY_CONTINUE = "Okay, please continue.";

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

interface Props {
  module: LearningModule;
  profile: Profile;
  goal: Goal;
  settings: Settings;
  stream: MediaStream | null;
  /** Silero VAD, present when cloud speech-to-text (Sarvam) is configured and loaded. */
  vad: VadSession | null;
  /** Which voice speaks the coach's words. */
  ttsKind: "cartesia" | "browser";
  coachMode: CoachMode;
  /** Epoch ms when the session's time budget ends. */
  deadline: number;
  onFinish: (r: { turns: Turn[]; degraded: boolean }) => void;
}

export function ConversationPhase({ module, profile, goal, settings, stream, vad, ttsKind, coachMode, deadline, onFinish }: Props) {
  const inputs = { stream, vad };
  const initialEngine = pickEngine(inputs);
  const voiceCapable = initialEngine !== "none";
  const canSpeak = settings.coachVoice && (ttsKind === "cartesia" || ttsSupported());

  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>("starting");
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [voiceOk, setVoiceOk] = useState(voiceCapable);
  const [typing, setTyping] = useState(!voiceCapable);
  const [typed, setTyped] = useState("");
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.round((deadline - Date.now()) / 1000)));
  const [confirmEnd, setConfirmEnd] = useState(false);
  /** The student has been quiet for a moment with words on the screen: the "Next question" button is pointed out. */
  const [nudge, setNudge] = useState(false);
  const [closingMessage, setClosingMessage] = useState(false);

  const run = useRef(0);
  const turnsRef = useRef<Turn[]>([]);
  const capture = useRef<TurnCaptureLike | null>(null);
  const engine = useRef<EngineKind>(initialEngine);
  const inputsRef = useRef({ stream, vad });
  const speech = useRef<SpeakHandle | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);
  const finished = useRef(false);
  /** The goodbye line is still being spoken when this screen goes away, so it must not be cut off. */
  const keepSpeaking = useRef(false);
  const timeUp = useRef(false);
  /** True while the coach's current message is the closing one. */
  const closing = useRef(false);
  const silences = useRef(0);
  const turnStartedAt = useRef(0);
  const coachEndedAt = useRef(0);
  const degradedRef = useRef(false);
  const voiceOkRef = useRef(voiceCapable);
  const cloudFailed = useRef(false);
  const levelBar = useRef<HTMLDivElement | null>(null);
  const lastLevelDraw = useRef(0);
  const statusRef = useRef<Status>("starting");
  const settingsRef = useRef(settings);
  const typedRef = useRef("");
  const interimRef = useRef("");
  const pending = useRef<PendingAnswer | null>(null);
  const bargeRun = useRef(0);
  const voiceNoted = useRef(false);
  /** The place in the module's seven questions of the next question to ask (the opening question is 0 and is asked first). */
  const ladder = useRef(1);
  /** True after the student asked for time ("wait", "let me think"): the coach waits longer and says nothing. */
  const patient = useRef(false);
  /** How many times the coach asked "Are you done?" for the answer being built, and how many replies could not be understood. */
  const confirmAsks = useRef(0);
  const unclearReplies = useRef(0);
  /** The coach's reply to the answer so far, asked for while she checks whether the student is done. Used if the answer does not change. */
  const spec = useRef<{ text: string; promise: Promise<CoachTurnResponse> } | null>(null);
  /** Stops the loudness watcher that hears the student speaking over the coach. */
  const energyStop = useRef<(() => void) | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    typedRef.current = typed;
  }, [typed]);
  // The accurate voice detector can finish loading after the conversation has started. Later turns use it.
  useEffect(() => {
    inputsRef.current = { stream, vad };
  }, [stream, vad]);

  const setStatusBoth = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  const stopPoll = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };

  const addTurn = (t: Omit<Turn, "id" | "at">) => {
    const turn: Turn = { ...t, id: newId(), at: Date.now() };
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
    return turn;
  };

  const showInterim = (text: string) => {
    interimRef.current = text;
    setInterim(text);
  };

  const abortCapture = () => {
    stopPoll();
    capture.current?.dispose();
    capture.current = null;
    showInterim("");
    setNudge(false);
  };

  /** `goodbye`: the student ended the session, so the coach says that the report is being made (it keeps talking over the report screen). */
  const finish = (goodbye = false) => {
    if (finished.current) return;
    finished.current = true;
    spec.current = null;
    stopPoll();
    speech.current?.cancel();
    stopSpeaking();
    capture.current?.dispose();
    capture.current = null;
    const result = { turns: turnsRef.current, degraded: degradedRef.current };
    if (goodbye) {
      // The coach says that the report is being made, in her own voice (made ahead of time, so it starts at once), and the words
      // are on the screen. Only when she has finished (or after 2.5 s at least, so the words can be read even when there is no
      // sound) does the screen change to the progress bar.
      setConfirmEnd(false);
      setNudge(false);
      setStatusBoth("coach");
      setPrompt(GOODBYE);
      let said: Promise<void> = Promise.resolve();
      if (canSpeak) {
        keepSpeaking.current = true;
        const h = speakCoach(GOODBYE, speakOptions());
        speech.current = h;
        said = Promise.race([h.done, sleep(12_000)]);
      }
      void Promise.all([said, sleep(2500)]).then(() => {
        speech.current = null;
        onFinish(result);
      });
      return;
    }
    onFinish(result);
  };

  // ---- The coach's side ---------------------------------------------------------------------

  /** Said once if the coach's voice cannot be used: no other voice takes over, the words stay on the screen, and the student is told why. */
  function noteVoiceFallback(reason?: string) {
    if (voiceNoted.current) return;
    voiceNoted.current = true;
    setVoiceNote(`The coach's voice is not working right now, so her words are shown as text only. ${reason ?? "The voice service did not answer."}`);
  }

  function speakOptions() {
    return {
      rate: settingsRef.current.speechRate,
      lang: settingsRef.current.speechLang,
      cloud: ttsKind === "cartesia",
      onFallback: noteVoiceFallback,
    };
  }

  /** The coach says a short line that is not part of the lesson, so it is not saved in the transcript. */
  async function speakAside(text: string, myRun: number): Promise<boolean> {
    setPrompt(text);
    if (canSpeak) {
      // Short lines such as "Take your time" use the same voice as the questions, so the coach always sounds like one person.
      const h = speakCoach(text, speakOptions());
      speech.current = h;
      await h.done;
      speech.current = null;
    } else {
      await sleep(500);
    }
    return myRun === run.current && !finished.current;
  }

  /** The request for the coach's next message. `answerText` is an answer that is not saved as a turn yet (used to prepare the reply early). */
  function coachRequest(event: CoachTurnRequest["event"], answerText?: string): CoachTurnRequest {
    const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const all: { role: Turn["role"]; text: string }[] = turnsRef.current.map((t) => ({ role: t.role, text: t.text }));
    if (answerText) all.push({ role: "student", text: answerText });
    return {
      moduleId: module.id,
      goal,
      level: module.level,
      ageBand: profile.ageBand,
      remainingSec: secondsLeft,
      // Shorter history: the coach only needs the recent exchanges, and the AI service allows few tokens a minute on its free plan.
      history: all.slice(-14).map((t) => ({ role: t.role, text: t.text.slice(0, 800) })),
      event,
      ladderIndex: ladder.current,
    };
  }

  /**
   * While the coach asks "Are you done?", her reply to the answer so far is already asked for (and its voice made), so that after a
   * "yes" she answers at once. If the student adds more words, this is simply not used.
   */
  function prepareReply() {
    const p = pending.current;
    if (!p?.text || looksLikeQuestion(p.text) || spec.current?.text === p.text) return;
    if (deadline - Date.now() < 20_000) return; // a closing message is not prepared ahead
    const promise = requestCoachTurn(coachRequest("answer", p.text)).then((res) => {
      if (canSpeak && ttsKind === "cartesia" && !res.wrapUp) prefetchSpeech(res.text, { rate: settingsRef.current.speechRate, cloud: true });
      return res;
    });
    promise.catch(() => undefined);
    spec.current = { text: p.text, promise };
  }

  /** The prepared reply, if the answer that was just saved is the one it was prepared for. */
  function takePreparedReply(): Promise<CoachTurnResponse> | null {
    const s = spec.current;
    spec.current = null;
    const last = turnsRef.current[turnsRef.current.length - 1];
    return s && last?.role === "student" && last.text === s.text ? s.promise : null;
  }

  async function askCoach(event: CoachTurnRequest["event"], myRun: number) {
    setStatusBoth("thinking");
    setPrompt(null);
    const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const req = coachRequest(event);
    const prepared = event === "answer" ? takePreparedReply() : null;
    let reply: { text: string; wrapUp: boolean };
    try {
      const res = prepared ? await prepared.catch(() => requestCoachTurn(req)) : await requestCoachTurn(req);
      if (coachMode === "live" && (res.mode === "dev" || res.degraded)) degradedRef.current = true;
      reply = { text: res.text, wrapUp: res.wrapUp };
    } catch {
      degradedRef.current = true;
      const local = devCoachReply(req);
      reply = { text: local.text, wrapUp: local.wrapUp };
      setNotice("We could not reach the coach service, so a simple scripted question was used instead.");
    }
    if (myRun !== run.current) return;
    busy.current = false;
    // An answer, or a skipped question, moves the lesson on to the next of the seven questions.
    // A question from the student, silence and unclear speech do not.
    if (event === "answer" || event === "skip") ladder.current += 1;
    void coachSay(reply.text, reply.wrapUp || secondsLeft <= 0, myRun);
  }

  async function coachSay(text: string, wrapUp: boolean, myRun: number) {
    if (myRun !== run.current || finished.current) return;
    closing.current = wrapUp;
    setClosingMessage(wrapUp);
    addTurn({ role: "coach", text });
    setStatusBoth("coach");
    setPrompt(null);
    let watching = false;
    if (canSpeak) {
      // While the coach talks, the student can speak over it: the coach stops and listens.
      if (!wrapUp) watching = startBargeIn(myRun);
      const h = speakCoach(text, speakOptions());
      speech.current = h;
      // The goodbye and "Are you done?" are made while the coach talks, so they start at once when they are needed.
      if (ttsKind === "cartesia") {
        const o = { rate: settingsRef.current.speechRate, cloud: true };
        prefetchSpeech(ASK_DONE, o);
        prefetchSpeech(ASK_NEXT, o);
        prefetchSpeech(SAY_CONTINUE, o);
        prefetchSpeech(GOODBYE, o);
      }
      await h.done;
      speech.current = null;
    } else {
      await sleep(600);
    }
    if (watching) await stopBargeIn(myRun);
    if (myRun !== run.current || finished.current) return;
    if (wrapUp || timeUp.current) finish();
    else listen(myRun);
  }

  // ---- Interrupting the coach ---------------------------------------------------------------

  /** Starts listening for the student speaking over the coach. Returns false when that is not possible. */
  function startBargeIn(myRun: number): boolean {
    if (!settingsRef.current.bargeIn || !voiceOkRef.current) return false;
    const v = inputsRef.current.vad;
    if (!v || engine.current !== "cloud") {
      // Without the accurate voice detector, the loudness of the microphone tells when the student speaks over the coach.
      const stream = inputsRef.current.stream;
      if (!stream || engine.current === "none") return false;
      bargeRun.current = myRun;
      energyStop.current = watchForInterruption(stream, () => interrupt(myRun));
      return true;
    }
    bargeRun.current = myRun;
    const t0 = performance.now();
    let frames = 0;
    v.setListener({
      onSpeechStart: () => undefined,
      onSegment: () => undefined,
      onLevel: (p) => {
        if (bargeRun.current !== myRun) return;
        if (performance.now() - t0 < BARGE_AFTER_MS) {
          frames = 0;
          return;
        }
        frames = p > BARGE_PROB ? frames + 1 : 0;
        if (frames >= BARGE_FRAMES) interrupt(myRun);
      },
    });
    void v.start().catch(() => {
      if (bargeRun.current === myRun) bargeRun.current = 0;
    });
    return true;
  }

  /** Stops watching for an interruption once the coach has finished. Does nothing if the student already interrupted. */
  async function stopBargeIn(myRun: number) {
    if (bargeRun.current !== myRun) return;
    bargeRun.current = 0;
    stopEnergyWatch();
    const v = inputsRef.current.vad;
    if (!v) return;
    v.setListener(null);
    await v.pause().catch(() => undefined);
  }

  function stopEnergyWatch() {
    energyStop.current?.();
    energyStop.current = null;
  }

  /** The student started talking over the coach: stop the coach at once and listen. */
  function interrupt(myRun: number) {
    if (bargeRun.current !== myRun || (statusRef.current !== "coach" && statusRef.current !== "confirming") || closing.current || finished.current) return;
    bargeRun.current = 0;
    stopEnergyWatch();
    const next = ++run.current;
    speech.current?.cancel();
    speech.current = null;
    stopSpeaking();
    setPrompt(null);
    listen(next);
  }

  // ---- The student's side -------------------------------------------------------------------

  /** Joins what was just said to the answer so far. */
  function addToPending(text: string, res?: CaptureResult) {
    const prev = pending.current;
    const t = res?.timing;
    pending.current = prev
      ? {
          ...prev,
          text: `${prev.text} ${text}`.trim(),
          speakingSec: prev.speakingSec + (t?.speakingSec ?? 0),
          pauseCount: prev.pauseCount + (t?.pauseCount ?? 0) + 1,
          longestPauseSec: Math.max(prev.longestPauseSec, t?.longestPauseSec ?? 0),
        }
      : {
          text,
          speakingSec: t?.speakingSec ?? 0,
          pauseCount: t?.pauseCount ?? 0,
          longestPauseSec: t?.longestPauseSec ?? 0,
          latencySec: t?.latencySec ?? undefined,
          lowConfidence: res && res.confidence !== null && res.confidence < 0.6 ? true : undefined,
        };
  }

  /** Sends the whole answer to the coach. `asAnswer` is true when the student ended it themselves ("Next question"), so it is never taken as a question to the coach. */
  function submitPending(myRun: number, asAnswer = false) {
    const p = pending.current;
    pending.current = null;
    patient.current = false;
    confirmAsks.current = 0;
    unclearReplies.current = 0;
    abortCapture();
    setPrompt(null);
    if (!p || !p.text) {
      busy.current = true;
      void askCoach("unclear", myRun);
      return;
    }
    // A question or a request to the coach is answered first; it does not count as the answer to the lesson question.
    const asking = !asAnswer && looksLikeQuestion(p.text);
    addTurn({
      role: "student",
      text: p.text,
      inputMode: "voice",
      speakingSec: p.speakingSec,
      pauseCount: p.pauseCount,
      longestPauseSec: p.longestPauseSec,
      latencySec: p.latencySec,
      lowConfidence: p.lowConfidence,
    });
    silences.current = 0;
    setNotice(null);
    busy.current = true;
    void askCoach(asking ? "ask" : "answer", myRun);
  }

  /** The student asked for time ("wait", "let me think"). The coach says nothing and just listens, and waits longer before asking. */
  function holdOn(myRun: number) {
    patient.current = true;
    abortCapture();
    setStatusBoth("listening");
    listen(myRun);
  }

  /**
   * The student's answer is finished (they tapped "Next question", said it, or asked the coach something). What they said is
   * checked for a command, and then sent to the coach.
   */
  async function endOfSpeech(myRun: number, fromButton = false) {
    const c = capture.current;
    if (!c || busy.current) return;
    busy.current = true;
    stopPoll();
    const res = await c.end();
    if (myRun !== run.current) return;
    c.dispose();
    capture.current = null;
    showInterim("");
    setNudge(false);

    const text = res.text.trim();
    if (text && endIntent(text)) {
      endBySpeech();
      return;
    }
    // "Repeat the question", "give me a hint" and "wait" are done at once.
    const command = commandIntent(text);
    if (command === "hold") {
      busy.current = false;
      void holdOn(myRun);
      return;
    }
    if (command && !pending.current) {
      busy.current = false;
      if (command === "repeat") repeatQuestion();
      else needHint();
      return;
    }
    if (!text) {
      // Nothing new could be made out. What they said earlier is the answer: with the button it is sent, otherwise the coach asks.
      if (pending.current) {
        if (fromButton) submitPending(myRun, true);
        else void confirmTurn(myRun);
      } else if (fromButton) skipQuestion(myRun);
      else void askCoach("unclear", myRun);
      return;
    }
    // "...next question" at the end is a command, not a part of the answer.
    const answer = nextCommand(text) ? stripNextCommand(text) : text;
    if (answer) addToPending(answer, res);
    if (!pending.current) {
      skipQuestion(myRun);
      return;
    }
    const direct = fromButton || nextCommand(text);
    // A question to the coach is answered on its own. Otherwise the coach asks whether the answer is finished.
    if (direct || looksLikeQuestion(text)) submitPending(myRun, direct);
    else void confirmTurn(myRun);
  }

  /** The student has stopped: the coach asks "Are you done?" and listens for the reply. */
  async function confirmTurn(myRun: number) {
    busy.current = false;
    setStatusBoth("confirming");
    confirmAsks.current += 1;
    prepareReply();
    if (!canSpeak) {
      // No voice to ask with: the screen asks, and the student answers with the button or by voice.
      setPrompt(ASK_DONE);
      listenForReply(myRun);
      return;
    }
    // If the student starts talking over the question, it stops and they carry on with their answer.
    const watching = startBargeIn(myRun);
    const ok = await speakAside(confirmAsks.current === 1 ? ASK_DONE : ASK_NEXT, myRun);
    if (watching) await stopBargeIn(myRun);
    if (!ok || statusRef.current !== "confirming") return;
    listenForReply(myRun);
  }

  /** Listens for the short reply to "Are you done?". */
  function listenForReply(myRun: number) {
    if (!voiceOkRef.current || engine.current === "none") {
      // Typed answers use the buttons; without a button press, it is treated as no reply after a few seconds.
      setTimeout(() => {
        if (myRun === run.current && statusRef.current === "confirming" && !busy.current && !capture.current) noReply(myRun);
      }, 2500);
      return;
    }
    abortCapture();
    // The browser's recogniser answers a short "yes" or "no" almost at once, so it is used for replies when it is there.
    const kind: EngineKind = inputsRef.current.stream && recognitionSupported() ? "browser" : engine.current;
    const c = createCapture(kind, inputsRef.current, module.id, {
      lang: settingsRef.current.speechLang,
      reply: true,
      onInterim: (t) => showInterim(t),
      onFatal: () => {
        // Cannot hear a reply: the buttons still work, and after a few seconds it is treated as no reply.
        abortCapture();
        setTimeout(() => {
          if (myRun === run.current && statusRef.current === "confirming" && !busy.current && !capture.current) noReply(myRun);
        }, 2500);
      },
      onLevel: (lvl) => {
        const now = performance.now();
        if (now - lastLevelDraw.current > 80 && levelBar.current) {
          lastLevelDraw.current = now;
          levelBar.current.style.transform = `scaleX(${Math.max(0.03, lvl)})`;
        }
      },
    });
    if (!c) return;
    capture.current = c;
    c.begin();
    const t0 = Date.now();
    poll.current = setInterval(() => {
      const cur = capture.current;
      if (!cur || busy.current || statusRef.current !== "confirming") return;
      const said = interimRef.current.replace(/\s*\.\.\.$/, "").trim();
      if (said) {
        // A plain "yes", "no" or "end the session" is acted on as soon as it is heard, without waiting for the accurate transcript.
        const quick = wordCount(said) <= 4 ? confirmIntent(said) : "other";
        if (quick !== "other" && cur.idleMs() > QUICK_REPLY_IDLE_MS) {
          stopPoll();
          abortCapture();
          void decide(quick, said, undefined, myRun);
        } else if (!cur.isBusy() && cur.idleMs() > REPLY_IDLE_MS) void settleReply(myRun);
      } else if (!cur.isBusy() && Date.now() - t0 > CONFIRM_WAIT_MS) noReply(myRun);
    }, 150);
  }

  /** The student did not reply to "Are you done?". A full answer is taken as finished. A short one is probably not: the coach waits for more, quietly. */
  function noReply(myRun: number) {
    stopPoll();
    abortCapture();
    const enough = wordCount(pending.current?.text ?? "") >= ENOUGH_WORDS || confirmAsks.current >= 2;
    if (enough) void decide("yes", "", undefined, myRun);
    else {
      // The coach says nothing more: she just listens for the rest of the answer.
      setPrompt(null);
      listen(myRun);
    }
  }

  async function settleReply(myRun: number) {
    const c = capture.current;
    if (!c || busy.current) return;
    busy.current = true;
    stopPoll();
    const res = await c.end();
    if (myRun !== run.current) return;
    c.dispose();
    capture.current = null;
    showInterim("");
    busy.current = false;
    const text = res.text.trim();
    void decide(confirmIntent(text), text, res, myRun);
  }

  /** Acts on the student's reply to "Are you done?". */
  async function decide(kind: ReturnType<typeof confirmIntent>, text: string, res: CaptureResult | undefined, myRun: number) {
    if (myRun !== run.current || finished.current) return;
    abortCapture();
    if (kind === "end") return endBySpeech();
    if (kind === "yes") return submitPending(myRun, true);
    if (kind === "more") {
      // "No, I am not done": the coach says "Okay, please continue." and then listens. If the student carries on speaking
      // over it, she stops at once and listens.
      patient.current = true;
      if (canSpeak) {
        const watching = startBargeIn(myRun);
        const ok = await speakAside(SAY_CONTINUE, myRun);
        if (watching) await stopBargeIn(myRun);
        if (!ok) return;
      }
      setPrompt(null);
      listen(myRun);
      return;
    }
    // "Wait" or "let me think": the coach stays quiet and gives the student time.
    if (text && commandIntent(text) === "hold") return holdOn(myRun);
    // A question to the coach is answered at once.
    if (text && looksLikeQuestion(text)) {
      addToPending(text, res);
      return submitPending(myRun);
    }
    // Anything longer that is not a command is more of the answer: it is kept, and the coach listens on.
    if (text && isContinuation(text)) {
      addToPending(text, res);
      listen(myRun);
      return;
    }
    unclearReplies.current += 1;
    if (unclearReplies.current >= 2) return submitPending(myRun, true);
    setStatusBoth("confirming");
    if (!(await speakAside(ASK_AGAIN, myRun))) return;
    listenForReply(myRun);
  }

  /** The student said "next question" without answering: the coach moves on to the next question. */
  function skipQuestion(myRun: number) {
    abortCapture();
    setPrompt(null);
    busy.current = true;
    void askCoach("skip", myRun);
  }

  /** The "Next question" button (or the words "next question"): the answer so far is sent and the coach moves on. */
  async function nextQuestion() {
    if (finished.current || busy.current) return;
    if (statusRef.current === "confirming") {
      // Pressing the button is a "yes" to "Are you done?".
      const next = ++run.current;
      speech.current?.cancel();
      speech.current = null;
      stopSpeaking();
      if (bargeRun.current) void stopBargeIn(bargeRun.current);
      stopPoll();
      if (pending.current) submitPending(next, true);
      else skipQuestion(next);
      return;
    }
    if (statusRef.current !== "listening" && statusRef.current !== "paused") return;
    if (typedRef.current.trim()) {
      submitTyped();
      return;
    }
    const myRun = run.current;
    if (!capture.current) {
      // Nothing is being listened to (typing only, or voice paused): move on with what was said before, or skip.
      if (pending.current) submitPending(myRun, true);
      else skipQuestion(myRun);
      return;
    }
    await endOfSpeech(myRun, true);
  }

  /** The student said they want to end the session. It ends at once, without another question. */
  function endBySpeech() {
    if (finished.current) return;
    run.current++;
    const p = pending.current;
    pending.current = null;
    abortCapture();
    if (p?.text) addTurn({ role: "student", text: p.text, inputMode: "voice", speakingSec: p.speakingSec, pauseCount: p.pauseCount, longestPauseSec: p.longestPauseSec, latencySec: p.latencySec });
    finish(true);
  }

  function handleSilence(myRun: number) {
    if (busy.current) return;
    busy.current = true;
    abortCapture();
    silences.current += 1;
    if (silences.current >= MAX_SILENCES) {
      busy.current = false;
      setStatusBoth("paused");
      setNotice("No problem, take your time. Press the button when you are ready, or type your answer.");
      setTyping(true);
      return;
    }
    if (silences.current === 1) {
      // The first quiet moment: the coach says nothing and keeps listening. The student is probably just thinking.
      busy.current = false;
      listen(myRun);
      return;
    }
    void askCoach("silence", myRun);
  }

  /** How long the student must be quiet before the coach asks "Are you done?". */
  function doneCheckDelay(said: string): number {
    if (patient.current) return DONE_CHECK_PATIENT_MS;
    if (said && endsUnfinished(said)) return DONE_CHECK_OPEN_MS;
    const total = wordCount(pending.current?.text ?? "") + wordCount(said);
    return total < SHORT_ANSWER_WORDS ? DONE_CHECK_SHORT_MS : DONE_CHECK_MS;
  }

  function listen(myRun: number) {
    if (myRun !== run.current || finished.current) return;
    busy.current = false;
    coachEndedAt.current = Date.now();
    turnStartedAt.current = Date.now();
    setStatusBoth("listening");
    if (!voiceOkRef.current || engine.current === "none") return; // typed answers only

    // The accurate voice detector may have finished loading since the last turn.
    if (engine.current === "browser" && inputsRef.current.vad && !cloudFailed.current) engine.current = "cloud";
    abortCapture();
    const c = createCapture(engine.current, inputsRef.current, module.id, {
      lang: settingsRef.current.speechLang,
      onInterim: (t) => showInterim(t),
      onFatal: (reason) => {
        abortCapture();
        // Cloud recognition trouble: switch to the browser's recogniser and carry on speaking.
        if (reason === "cloud-stt" || reason === "vad") cloudFailed.current = true;
        const next = reason === "cloud-stt" || reason === "vad" ? fallbackEngine(engine.current, inputsRef.current) : "none";
        if (next !== "none") {
          engine.current = next;
          setNotice("The voice service had trouble, so your browser's voice recognition is being used instead. Keep speaking.");
          setTimeout(() => listen(myRun), 400);
          return;
        }
        // Otherwise keep voice available: the student can retry, or type.
        voiceOkRef.current = false;
        setVoiceOk(false);
        setTyping(true);
        setNotice(FATAL_TEXT[reason]);
      },
      onLevel: (lvl) => {
        const now = performance.now();
        if (now - lastLevelDraw.current > 80 && levelBar.current) {
          lastLevelDraw.current = now;
          levelBar.current.style.transform = `scaleX(${Math.max(0.03, lvl)})`;
        }
      },
    });
    if (!c) return;
    capture.current = c;
    c.begin();

    poll.current = setInterval(() => {
      const cur = capture.current;
      if (!cur || busy.current || statusRef.current !== "listening") return;
      const sinceTurn = Date.now() - turnStartedAt.current;
      const said = interimRef.current.replace(/\s*\.\.\.$/, "");
      const idle = cur.idleMs();
      const settled = !cur.isBusy();

      // The student said they want to end the session while talking: do it as soon as they pause.
      if (said && endIntent(said) && idle > 700) {
        endBySpeech();
        return;
      }
      // "...next question" or "that's all" at the end: the answer is finished, so move on as soon as they stop.
      if (said && nextCommand(said) && idle > 700 && settled) {
        void endOfSpeech(myRun, true);
        return;
      }
      // "Wait", "repeat the question" or "give me a hint" on their own: done at once, so there is no long delay.
      if (said && commandIntent(said) && idle > COMMAND_WAIT_MS && settled) {
        void endOfSpeech(myRun);
        return;
      }
      // A question to the coach is answered on its own. One that ends with a question mark is clear; without it, wait longer.
      if (said && looksLikeQuestion(said) && settled && idle > (/\?\s*$/.test(said) ? QUESTION_WAIT_MS : QUESTION_WAIT_PLAIN_MS)) {
        void endOfSpeech(myRun);
        return;
      }

      if (cur.hasText() || pending.current) {
        // The student has words (now, or earlier in this answer). After a moment of quiet, the coach asks "Are you done?".
        setNudge(settled && idle > NUDGE_MS);
        if (settled && idle > doneCheckDelay(said)) {
          void endOfSpeech(myRun);
          return;
        }
        if (sinceTurn > MAX_ANSWER_MS && settled && idle > 1500) void endOfSpeech(myRun, true);
      } else if (cur.isBusy()) {
        // Speech was heard and is being transcribed: wait for the result.
      } else if (idle > (patient.current ? PATIENT_SILENCE_MS : SILENCE_MS)) {
        // They said something earlier and then went quiet: keep waiting, the buttons are there. Otherwise gently offer help.
        if (!pending.current) handleSilence(myRun);
      } else if (sinceTurn > 30_000) {
        // Sound was detected but nothing could be recognised.
        busy.current = true;
        abortCapture();
        void askCoach("unclear", myRun);
      }
    }, 250);
  }

  // ---- Lifecycle ------------------------------------------------------------------------------

  useEffect(() => {
    const myRun = ++run.current;
    finished.current = false;
    timeUp.current = false;
    busy.current = false;
    silences.current = 0;
    degradedRef.current = false;
    pending.current = null;
    // State is overwritten by the next addTurn(), so no reset is needed if React re-runs this effect.
    turnsRef.current = [];
    void coachSay(openingMessage(module.id, profile.displayName), false, myRun);
    return () => {
      // Invalidate every in-flight async chain from this mount (a counter, not a DOM node).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      run.current++;
      stopPoll();
      speech.current?.cancel();
      if (!keepSpeaking.current) stopSpeaking();
      capture.current?.dispose();
      capture.current = null;
      energyStop.current?.();
      energyStop.current = null;
      const v = inputsRef.current.vad;
      if (v && bargeRun.current) {
        bargeRun.current = 0;
        v.setListener(null);
      }
    };
    // Runs once per mount; the opening message must not repeat when settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left > 0 || timeUp.current) return;
      timeUp.current = true;
      const st = statusRef.current;
      if (st === "listening" || st === "paused" || st === "confirming") {
        if (pending.current && st === "confirming") submitPending(run.current, true);
        else if (capture.current?.hasText()) void endOfSpeech(run.current, true);
        else if (pending.current) submitPending(run.current);
        else if (typedRef.current.trim()) submitTyped();
        else finish();
      }
      // While the coach is speaking or thinking, coachSay() finishes the session afterwards.
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  // ---- Buttons --------------------------------------------------------------------------------

  /** End the session from the button. Whatever the student was saying right now is kept, not thrown away. */
  async function endNow() {
    const c = capture.current;
    if (c && !finished.current && !busy.current && statusRef.current === "listening" && c.hasText()) {
      busy.current = true;
      stopPoll();
      const res = await c.end();
      if (res.text) addToPending(res.text, res);
    }
    const p = pending.current;
    pending.current = null;
    if (p?.text) addTurn({ role: "student", text: p.text, inputMode: "voice", speakingSec: p.speakingSec, pauseCount: p.pauseCount, longestPauseSec: p.longestPauseSec, latencySec: p.latencySec });
    finish(true);
  }

  /** Stop the coach's audio now and move on (to the student's turn, or to the end if closing). */
  function skipSpeech() {
    if (statusRef.current !== "coach") return;
    if (finished.current) {
      // The goodbye is playing: skipping it goes straight to the progress screen.
      speech.current?.cancel();
      return;
    }
    const myRun = ++run.current;
    speech.current?.cancel();
    speech.current = null;
    stopSpeaking();
    if (bargeRun.current) void stopBargeIn(bargeRun.current);
    if (closing.current || timeUp.current) finish();
    else listen(myRun);
  }

  function submitTyped() {
    const text = typedRef.current.trim();
    if (finished.current || !text || busy.current || statusRef.current === "thinking" || statusRef.current === "starting") return;
    if (endIntent(text)) {
      endBySpeech();
      return;
    }
    if (statusRef.current === "coach" || statusRef.current === "confirming") {
      // Typing interrupts the coach's audio.
      if (closing.current) return;
      run.current++;
      speech.current?.cancel();
      speech.current = null;
      stopSpeaking();
    }
    busy.current = true;
    pending.current = null;
    abortCapture();
    setPrompt(null);
    addTurn({ role: "student", text: text.slice(0, 2000), inputMode: "typed" });
    showInterim("");
    setTyped("");
    silences.current = 0;
    setNotice(null);
    void askCoach("answer", run.current);
  }

  function repeatQuestion() {
    const last = [...turnsRef.current].reverse().find((t) => t.role === "coach");
    if (!last || busy.current || finished.current) return;
    busy.current = true;
    const myRun = ++run.current;
    speech.current?.cancel();
    abortCapture();
    setStatusBoth("coach");
    setNotice(null);
    setPrompt(null);
    (async () => {
      if (canSpeak) {
        const h = speakCoach(last.text, speakOptions());
        speech.current = h;
        await h.done;
        speech.current = null;
      }
      if (myRun === run.current) listen(myRun);
    })();
  }

  function needHint() {
    if (busy.current || finished.current) return;
    busy.current = true;
    const myRun = ++run.current;
    speech.current?.cancel();
    abortCapture();
    stopSpeaking();
    void askCoach("silence", myRun);
  }

  function resumeFromPause() {
    silences.current = 0;
    setNotice(null);
    listen(++run.current);
  }

  /** After a voice problem: switch voice back on and start listening again. */
  function tryVoiceAgain() {
    if (busy.current && statusRef.current === "thinking") return;
    engine.current = pickEngine(inputsRef.current);
    cloudFailed.current = false;
    voiceOkRef.current = engine.current !== "none";
    setVoiceOk(voiceOkRef.current);
    setNotice(engine.current === "none" ? "Voice is not available in this browser. Please type your answer." : null);
    silences.current = 0;
    if (statusRef.current === "coach" || statusRef.current === "starting") return; // it will listen after the coach
    listen(++run.current);
  }

  const mm = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const lastCoach = [...turns].reverse().find((t) => t.role === "coach");
  const label: Record<Status, string> = {
    starting: "Getting ready...",
    coach: "Coach is speaking",
    listening: voiceOk ? "Your turn: speak now" : "Your turn: type your answer",
    thinking: "Coach is thinking...",
    confirming: voiceOk ? "Are you done? Say yes or no" : "Are you done?",
    paused: "Take your time",
  };
  const live = status === "listening" || status === "confirming";
  const orbColor = status === "listening" ? "bg-good" : status === "coach" || status === "confirming" ? "bg-accent" : "bg-muted";
  const studentCount = turns.filter((t) => t.role === "student").length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-32">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur md:mx-0 md:px-0">
        <div className="w-full">
          <PhaseSteps current={2} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Phase 2 of 2: Conversation</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-bold tabular-nums" role="timer" aria-label={`Time left ${mm}`}>
            <Timer size={16} weight="bold" aria-hidden />
            {mm} left
          </p>
          {!confirmEnd ? (
            <Button variant="secondary" className="min-h-10 px-4" icon={<SignOut size={16} aria-hidden />} onClick={() => setConfirmEnd(true)}>
              End session
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2">
              <span className="text-sm font-semibold">End now and get your feedback?</span>
              <Button variant="danger" className="min-h-10 px-4" onClick={() => void endNow()}>
                Yes, end
              </Button>
              <Button variant="secondary" className="min-h-10 px-4" onClick={() => setConfirmEnd(false)}>
                Keep going
              </Button>
            </div>
          )}
        </div>
        {/* The buttons stay at the top, where they can always be reached, even while the page is scrolled. */}
        <div className="flex w-full flex-wrap gap-2.5" data-testid="conversation-actions">
          {(status === "listening" || status === "paused" || status === "confirming") && (
            <Button
              size="lg"
              className={`w-full sm:w-auto ${nudge ? "animate-pulse ring-4 ring-good/40" : ""}`}
              icon={<CheckCircle size={20} weight="fill" aria-hidden />}
              onClick={() => void nextQuestion()}
            >
              Next question
            </Button>
          )}
          {status === "paused" && (
            <Button size="lg" variant="secondary" onClick={resumeFromPause}>
              I&apos;m ready, listen again
            </Button>
          )}
          {status === "coach" && (
            <Button variant="secondary" icon={<SkipForward size={18} aria-hidden />} onClick={skipSpeech}>
              Skip audio
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<ArrowCounterClockwise size={18} aria-hidden />}
            onClick={repeatQuestion}
            disabled={status === "thinking" || status === "starting"}
          >
            Repeat the question
          </Button>
          <Button
            variant="secondary"
            icon={<Lightbulb size={18} aria-hidden />}
            onClick={needHint}
            disabled={status === "thinking" || status === "starting" || status === "coach"}
          >
            I need a hint
          </Button>
          <Button variant="secondary" icon={<Keyboard size={18} aria-hidden />} onClick={() => setTyping((v) => !v)} aria-expanded={typing}>
            {typing ? "Hide typing" : "Type instead"}
          </Button>
        </div>
      </div>

      {notice && (
        <Notice tone="warn" role="alert">
          {notice}
        </Notice>
      )}
      {voiceNote && (
        <Notice tone="accent" role="status">
          {voiceNote}
        </Notice>
      )}
      {voiceCapable && !voiceOk && (
        <Notice tone="accent" role="status">
          <div className="flex flex-wrap items-center gap-3">
            <span>Voice answers are paused. You can type below, or switch voice back on.</span>
            <Button className="min-h-10 px-4" onClick={tryVoiceAgain}>
              Try voice again
            </Button>
          </div>
        </Notice>
      )}
      {!voiceCapable && (
        <Notice tone="accent" role="status">
          {stream
            ? "This browser can't recognise speech, so you can type your answers. Chrome or Edge supports voice."
            : "The microphone is off, so you can type your answers."}
        </Notice>
      )}
      {settings.coachVoice && ttsKind !== "cartesia" && !ttsSupported() && (
        <Notice tone="accent" role="status">
          This browser cannot speak aloud, so read the coach&apos;s messages on screen.
        </Notice>
      )}

      <div className="rounded-card border border-line bg-surface p-6 text-center shadow-card md:p-9">
        <div className="mx-auto grid h-28 w-28 place-items-center">
          <span className={`relative grid h-20 w-20 place-items-center rounded-full ${orbColor} text-white shadow-lift`} aria-hidden>
            {(status === "coach" || status === "listening" || status === "confirming") && (
              <>
                <span className={`orb-ring absolute -inset-2 rounded-full ${orbColor}`} />
                <span className={`orb-ring orb-ring-2 absolute -inset-5 rounded-full ${orbColor}`} />
              </>
            )}
            <span className="relative">
              {status === "listening" || status === "confirming" ? (
                <Microphone size={34} weight="fill" />
              ) : status === "coach" ? (
                <SpeakerHigh size={34} weight="fill" />
              ) : status === "paused" ? (
                <Pause size={34} weight="fill" />
              ) : (
                <DotsThreeOutline size={34} weight="fill" />
              )}
            </span>
          </span>
        </div>
        <p
          className={`mx-auto mt-3 inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${
            status === "listening" ? "bg-good-soft text-good" : status === "coach" || status === "confirming" ? "bg-accent-soft text-accent-ink" : "bg-paper text-muted"
          }`}
          role="status"
        >
          {label[status]}
        </p>
        {(status === "coach" || status === "listening") && !closingMessage && (
          <p className="mx-auto mt-2 text-xs font-extrabold uppercase tracking-wide text-muted" data-testid="question-level">
            Question {questionNumberAfter(studentCount)}: {DIFFICULTY_LABEL[difficultyOfQuestion(questionNumberAfter(studentCount))]}
          </p>
        )}
        <p
          className="mx-auto mt-5 max-w-2xl text-[1.3rem] font-bold leading-snug tracking-tight md:text-[1.75rem] md:font-extrabold"
          aria-live="polite"
          data-testid="coach-message"
        >
          {lastCoach?.text ?? ""}
        </p>
        {prompt && (
          <p className="mx-auto mt-4 max-w-xl rounded-2xl bg-accent-soft px-4 py-2.5 text-[1.05rem] font-bold text-accent-ink" data-testid="coach-prompt" role="status">
            {prompt}
          </p>
        )}

        {live && voiceOk && (
          <div className="mx-auto mt-6 max-w-lg text-left">
            <div className="flex items-center gap-2.5" aria-hidden>
              <Microphone size={16} weight="fill" className="shrink-0 text-good" />
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
                <div ref={levelBar} className="h-full origin-left rounded-full bg-good transition-transform" style={{ transform: "scaleX(0.03)" }} />
              </div>
            </div>
            <p className="mt-3 min-h-14 rounded-[1.6rem_1.6rem_0.4rem_1.6rem] bg-ink px-5 py-3.5 text-[1.02rem] leading-relaxed text-paper" data-testid="live-transcript">
              {interim || <span className="text-paper/70">Listening for your voice...</span>}
            </p>
            <p className="mt-2 text-sm font-semibold text-muted" data-testid="next-hint">
              {status === "confirming"
                ? "Say yes if you are done, or no to add more. You can also tap Next question."
                : nudge
                  ? "Finished? Tap Next question."
                  : "Say your answer. When you stop, the coach asks if you are done. You can also tap Next question."}
            </p>
          </div>
        )}
      </div>

      {typing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
          className="space-y-2"
        >
          <label htmlFor="typed-answer" className="block text-sm font-semibold">
            Type your answer
          </label>
          <textarea
            id="typed-answer"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full rounded-2xl border border-line bg-surface p-4 text-[1.02rem] leading-relaxed shadow-sm transition placeholder:text-muted/70 focus:border-accent"
            placeholder="Write your answer here..."
          />
          <p className="text-xs text-muted">Typed answers are not used to measure speaking pace or pauses.</p>
          <Button type="submit" icon={<PaperPlaneRight size={18} weight="fill" aria-hidden />} disabled={!typed.trim() || status === "thinking" || status === "starting"}>
            Send answer
          </Button>
        </form>
      )}

      <details className="rounded-2xl border border-line bg-surface p-4">
        <summary className="cursor-pointer font-semibold">
          Conversation so far ({studentCount} answer{studentCount === 1 ? "" : "s"})
        </summary>
        <ol className="mt-4 space-y-3 text-sm">
          {turns.map((t) => (
            <li
              key={t.id}
              className={`max-w-[88%] rounded-2xl px-4 py-2.5 leading-relaxed ${
                t.role === "coach" ? "mr-auto rounded-bl-md bg-surface text-ink shadow-sm" : "ml-auto rounded-br-md bg-ink text-paper"
              }`}
            >
              <span className="font-semibold">{t.role === "coach" ? "Coach" : "You"}: </span>
              {t.text}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
