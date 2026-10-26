"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, ButtonLink, Card, Notice, Spinner } from "@/components/ui";
import { getGoal } from "@/features/content/fields";
import { getModule } from "@/features/content/modules";
import type { Goal } from "@/features/content/types";
import { buildSession } from "@/features/practice/finalize";
import { describeMediaFailure, requestCamera, requestMicrophone, stopStream } from "@/features/practice/media";
import { planSession } from "@/features/progress/daily-limit";
import type { ReadingResult, Turn } from "@/features/session/types";
import { GoalSchema } from "@/features/session/types";
import { computeSpeechMetrics, countWords } from "@/features/speech/metrics";
import { recognitionSupported } from "@/features/speech/recognition";
import { ttsSupported } from "@/features/speech/synthesis";
import { VisionAnalyzer } from "@/features/vision/analyzer";
import { requestReport } from "@/services/coach-api";
import { newId, saveSession } from "@/services/storage";
import { VadSession } from "@/features/speech/vad-session";
import { DevModeBanner, useServerStatus } from "@/services/use-coach-mode";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions, useSettings } from "@/services/use-storage";
import { CameraPreview } from "./camera-preview";
import { ConversationPhase } from "./conversation-phase";
import { ReadingPhase } from "./reading-phase";

type Phase = "setup" | "reading" | "conversation" | "finishing" | "save-error";
type VisionState = "off" | "loading" | "on" | "failed";

export function PracticeSession({ moduleId, goalParam }: { moduleId: string; goalParam?: string }) {
  const router = useRouter();
  const profile = useProfile();
  const sessions = useSessions();
  const settings = useSettings();
  const hydrated = useHydrated();
  const status = useServerStatus();
  const mode = status.mode;

  const [phase, setPhase] = useState<Phase>("setup");
  const [useMic, setUseMic] = useState(true);
  const [deadline, setDeadline] = useState(0);
  const [camChoice, setCamChoice] = useState<boolean | null>(null);
  const useCam = camChoice ?? settings.cameraDefault;
  const [starting, setStarting] = useState(false);
  const [mediaNotes, setMediaNotes] = useState<string[]>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [vad, setVad] = useState<VadSession | null>(null);
  const vadRef = useRef<VadSession | null>(null);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [vision, setVision] = useState<VisionState>("off");
  const [faceVisible, setFaceVisible] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analyzerRef = useRef<VisionAnalyzer | null>(null);
  const audioRef = useRef<MediaStream | null>(null);
  const camRef = useRef<MediaStream | null>(null);
  const timing = useRef({ startedAt: 0, deadline: 0, budgetSec: 0 });
  const readingRef = useRef<{ reading: ReadingResult; readingSec: number }>({ reading: { mode: "silent", durationSec: 0 }, readingSec: 0 });
  const pending = useRef<ReturnType<typeof buildSession> | null>(null);

  const lesson = getModule(moduleId);
  const goal: Goal = GoalSchema.safeParse(goalParam).success ? (goalParam as Goal) : (profile?.goal ?? "confidence");
  // Recomputed when stored sessions load (the first render sees an empty server snapshot).
  const clock = useNow();
  const plan = useMemo(() => planSession(sessions, clock), [sessions, clock]);
  const planNow = hydrated ? plan : null;

  // Cloud speech-to-text works in any modern browser; the browser recogniser needs Chrome, Edge or Safari.
  const voiceSupported = hydrated && (status.stt === "sarvam" || recognitionSupported());

  // True while the practice screen is alive and has not finished. Late async work checks it.
  const active = useRef(true);
  const visionStarted = useRef(false);

  // Stop every device when leaving the page.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      analyzerRef.current?.dispose();
      analyzerRef.current = null;
      void vadRef.current?.destroy();
      vadRef.current = null;
      stopStream(audioRef.current);
      stopStream(camRef.current);
    };
  }, []);

  // Attach the camera and start on-device analysis once the preview exists. A ref (not state)
  // guards against starting twice, so this effect never cancels its own in-flight load.
  useEffect(() => {
    if (!camStream || (phase !== "reading" && phase !== "conversation")) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== camStream) {
      video.srcObject = camStream;
      void video.play().catch(() => undefined);
    }
    if (visionStarted.current) return;
    visionStarted.current = true;
    setVision("loading");
    VisionAnalyzer.create()
      .then((a) => {
        const el = videoRef.current;
        if (!active.current || !el) {
          a.dispose();
          return;
        }
        analyzerRef.current = a;
        a.start(() => videoRef.current, (s) => setFaceVisible(s.faceVisible));
        setVision("on");
      })
      .catch(() => {
        if (active.current) setVision("failed");
      });
  }, [camStream, phase]);

  async function begin() {
    setStarting(true);
    const notes: string[] = [];
    let audio: MediaStream | null = null;
    let voiceDetector: VadSession | null = null;
    if (useMic && voiceSupported) {
      const r = await requestMicrophone();
      if (r.ok) audio = r.stream;
      else notes.push(describeMediaFailure("microphone", r.reason));
    }
    // Cloud speech-to-text needs Silero voice detection. If it cannot load, fall back to the browser's recogniser.
    if (audio && status.stt === "sarvam") {
      try {
        voiceDetector = await VadSession.create(audio);
      } catch {
        notes.push(
          recognitionSupported()
            ? "Voice detection could not load, so your browser's own voice recognition will be used instead."
            : "Voice detection could not load, so please type your answers.",
        );
      }
    }
    vadRef.current = voiceDetector;
    setVad(voiceDetector);
    let cam: MediaStream | null = null;
    if (useCam) {
      const r = await requestCamera();
      if (r.ok) cam = r.stream;
      else notes.push(describeMediaFailure("camera", r.reason));
    }
    audioRef.current = audio;
    camRef.current = cam;
    setAudioStream(audio);
    setCamStream(cam);
    setMediaNotes(notes);

    const now = Date.now();
    timing.current = { startedAt: now, deadline: now + plan.budgetSec * 1000, budgetSec: plan.budgetSec };
    setDeadline(timing.current.deadline);
    setPhase("reading");
    setStarting(false);
  }

  const onReadingDone = useCallback((r: { reading: ReadingResult; readingSec: number }) => {
    readingRef.current = r;
    setPhase("conversation");
  }, []);

  const finalize = useCallback(
    async (r: { turns: Turn[]; degraded: boolean }) => {
      if (!lesson || !profile) return;
      setPhase("finishing");
      active.current = false; // a model that finishes loading from now on is discarded
      const visionMetrics = analyzerRef.current?.stop() ?? null;
      analyzerRef.current?.dispose();
      analyzerRef.current = null;
      void vadRef.current?.destroy();
      vadRef.current = null;
      stopStream(audioRef.current);
      stopStream(camRef.current);
      setAudioStream(null);
      setCamStream(null);

      const answers = r.turns.filter((t) => t.role === "student" && t.text.trim()).length;
      let ai = null;
      let aiReason: string | undefined;
      let model: string | undefined;
      if (answers === 0) {
        aiReason = "No answers were captured in this session, so there was nothing to review.";
      } else if (mode === "live") {
        const res = await requestReport({
          moduleId: lesson.id,
          goal,
          level: lesson.level,
          ageBand: profile.ageBand,
          turns: r.turns.slice(0, 60).map((t) => ({ role: t.role, text: t.text.slice(0, 2000), inputMode: t.inputMode })),
          speech: computeSpeechMetrics(r.turns),
          readingAloud: readingRef.current.reading.aloud,
          readingMode: readingRef.current.reading.mode,
          readingSec: readingRef.current.readingSec,
          passageWords: countWords(lesson.passage),
        });
        ai = res.ai;
        aiReason = res.reason;
        model = res.model;
      } else {
        aiReason = "Development mode: no AI key is configured, so AI-written feedback (grammar, vocabulary, structure) is not available.";
      }

      const session = buildSession({
        id: newId(),
        startedAt: timing.current.startedAt,
        endedAt: Date.now(),
        budgetSec: timing.current.budgetSec,
        moduleId: lesson.id,
        field: lesson.field,
        level: lesson.level,
        goal,
        liveAi: mode === "live" && !r.degraded,
        readingSec: readingRef.current.readingSec,
        passageWords: countWords(lesson.passage),
        reading: readingRef.current.reading,
        turns: r.turns,
        vision: visionMetrics,
        keepTranscript: settings.keepTranscripts,
        ai,
        aiReason,
        model,
      });
      pending.current = session;
      if (saveSession(session)) router.replace(`/report/${session.id}`);
      else {
        setSaveError(true);
        setPhase("save-error");
      }
    },
    [lesson, profile, mode, goal, settings.keepTranscripts, router],
  );

  if (!hydrated || !profile) return null;

  if (!lesson) {
    return (
      <Card className="mx-auto max-w-xl space-y-3">
        <h1 className="text-xl font-bold">We could not find that module</h1>
        <ButtonLink href="/library">Back to the library</ButtonLink>
      </Card>
    );
  }

  if (planNow && !planNow.canStart && phase === "setup") {
    return (
      <Card className="mx-auto max-w-xl space-y-3 text-center">
        <h1 className="text-xl font-bold">That is enough practice for today</h1>
        <p className="text-muted">{planNow.reason}</p>
        <div className="flex justify-center">
          <ButtonLink href="/">Back to home</ButtonLink>
        </div>
      </Card>
    );
  }

  const topBar = (
    <div className="mx-auto mb-5 flex max-w-3xl items-center justify-between">
      <span className="font-bold">Talkzy</span>
      {phase === "setup" || phase === "reading" ? (
        <Link href="/" className="text-sm font-semibold text-muted hover:text-ink">
          Leave practice
        </Link>
      ) : null}
    </div>
  );

  if (phase === "finishing") {
    return (
      <div className="mx-auto max-w-xl space-y-4 pt-10 text-center">
        <Spinner label="Putting your feedback report together..." />
        <p className="text-sm text-muted">This can take up to a minute when the AI is writing your personal feedback.</p>
      </div>
    );
  }

  if (phase === "save-error") {
    return (
      <Card className="mx-auto max-w-xl space-y-3">
        <h1 className="text-xl font-bold">We could not save your session</h1>
        <p className="text-muted">
          Your browser blocked or ran out of storage. Free some space in Settings (delete old sessions) and try again.
        </p>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              if (pending.current && saveSession(pending.current)) router.replace(`/report/${pending.current.id}`);
            }}
          >
            Try saving again
          </Button>
          <ButtonLink href="/settings" variant="secondary">
            Open Settings
          </ButtonLink>
        </div>
        {saveError && <span className="sr-only">Save failed</span>}
      </Card>
    );
  }

  return (
    <div>
      {topBar}
      {phase === "setup" && (
        <div className="mx-auto max-w-3xl space-y-5">
          <DevModeBanner mode={mode} />
          <Card className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{lesson.level}</Badge>
              <Badge>Focus: {getGoal(goal).name}</Badge>
            </div>
            <h1 className="text-2xl font-bold">{lesson.title}</h1>
            <p className="text-muted">{lesson.summary}</p>
            <ol className="space-y-2 text-[0.95rem]">
              <li>
                <span className="font-semibold">Phase 1: Reading.</span> Read the passage on the screen out loud.
              </li>
              <li>
                <span className="font-semibold">Phase 2: Conversation.</span> Have a live conversation with your coach about what you read.
              </li>
            </ol>
            <p className="text-sm text-muted">
              Then you get your feedback. Daily practice is limited to 20 minutes in total: today&apos;s session is up to about{" "}
              {Math.round(plan.budgetSec / 60)} minutes, and you have {Math.round(plan.remainingSec / 60)} minutes left today.
            </p>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-lg font-bold">Microphone and camera</h2>
            <p className="text-sm text-muted">
              Your browser will ask for permission when you press Begin. Nothing is recorded or saved as audio or video.{" "}
              <Link href="/privacy" className="font-semibold text-accent underline underline-offset-2" target="_blank">
                How your data is used
              </Link>
            </p>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={useMic && voiceSupported}
                disabled={!voiceSupported}
                onChange={(e) => setUseMic(e.target.checked)}
                className="mt-1 h-5 w-5 accent-[var(--color-accent)]"
              />
              <span>
                <span className="font-semibold">Use my microphone for voice answers (recommended)</span>
                <span className="block text-sm text-muted">
                  {status.stt === "sarvam"
                    ? "Short clips of your speech are sent securely to a speech service (Sarvam AI) to be turned into text, then discarded. They are not saved."
                    : "Speech is turned into text by your browser, which may use the browser company's speech service."}{" "}
                  Use headphones to stop the coach&apos;s voice being picked up.
                </span>
                {!voiceSupported && (
                  <span className="block text-sm font-semibold text-warn">
                    This browser can&apos;t recognise speech. Use Chrome or Edge for voice, or continue by typing.
                  </span>
                )}
              </span>
            </label>
            <label className="flex gap-3">
              <input type="checkbox" checked={useCam} onChange={(e) => setCamChoice(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--color-accent)]" />
              <span>
                <span className="font-semibold">Use my camera for body-language observations (optional)</span>
                <span className="block text-sm text-muted">
                  Analysed on your device only. We note things like whether your face is in view, where your head is turned, and posture. We never
                  guess your emotions.
                </span>
              </span>
            </label>
            {!ttsSupported() && hydrated && (
              <Notice tone="warn">This browser cannot speak aloud, so you will read the coach&apos;s messages on screen.</Notice>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={begin} disabled={starting || mode === "unknown"}>
              {starting ? "Starting..." : "Begin"}
            </Button>
            {mode === "unknown" && <span className="text-sm text-muted">Checking the coach service...</span>}
          </div>
        </div>
      )}

      {phase === "reading" && (
        <div className="space-y-4">
          {mediaNotes.map((n) => (
            <div key={n} className="mx-auto max-w-3xl">
              <Notice tone="warn" role="status">
                {n}
              </Notice>
            </div>
          ))}
          <ReadingPhase module={lesson} stream={audioStream} vad={vad} lang={settings.speechLang} onDone={onReadingDone} />
        </div>
      )}

      {phase === "conversation" && (
        <div className="space-y-4">
          {mediaNotes.map((n) => (
            <div key={n} className="mx-auto max-w-3xl">
              <Notice tone="warn" role="status">
                {n}
              </Notice>
            </div>
          ))}
          <ConversationPhase
            module={lesson}
            profile={profile}
            goal={goal}
            settings={settings}
            stream={audioStream}
            vad={vad}
            ttsKind={status.tts}
            coachMode={mode}
            deadline={deadline}
            onFinish={finalize}
          />
        </div>
      )}

      {camStream && (phase === "reading" || phase === "conversation") && <CameraPreview ref={videoRef} faceVisible={faceVisible} analysing={vision} />}
    </div>
  );
}
