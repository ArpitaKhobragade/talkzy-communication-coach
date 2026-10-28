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
  Question,
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
import type { CoachTurnRequest, Profile, Settings, Turn } from "@/features/session/types";
import type { CaptureFatal, CaptureResult, TurnCaptureLike } from "@/features/speech/capture";
import { createCapture, fallbackEngine, pickEngine, type EngineKind } from "@/features/speech/engine";
import { watchForInterruption } from "@/features/speech/energy-barge";
import { recognitionSupported } from "@/features/speech/recognition";
import { speakCoach } from "@/features/speech/speaker";
import { stopSpeaking, ttsSupported, type SpeakHandle } from "@/features/speech/synthesis";
import type { VadSession } from "@/features/speech/vad-session";
import { newId } from "@/services/storage";
import { requestCoachTurn } from "@/services/coach-api";
import type { CoachMode } from "@/services/use-coach-mode";

/**
 * After the student has been quiet this long, the coach asks whether they are finished. Short enough that
 * the conversation feels quick, long enough that a thinking pause does not count as the end.
 */
const DONE_CHECK_MS = 3000;
/** After a very short answer the coach waits longer, because the student may still be thinking of what to add. */
const DONE_CHECK_SHORT_MS = 5000;
/** When the last words stop in the middle of a sentence ("and the", "because", "umm") the student is still thinking. */
const DONE_CHECK_OPEN_MS = 6500;
/** The student asked for time ("wait", "let me think"), so the coach keeps quiet for longer. */
const DONE_CHECK_PATIENT_MS = 9000;
const SHORT_ANSWER_WORDS = 8;
/** An answer with this many words counts as an answer even if the student does not reply to "Are you done?". */
const ENOUGH_WORDS = 12;
/** After the student answers the coach's "are you done?", this much quiet means the reply is complete. */
const REPLY_IDLE_MS = 1100;
/** No reply at all to "are you done?" for this long: the coach takes it as yes and carries on. */
const CONFIRM_WAIT_MS = 10_000;
/** Nothing heard for this long: the coach gently offers help. */
const SILENCE_MS = 14_000;
/** The same, after the student asked for time to think. */
const PATIENT_SILENCE_MS = 35_000;
/** Safety cap for a single spoken answer. */
const MAX_ANSWER_MS = 90_000;
/** After this many silent prompts in a row, wait for the student to press a button. */
const MAX_SILENCES = 3;
/** Interrupting the coach: speech must be clear (probability) and last this many frames (about half a second). */
const BARGE_PROB = 0.85;
const BARGE_FRAMES = 16;
/** The coach's first moments are never interrupted, so a breath or a click cannot cut it off. */
const BARGE_AFTER_MS = 900;

const ASK_DONE = "Are you done, or do you want to say more?";
const ASK_NEXT = "Shall we move to the next question?";
const ASK_AGAIN = "Sorry, I did not catch that. Shall we move on?";
const SAY_LISTENING = "Okay, I am listening.";

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

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  const [hasText, setHasText] = useState(false);
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
  const askedDone = useRef(false);
  const unclearReplies = useRef(0);
  const bargeRun = useRef(0);
  const voiceNoted = useRef(false);
  /** The place in the module's seven questions of the next question to ask (the opening question is 0 and is asked first). */
  const ladder = useRef(1);
  /** How many times the coach asked "Are you done?" for the answer being built. */
  const confirmAsks = useRef(0);
  /** True after the student asked for time ("wait", "let me think"): the coach waits longer and says nothing. */
  const patient = useRef(false);
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
    setHasText(false);
  };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    stopPoll();
    speech.current?.cancel();
    stopSpeaking();
    capture.current?.dispose();
    capture.current = null;
    onFinish({ turns: turnsRef.current, degraded: degradedRef.current });
  };

  // ---- The coach's side ---------------------------------------------------------------------

  /** Said once if the studio voice cannot be used: the browser voice takes over, and the student is told why. */
  function noteVoiceFallback(reason?: string) {
    if (voiceNoted.current) return;
    voiceNoted.current = true;
    setVoiceNote(`The coach is using your browser's voice now. ${reason ?? "The studio voice did not answer."}`);
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
      // These short lines use the browser voice: it starts at once, and it does not use up the studio voice credit.
      const h = speakCoach(text, { ...speakOptions(), cloud: false });
      speech.current = h;
      await h.done;
      speech.current = null;
    } else {
      await sleep(500);
    }
    return myRun === run.current && !finished.current;
  }

  async function askCoach(event: CoachTurnRequest["event"], myRun: number) {
    setStatusBoth("thinking");
    setPrompt(null);
    const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const history = turnsRef.current.slice(-24).map((t) => ({ role: t.role, text: t.text.slice(0, 2000) }));
    const req: CoachTurnRequest = {
      moduleId: module.id,
      goal,
      level: module.level,
      ageBand: profile.ageBand,
      remainingSec: secondsLeft,
      history,
      event,
      ladderIndex: ladder.current,
    };
    let reply: { text: string; wrapUp: boolean };
    try {
      const res = await requestCoachTurn(req);
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
    if (bargeRun.current !== myRun || statusRef.current !== "coach" || closing.current || finished.current) return;
    bargeRun.current = 0;
    stopEnergyWatch();
    const next = ++run.current;
    speech.current?.cancel();
    speech.current = null;
    stopSpeaking();
    setPrompt("Go ahead, I'm listening.");
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

  /** Sends the whole answer to the coach. */
  function submitPending(myRun: number) {
    const p = pending.current;
    pending.current = null;
    askedDone.current = false;
    confirmAsks.current = 0;
    patient.current = false;
    unclearReplies.current = 0;
    abortCapture();
    setPrompt(null);
    if (!p || !p.text) {
      busy.current = true;
      void askCoach("unclear", myRun);
      return;
    }
    // A question or a request to the coach is answered first; it does not count as the answer to the lesson question.
    const asking = looksLikeQuestion(p.text);
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

  /** The student asked for time ("wait", "let me think"). The coach says one short line and then stays quiet for longer. */
  async function holdOn(myRun: number) {
    patient.current = true;
    abortCapture();
    setStatusBoth("listening");
    if (!(await speakAside("Sure, take your time.", myRun))) return;
    listen(myRun);
  }

  /** The student stopped speaking. Ask whether they are finished, then act on what they say. */
  async function endOfSpeech(myRun: number, direct = false) {
    const c = capture.current;
    if (!c || busy.current) return;
    busy.current = true;
    stopPoll();
    const res = await c.end();
    if (myRun !== run.current) return;
    c.dispose();
    capture.current = null;
    showInterim("");
    setHasText(false);

    const text = res.text.trim();
    if (text && endIntent(text)) {
      endBySpeech();
      return;
    }
    // "Repeat the question" and "give me a hint" are done at once, without asking "Are you done?".
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
    const words = wordCount(text);
    if (!text || (res.confidence !== null && res.confidence < 0.4 && words < 4)) {
      if (pending.current) void confirmTurn(myRun);
      else void askCoach("unclear", myRun);
      return;
    }
    // "...next question" at the end: the answer is finished, so there is no "Are you done?".
    if (nextCommand(text)) {
      const answer = stripNextCommand(text);
      if (answer) addToPending(answer, res);
      if (pending.current) submitPending(myRun);
      else void skipQuestion(myRun);
      return;
    }
    addToPending(text, res);
    // A question to the coach is sent at once: the coach answers it and carries on.
    if (direct || looksLikeQuestion(text)) submitPending(myRun);
    else void confirmTurn(myRun);
  }

  /** The student said "next question" without answering: the coach moves on to the next question. */
  function skipQuestion(myRun: number) {
    abortCapture();
    setPrompt(null);
    busy.current = true;
    void askCoach("skip", myRun);
  }

  /** Asks "Are you done?" (or "Should we move to the next question?") and listens for the reply. */
  async function confirmTurn(myRun: number) {
    busy.current = false;
    setStatusBoth("confirming");
    const first = !askedDone.current;
    askedDone.current = true;
    confirmAsks.current += 1;
    const ok = await speakAside(first ? ASK_DONE : ASK_NEXT, myRun);
    if (!ok || statusRef.current !== "confirming") return;
    listenForReply(myRun);
  }

  function listenForReply(myRun: number) {
    if (!voiceOkRef.current || engine.current === "none") return; // typed answers use the buttons
    abortCapture();
    // The browser's recogniser answers a short "yes" or "no" almost at once, so it is used for replies when it is there.
    const kind: EngineKind = inputsRef.current.stream && recognitionSupported() ? "browser" : engine.current;
    const c = createCapture(kind, inputsRef.current, module.id, {
      lang: settingsRef.current.speechLang,
      reply: true,
      onInterim: (t) => {
        showInterim(t);
        setHasText(t.replace(/\s*\.\.\.$/, "").length > 0);
      },
      onFatal: () => {
        // Cannot hear a reply: the buttons still work, and no reply means "yes" after a few seconds.
        abortCapture();
      },
    });
    if (!c) return;
    capture.current = c;
    c.begin();
    const t0 = Date.now();
    poll.current = setInterval(() => {
      const cur = capture.current;
      if (!cur || busy.current || statusRef.current !== "confirming") return;
      if (cur.hasText()) {
        if (!cur.isBusy() && cur.idleMs() > REPLY_IDLE_MS) void settleReply(myRun);
      } else if (!cur.isBusy() && Date.now() - t0 > CONFIRM_WAIT_MS) {
        // No reply. A full answer is taken as finished. A short one is probably not: the coach waits for more,
        // quietly, and only takes it as finished the second time it has asked.
        const enough = wordCount(pending.current?.text ?? "") >= ENOUGH_WORDS || confirmAsks.current >= 2;
        if (enough) void decide("yes", "", undefined, myRun);
        else {
          abortCapture();
          setPrompt("Take your time, I am listening.");
          listen(myRun);
        }
      }
    }, 250);
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
    setHasText(false);
    busy.current = false;
    const text = res.text.trim();
    void decide(confirmIntent(text), text, res, myRun);
  }

  /** Acts on the student's reply to "Are you done?". */
  async function decide(kind: ReturnType<typeof confirmIntent>, text: string, res: CaptureResult | undefined, myRun: number) {
    if (myRun !== run.current || finished.current) return;
    abortCapture();
    if (kind === "end") return endBySpeech();
    if (kind === "yes") return submitPending(myRun);
    if (kind === "more") {
      if (!(await speakAside(SAY_LISTENING, myRun))) return;
      listen(myRun);
      return;
    }
    // "Wait" or "let me think": the coach stays quiet and gives the student time.
    if (text && commandIntent(text) === "hold") return holdOn(myRun);
    // A question to the coach is answered at once. Anything longer than a few words that is not a command is more of the answer.
    if (text && looksLikeQuestion(text)) {
      addToPending(text, res);
      return submitPending(myRun);
    }
    if (text && isContinuation(text)) {
      addToPending(text, res);
      void confirmTurn(myRun);
      return;
    }
    unclearReplies.current += 1;
    if (unclearReplies.current >= 2) return submitPending(myRun);
    setStatusBoth("confirming");
    if (!(await speakAside(ASK_AGAIN, myRun))) return;
    listenForReply(myRun);
  }

  /** The student said they want to end the session. It ends at once, without another question. */
  function endBySpeech() {
    if (finished.current) return;
    run.current++;
    const p = pending.current;
    pending.current = null;
    abortCapture();
    if (p?.text) addTurn({ role: "student", text: p.text, inputMode: "voice", speakingSec: p.speakingSec, pauseCount: p.pauseCount, longestPauseSec: p.longestPauseSec, latencySec: p.latencySec });
    finish();
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
      // The first quiet moment: a short, kind line, not a new coach message. The student is probably just thinking.
      void (async () => {
        if (await speakAside("Take your time. I am listening.", myRun)) listen(myRun);
      })();
      return;
    }
    void askCoach("silence", myRun);
  }

  function listen(myRun: number) {
    if (myRun !== run.current || finished.current) return;
    busy.current = false;
    coachEndedAt.current = Date.now();
    turnStartedAt.current = Date.now();
    setStatusBoth("listening");
    setHasText(false);
    if (!voiceOkRef.current || engine.current === "none") return; // typed answers only

    // The accurate voice detector may have finished loading since the last turn.
    if (engine.current === "browser" && inputsRef.current.vad && !cloudFailed.current) engine.current = "cloud";
    abortCapture();
    const c = createCapture(engine.current, inputsRef.current, module.id, {
      lang: settingsRef.current.speechLang,
      verbatim: true,
      onInterim: (t) => {
        showInterim(t);
        setHasText(t.replace(/\s*\.\.\.$/, "").length > 0);
        // Once the student is talking, "Go ahead, I'm listening." is no longer needed.
        if (t) setPrompt((p) => (p && /listening/i.test(p) ? null : p));
      },
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
      // The student said they want to end the session while talking: do it as soon as they pause.
      if (interimRef.current && endIntent(interimRef.current) && cur.idleMs() > 700) {
        endBySpeech();
        return;
      }
      // The student ended with "next question" or "that's all": move on as soon as they stop, without asking.
      if (interimRef.current && nextCommand(interimRef.current) && cur.idleMs() > 700 && !cur.isBusy()) {
        void endOfSpeech(myRun, true);
        return;
      }
      // "Wait" or "let me think" alone: answer at once, so the coach gives the student time without a long delay.
      if (interimRef.current && commandIntent(interimRef.current) === "hold" && cur.idleMs() > 600 && !cur.isBusy()) {
        void endOfSpeech(myRun, true);
        return;
      }
      if (cur.hasText()) {
        // Never cut in while a part of the answer is still being transcribed.
        // A sentence that stops in the middle ("... and the", "umm") means the student is still thinking.
        const said = interimRef.current;
        let wait = wordCount(said) < SHORT_ANSWER_WORDS ? DONE_CHECK_SHORT_MS : DONE_CHECK_MS;
        if (endsUnfinished(said)) wait = Math.max(wait, DONE_CHECK_OPEN_MS);
        if (patient.current) wait = Math.max(wait, DONE_CHECK_PATIENT_MS);
        if ((!cur.isBusy() && cur.idleMs() > wait) || sinceTurn > MAX_ANSWER_MS) void endOfSpeech(myRun);
      } else if (cur.isBusy()) {
        // Speech was heard and is being transcribed: wait for the result.
      } else if (cur.idleMs() > (patient.current ? PATIENT_SILENCE_MS : SILENCE_MS)) {
        if (pending.current) {
          // They said they had more to say, then said nothing: ask whether to move on.
          abortCapture();
          void confirmTurn(myRun);
        } else handleSilence(myRun);
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
    askedDone.current = false;
    // State is overwritten by the next addTurn(), so no reset is needed if React re-runs this effect.
    turnsRef.current = [];
    void coachSay(openingMessage(module.id, profile.displayName), false, myRun);
    return () => {
      // Invalidate every in-flight async chain from this mount (a counter, not a DOM node).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      run.current++;
      stopPoll();
      speech.current?.cancel();
      stopSpeaking();
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
        if (pending.current && st === "confirming") submitPending(run.current);
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
    finish();
  }

  /** Stop the coach's audio now and move on (to the student's turn, or to the end if closing). */
  function skipSpeech() {
    if (statusRef.current !== "coach") return;
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
    if (!text || busy.current || statusRef.current === "thinking" || statusRef.current === "starting") return;
    if (endIntent(text)) {
      endBySpeech();
      return;
    }
    if (statusRef.current === "coach") {
      // Typing interrupts the coach's audio.
      if (closing.current) return;
      run.current++;
      speech.current?.cancel();
      speech.current = null;
      stopSpeaking();
    }
    busy.current = true;
    pending.current = null;
    askedDone.current = false;
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
    if (!last || busy.current) return;
    busy.current = true;
    const myRun = ++run.current;
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
    if (busy.current) return;
    busy.current = true;
    const myRun = ++run.current;
    abortCapture();
    stopSpeaking();
    void askCoach("silence", myRun);
  }

  function resumeFromPause() {
    silences.current = 0;
    setNotice(null);
    listen(++run.current);
  }

  /** "Yes, next question" button. */
  function confirmYes() {
    if (statusRef.current !== "confirming") return;
    const myRun = ++run.current;
    speech.current?.cancel();
    speech.current = null;
    stopSpeaking();
    submitPending(myRun);
  }

  /** "I want to say more" button. */
  function confirmMore() {
    if (statusRef.current !== "confirming") return;
    const myRun = ++run.current;
    speech.current?.cancel();
    speech.current = null;
    stopSpeaking();
    abortCapture();
    setPrompt("I'm listening.");
    listen(myRun);
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
    confirming: voiceOk ? "Say yes or no" : "Are you done?",
    thinking: "Coach is thinking...",
    paused: "Take your time",
  };
  const live = status === "listening" || status === "confirming";
  const orbColor = status === "listening" ? "bg-good" : status === "coach" || status === "confirming" ? "bg-accent" : "bg-muted";
  const studentCount = turns.filter((t) => t.role === "student").length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-32">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 bg-paper/95 px-4 py-2 backdrop-blur md:mx-0 md:px-0">
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
              {status === "listening" ? (
                <Microphone size={34} weight="fill" />
              ) : status === "coach" ? (
                <SpeakerHigh size={34} weight="fill" />
              ) : status === "confirming" ? (
                <Question size={34} weight="fill" />
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
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5">
        {status === "listening" && voiceOk && hasText && (
          <Button size="lg" className="w-full sm:w-auto" icon={<CheckCircle size={20} weight="fill" aria-hidden />} onClick={() => void endOfSpeech(run.current, true)}>
            I&apos;m done speaking
          </Button>
        )}
        {status === "confirming" && (
          <>
            <Button size="lg" icon={<CheckCircle size={20} weight="fill" aria-hidden />} onClick={confirmYes}>
              Yes, next question
            </Button>
            <Button size="lg" variant="secondary" icon={<Microphone size={20} weight="fill" aria-hidden />} onClick={confirmMore}>
              I want to say more
            </Button>
          </>
        )}
        {status === "paused" && (
          <Button size="lg" onClick={resumeFromPause}>
            I&apos;m ready
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
          disabled={status === "thinking" || status === "starting" || status === "confirming"}
        >
          Repeat the question
        </Button>
        <Button
          variant="secondary"
          icon={<Lightbulb size={18} aria-hidden />}
          onClick={needHint}
          disabled={status === "thinking" || status === "starting" || status === "coach" || status === "confirming"}
        >
          I need a hint
        </Button>
        <Button variant="secondary" icon={<Keyboard size={18} aria-hidden />} onClick={() => setTyping((v) => !v)} aria-expanded={typing}>
          {typing ? "Hide typing" : "Type instead"}
        </Button>
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
