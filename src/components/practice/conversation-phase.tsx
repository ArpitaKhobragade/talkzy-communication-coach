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
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Notice, PhaseSteps } from "@/components/ui";
import { devCoachReply, openingMessage } from "@/features/coach/dev-coach";
import type { Goal, LearningModule } from "@/features/content/types";
import type { CoachTurnRequest, Profile, Settings, Turn } from "@/features/session/types";
import type { CaptureFatal, TurnCaptureLike } from "@/features/speech/capture";
import { createCapture, fallbackEngine, pickEngine, type EngineKind } from "@/features/speech/engine";
import { speakCoach } from "@/features/speech/speaker";
import { stopSpeaking, ttsSupported, type SpeakHandle } from "@/features/speech/synthesis";
import type { VadSession } from "@/features/speech/vad-session";
import { newId } from "@/services/storage";
import { requestCoachTurn } from "@/services/coach-api";
import type { CoachMode } from "@/services/use-coach-mode";

/**
 * The student is considered finished after this much quiet once some words have been heard.
 * Generous on purpose: people pause to think mid-answer, and cutting them off is worse than a
 * short wait. The "I'm done speaking" button ends an answer immediately.
 */
const END_OF_TURN_MS = 3200;
/** Nothing heard for this long: the coach gently offers help. */
const SILENCE_MS = 12_000;
/** Safety cap for a single spoken answer. */
const MAX_ANSWER_MS = 90_000;
/** After this many silent prompts in a row, wait for the student to press a button. */
const MAX_SILENCES = 3;

type Status = "starting" | "coach" | "listening" | "thinking" | "paused";

const FATAL_TEXT: Record<CaptureFatal, string> = {
  "not-allowed": "Voice is blocked in this browser. Allow the microphone from the lock icon in the address bar, then press \"Try voice again\". You can also type.",
  "no-device": "No microphone was found. You can type your answers instead.",
  network: "The voice connection was interrupted. Press \"Try voice again\" to keep speaking, or type your answer.",
  unsupported: "This browser can't recognise speech. Try Chrome or Edge for voice, or type your answers.",
  unknown: "The voice connection was interrupted. Press \"Try voice again\" to keep speaking, or type your answer.",
  "cloud-stt": "The voice connection was interrupted. Press \"Try voice again\" to keep speaking, or type your answer.",
  vad: "Voice detection could not start. Press \"Try voice again\", or type your answer.",
};

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
  const [voiceOk, setVoiceOk] = useState(voiceCapable);
  const [typing, setTyping] = useState(!voiceCapable);
  const [typed, setTyped] = useState("");
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.round((deadline - Date.now()) / 1000)));
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [hasText, setHasText] = useState(false);

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
  const levelBar = useRef<HTMLDivElement | null>(null);
  const lastLevelDraw = useRef(0);
  const statusRef = useRef<Status>("starting");
  const settingsRef = useRef(settings);
  const typedRef = useRef("");
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    typedRef.current = typed;
  }, [typed]);

  const setStatusBoth = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  const stopPoll = useCallback(() => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  }, []);

  const addTurn = useCallback((t: Omit<Turn, "id" | "at">) => {
    const turn: Turn = { ...t, id: newId(), at: Date.now() };
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
    return turn;
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    stopPoll();
    speech.current?.cancel();
    stopSpeaking();
    capture.current?.dispose();
    capture.current = null;
    onFinish({ turns: turnsRef.current, degraded: degradedRef.current });
  }, [onFinish, stopPoll]);

  // ---- Listening ---------------------------------------------------------------------------

  const abortCapture = useCallback(() => {
    stopPoll();
    capture.current?.dispose();
    capture.current = null;
    setInterim("");
    setHasText(false);
  }, [stopPoll]);

  const askCoach = useCallback(
    async (event: CoachTurnRequest["event"], myRun: number) => {
      setStatusBoth("thinking");
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
      };
      let reply: { text: string; wrapUp: boolean };
      try {
        const res = await requestCoachTurn(req);
        if (coachMode === "live" && (res.mode === "dev" || res.degraded)) {
          degradedRef.current = true;
          setDegraded(true);
        }
        reply = { text: res.text, wrapUp: res.wrapUp };
      } catch {
        degradedRef.current = true;
        setDegraded(true);
        const local = devCoachReply(req);
        reply = { text: local.text, wrapUp: local.wrapUp };
        setNotice("We could not reach the coach service, so a simple scripted question was used instead.");
      }
      if (myRun !== run.current) return;
      busy.current = false;
      void coachSay(reply.text, reply.wrapUp || secondsLeft <= 0, myRun);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deadline, module.id, module.level, goal, profile.ageBand, coachMode],
  );

  const submitAnswer = useCallback(
    (text: string, inputMode: "voice" | "typed", extra: Partial<Turn>, myRun: number) => {
      addTurn({ role: "student", text, inputMode, ...extra });
      setInterim("");
      setTyped("");
      silences.current = 0;
      setNotice(null);
      void askCoach("answer", myRun);
    },
    [addTurn, askCoach],
  );

  const submitVoice = useCallback(
    async (myRun: number) => {
      const c = capture.current;
      if (!c || busy.current) return;
      busy.current = true;
      stopPoll();
      const res = await c.end();
      if (myRun !== run.current) return;
      c.dispose();
      capture.current = null;
      setInterim("");
      setHasText(false);

      const words = res.text.split(/\s+/).filter(Boolean).length;
      if (!res.text || (res.confidence !== null && res.confidence < 0.4 && words < 4)) {
        void askCoach("unclear", myRun);
        return;
      }
      submitAnswer(
        res.text,
        "voice",
        {
          speakingSec: res.timing.speakingSec,
          pauseCount: res.timing.pauseCount,
          longestPauseSec: res.timing.longestPauseSec,
          latencySec: res.timing.latencySec ?? undefined,
          lowConfidence: res.confidence !== null && res.confidence < 0.6 ? true : undefined,
        },
        myRun,
      );
    },
    [askCoach, submitAnswer, stopPoll],
  );

  const handleSilence = useCallback(
    (myRun: number) => {
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
      void askCoach("silence", myRun);
    },
    [askCoach, abortCapture],
  );

  const listen = useCallback(
    (myRun: number) => {
      if (myRun !== run.current || finished.current) return;
      busy.current = false;
      coachEndedAt.current = Date.now();
      turnStartedAt.current = Date.now();
      setStatusBoth("listening");
      setHasText(false);
      if (!voiceOkRef.current || engine.current === "none") return; // typed answers only

      abortCapture();
      const c = createCapture(engine.current, inputsRef.current, module.id, {
        lang: settingsRef.current.speechLang,
        onInterim: (t) => {
          setInterim(t);
          setHasText(t.replace(/\s*\.\.\.$/, "").length > 0);
        },
        onFatal: (reason) => {
          abortCapture();
          // Cloud recognition trouble: switch to the browser's recogniser and carry on speaking.
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
        if (cur.hasText()) {
          // Never cut in while a part of the answer is still being transcribed.
          if ((!cur.isBusy() && cur.idleMs() > END_OF_TURN_MS) || sinceTurn > MAX_ANSWER_MS) void submitVoice(myRun);
        } else if (cur.isBusy()) {
          // Speech was heard and is being transcribed: wait for the result.
        } else if (cur.idleMs() > SILENCE_MS) {
          handleSilence(myRun);
        } else if (sinceTurn > 30_000) {
          // Sound was detected but nothing could be recognised.
          busy.current = true;
          abortCapture();
          void askCoach("unclear", myRun);
        }
      }, 250);
    },
    [module.id, submitVoice, handleSilence, askCoach, abortCapture],
  );

  // ---- Coach speaking -------------------------------------------------------------------------

  async function coachSay(text: string, wrapUp: boolean, myRun: number) {
    if (myRun !== run.current || finished.current) return;
    closing.current = wrapUp;
    addTurn({ role: "coach", text });
    setStatusBoth("coach");
    if (canSpeak) {
      const h = speakCoach(text, {
        rate: settingsRef.current.speechRate,
        lang: settingsRef.current.speechLang,
        cloud: ttsKind === "cartesia",
        onFallback: () => setNotice("The coach's studio voice is unavailable right now, so the browser voice is being used."),
      });
      speech.current = h;
      await h.done;
      speech.current = null;
    } else {
      await new Promise((r) => setTimeout(r, 600));
    }
    if (myRun !== run.current || finished.current) return;
    if (wrapUp || timeUp.current) finish();
    else listen(myRun);
  }

  // ---- Lifecycle ------------------------------------------------------------------------------

  useEffect(() => {
    const myRun = ++run.current;
    finished.current = false;
    timeUp.current = false;
    busy.current = false;
    silences.current = 0;
    degradedRef.current = false;
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
      if (st === "listening" || st === "paused") {
        if (capture.current?.hasText()) void submitVoice(run.current);
        else if (typedRef.current.trim()) submitTyped();
        else finish();
      }
      // While the coach is speaking or thinking, coachSay() finishes the session afterwards.
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, submitVoice, finish]);

  // ---- Actions ------------------------------------------------------------------------------

  /** End the session from the button. Whatever the student was saying right now is kept, not thrown away. */
  async function endNow() {
    const c = capture.current;
    if (c && !finished.current && !busy.current && statusRef.current === "listening" && c.hasText()) {
      busy.current = true;
      stopPoll();
      const res = await c.end();
      if (res.text) {
        addTurn({
          role: "student",
          text: res.text,
          inputMode: "voice",
          speakingSec: res.timing.speakingSec,
          pauseCount: res.timing.pauseCount,
          longestPauseSec: res.timing.longestPauseSec,
          latencySec: res.timing.latencySec ?? undefined,
        });
      }
    }
    finish();
  }

  /** Stop the coach's audio now and move on (to the student's turn, or to the end if closing). */
  function skipSpeech() {
    if (statusRef.current !== "coach") return;
    const myRun = ++run.current;
    speech.current?.cancel();
    speech.current = null;
    stopSpeaking();
    if (closing.current || timeUp.current) finish();
    else listen(myRun);
  }

  function submitTyped() {
    const text = typedRef.current.trim();
    if (!text || busy.current || statusRef.current === "thinking" || statusRef.current === "starting") return;
    if (statusRef.current === "coach") {
      // Typing interrupts the coach's audio.
      if (closing.current) return;
      run.current++;
      speech.current?.cancel();
      speech.current = null;
      stopSpeaking();
    }
    busy.current = true;
    abortCapture();
    submitAnswer(text.slice(0, 2000), "typed", {}, run.current);
  }

  function repeatQuestion() {
    const last = [...turnsRef.current].reverse().find((t) => t.role === "coach");
    if (!last || busy.current) return;
    busy.current = true;
    const myRun = ++run.current;
    abortCapture();
    setStatusBoth("coach");
    setNotice(null);
    (async () => {
      if (canSpeak) {
        const h = speakCoach(last.text, { rate: settingsRef.current.speechRate, lang: settingsRef.current.speechLang, cloud: ttsKind === "cartesia" });
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

  /** After a voice problem: switch voice back on and start listening again. */
  function tryVoiceAgain() {
    if (busy.current && statusRef.current === "thinking") return;
    engine.current = pickEngine(inputsRef.current);
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
    paused: "Take your time",
  };
  const orbColor = status === "listening" ? "bg-good" : status === "coach" ? "bg-accent" : "bg-muted";
  const studentCount = turns.filter((t) => t.role === "student").length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-32">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 bg-paper/95 px-4 py-2 backdrop-blur md:mx-0 md:px-0">
        <div className="w-full">
          <PhaseSteps current={2} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Phase 2 of 2: Conversation</Badge>
          <Badge tone={coachMode === "live" && !degraded ? "good" : "warn"}>
            {coachMode === "live" && !degraded ? "AI coach" : "Scripted coach (dev mode)"}
          </Badge>
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

      {coachMode === "dev" && (
        <Notice tone="warn" role="status">
          Development mode: the coach asks scripted questions and does not understand your answers. Add an API key for the real AI coach.
        </Notice>
      )}
      {notice && (
        <Notice tone="warn" role="alert">
          {notice}
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
            {(status === "coach" || status === "listening") && (
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
            status === "listening" ? "bg-good-soft text-good" : status === "coach" ? "bg-accent-soft text-accent-ink" : "bg-paper text-muted"
          }`}
          role="status"
        >
          {label[status]}
        </p>
        <p
          className="mx-auto mt-5 max-w-2xl text-[1.3rem] font-bold leading-snug tracking-tight md:text-[1.75rem] md:font-extrabold"
          aria-live="polite"
          data-testid="coach-message"
        >
          {lastCoach?.text ?? ""}
        </p>

        {status === "listening" && voiceOk && (
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
          <Button size="lg" className="w-full sm:w-auto" icon={<CheckCircle size={20} weight="fill" aria-hidden />} onClick={() => void submitVoice(run.current)}>
            I&apos;m done speaking
          </Button>
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
        <Button variant="secondary" icon={<ArrowCounterClockwise size={18} aria-hidden />} onClick={repeatQuestion} disabled={status === "thinking" || status === "starting"}>
          Repeat the question
        </Button>
        <Button variant="secondary" icon={<Lightbulb size={18} aria-hidden />} onClick={needHint} disabled={status === "thinking" || status === "starting" || status === "coach"}>
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
        <summary className="cursor-pointer font-semibold">Conversation so far ({studentCount} answer{studentCount === 1 ? "" : "s"})</summary>
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
