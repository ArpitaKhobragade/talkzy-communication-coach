"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, ButtonLink, Card, Notice } from "@/components/ui";
import { getGoal } from "@/features/content/fields";
import { getModule } from "@/features/content/modules";
import type { Goal } from "@/features/content/types";
import { buildSession } from "@/features/practice/finalize";
import { describeMediaFailure, requestCamera, requestMicrophone, stopStream } from "@/features/practice/media";
import { planSession } from "@/features/progress/daily-limit";
import type { ReadingResult, Turn } from "@/features/session/types";
import { computeSpeechMetrics, countWords } from "@/features/speech/metrics";
import { recognitionSupported } from "@/features/speech/recognition";
import { ttsSupported } from "@/features/speech/synthesis";
import { VisionAnalyzer } from "@/features/vision/analyzer";
import { requestReport, type ReportResult } from "@/services/coach-api";
import { prepareOpening } from "@/services/opening";
import { deleteAllSessions, deleteSession, keepInMemory, newId, trySaveSession } from "@/services/storage";
import { prefetchVadAssets, VadSession } from "@/features/speech/vad-session";
import { useServerStatus } from "@/services/use-coach-mode";
import { useNow } from "@/services/use-now";
import { useHydrated, useProfile, useSessions, useSettings } from "@/services/use-storage";
import { CameraPreview } from "./camera-preview";
import { ConversationPhase } from "./conversation-phase";
import { MakeRoom } from "./make-room";
import { ReadingPhase } from "./reading-phase";

type Phase = "setup" | "reading" | "conversation" | "finishing" | "save-error";
/** If the accurate voice detector is not ready after this long, reading starts with the browser's voice recognition. */
const VAD_WAIT_MS = 3500;
type VisionState = "off" | "loading" | "on" | "failed";

export function PracticeSession({ moduleId }: { moduleId: string }) {
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
  const [vadPending, setVadPending] = useState(false);
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
  // Each module is made for one goal, so the practice follows the module the student opened.
  const profileGoal = profile?.goal === "unsure" ? "confidence" : profile?.goal;
  const goal: Goal = lesson?.goal ?? profileGoal ?? "confidence";
  // Recomputed when stored sessions load (the first render sees an empty server snapshot).
  const clock = useNow();
  const plan = useMemo(() => planSession(sessions, clock), [sessions, clock]);
  const planNow = hydrated ? plan : null;

  // Cloud speech-to-text works in any modern browser; the browser recogniser needs Chrome, Edge or Safari.
  const voiceSupported = hydrated && (status.stt === "sarvam" || recognitionSupported());

  // True while the practice screen is alive and has not finished. Late async work checks it.
  const active = useRef(true);
  const visionStarted = useRef(false);

  // Download the voice detector while the student reads the set-up screen, so pressing Begin is quick.
  useEffect(() => {
    if (phase === "setup" && hydrated && useMic && status.stt === "sarvam") prefetchVadAssets();
  }, [phase, hydrated, useMic, status.stt]);

  // While the student reads the passage, the AI writes the coach's opening from it (and its voice is made), so the talk starts the
  // moment the reading ends.
  const lessonId = lesson?.id;
  const lessonGoal = lesson?.goal;
  const lessonLevel = lesson?.level;
  const firstName = profile?.displayName;
  const ageBand = profile?.ageBand;
  useEffect(() => {
    if (phase !== "reading" || !lessonId || !lessonGoal || !lessonLevel || !ageBand || firstName === undefined) return;
    void prepareOpening({
      moduleId: lessonId,
      goal: lessonGoal,
      level: lessonLevel,
      ageBand,
      name: firstName,
      live: mode === "live",
      cloudVoice: settings.coachVoice && status.tts === "cartesia",
      rate: settings.speechRate,
    });
  }, [phase, lessonId, lessonGoal, lessonLevel, ageBand, firstName, mode, settings.coachVoice, settings.speechRate, status.tts]);

  // Load the camera models as soon as the camera box is ticked, so the camera is ready the moment the session starts.
  useEffect(() => {
    if (phase === "setup" && useCam && hydrated) VisionAnalyzer.preload();
  }, [phase, useCam, hydrated]);

  // The report progress bar. It moves steadily while the AI writes, then jumps to 100% when the report is ready.
  const [progress, setProgress] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** After a while the student can carry on to the report without waiting for the written feedback. */
  const [canSkipWait, setCanSkipWait] = useState(false);
  const skipWait = useRef<(() => void) | null>(null);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startProgress = useCallback(() => {
    const t0 = Date.now();
    setProgress(3);
    setCanSkipWait(false);
    if (skipTimer.current) clearTimeout(skipTimer.current);
    skipTimer.current = setTimeout(() => setCanSkipWait(true), 15_000);
    progressTimer.current = setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      setProgress((p) => Math.max(p, Math.min(92, Math.round(92 * (1 - Math.exp(-sec / 2.4))))));
    }, 150);
  }, []);
  const stopProgress = useCallback(() => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = null;
    if (skipTimer.current) clearTimeout(skipTimer.current);
    skipTimer.current = null;
    setCanSkipWait(false);
  }, []);

  // Stop every device when leaving the page.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      VisionAnalyzer.discardPreload();
      if (progressTimer.current) clearInterval(progressTimer.current);
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
    VisionAnalyzer.take()
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
    // Ask for the microphone and the camera at the same time, so the student answers one prompt, not two in a row.
    const [mic, camera] = await Promise.all([useMic && voiceSupported ? requestMicrophone() : null, useCam ? requestCamera() : null]);
    let audio: MediaStream | null = null;
    let cam: MediaStream | null = null;
    if (mic) {
      if (mic.ok) audio = mic.stream;
      else notes.push(describeMediaFailure("microphone", mic.reason));
    }
    if (camera) {
      if (camera.ok) cam = camera.stream;
      else notes.push(describeMediaFailure("camera", camera.reason));
    }
    audioRef.current = audio;
    camRef.current = cam;
    setAudioStream(audio);
    setCamStream(cam);
    setMediaNotes(notes);

    // The reading screen opens straight away. The accurate voice detector loads in the background; if it is slow,
    // reading starts with the browser's own voice recognition, and the detector is used later in the conversation.
    const loadDetector = !!audio && status.stt === "sarvam";
    setVadPending(loadDetector);

    const now = Date.now();
    timing.current = { startedAt: now, deadline: now + plan.budgetSec * 1000, budgetSec: plan.budgetSec };
    setDeadline(timing.current.deadline);
    setPhase("reading");
    setStarting(false);

    if (audio && loadDetector) {
      const slow = recognitionSupported() ? setTimeout(() => setVadPending(false), VAD_WAIT_MS) : null;
      VadSession.create(audio)
        .then((detector) => {
          if (!active.current) {
            void detector.destroy();
            return;
          }
          vadRef.current = detector;
          setVad(detector);
        })
        .catch(() => {
          if (!active.current) return;
          setMediaNotes((n) => [
            ...n,
            recognitionSupported()
              ? "Voice detection could not load, so your browser's own voice recognition will be used instead."
              : "Voice detection could not load, so please type your answers.",
          ]);
        })
        .finally(() => {
          if (slow) clearTimeout(slow);
          setVadPending(false);
        });
    }
  }

  const onReadingDone = useCallback((r: { reading: ReadingResult; readingSec: number }) => {
    readingRef.current = r;
    setPhase("conversation");
  }, []);

  /** Opens the report. If the page did not change (a stale page after an update, or a blocked navigation), it is opened the plain way. */
  const openReport = useCallback(
    (id: string) => {
      router.replace(`/report/${id}`);
      setTimeout(() => {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a deliberate plain page load, used only when the router did not move
        if (window.location.pathname.startsWith("/practice")) window.location.assign(`${window.location.origin}/report/${id}`);
      }, 2500);
    },
    [router],
  );

  /** Tries to keep the finished session again (after the student made room). Opens the report as soon as it is kept. */
  const saveAgain = useCallback(() => {
    const s = pending.current;
    if (s && trySaveSession(s) === "saved") openReport(s.id);
  }, [openReport]);

  const finalize = useCallback(
    async (r: { turns: Turn[]; degraded: boolean }) => {
      if (!lesson || !profile) return;
      setPhase("finishing");
      startProgress();
      active.current = false; // a model that finishes loading from now on is discarded
      const visionMetrics = analyzerRef.current?.stop() ?? null;
      const cameraOn = !!camRef.current;
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
        // The written feedback is raced against the "continue without it" button, so the report is never stuck waiting.
        const waiting = new Promise<ReportResult>((resolve) => {
          skipWait.current = () => resolve({ ai: null, reason: "You chose not to wait for the written feedback. Your measured results are shown below." });
        });
        const res = await Promise.race([requestReport({
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
        }), waiting]);
        skipWait.current = null;
        ai = res.ai;
        aiReason = res.reason;
        model = res.model;
      } else {
        aiReason = "Development mode: no AI key is configured, so AI-written feedback (grammar, vocabulary, structure) is not available.";
      }

      stopProgress();
      setProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 400)); // let the bar reach 100% before the page changes
      const make = (feedback: typeof ai, reason: string | undefined, turns: Turn[]) =>
        buildSession({
          id: newId(),
          startedAt: timing.current.startedAt,
          endedAt: Date.now(),
          budgetSec: timing.current.budgetSec,
          moduleId: lesson.id,
          field: lesson.field,
          level: lesson.level,
          goal,
          liveAi: mode === "live" && !r.degraded && !!feedback,
          readingSec: readingRef.current.readingSec,
          passageWords: countWords(lesson.passage),
          reading: readingRef.current.reading,
          turns,
          vision: visionMetrics,
          cameraOn,
          keepTranscript: settings.keepTranscripts,
          ai: feedback,
          aiReason: reason,
          model,
        });
      // Saving can never leave the student stuck on this screen: if the data does not fit the saved format,
      // it is cleaned (numbers made safe, long text cut) and saved again without the written feedback.
      // If the browser is full, nothing is deleted: the student is shown their old sessions and chooses what to delete.
      let session: ReturnType<typeof buildSession> | null = null;
      let saved = false;
      const store = (s: ReturnType<typeof buildSession>) => trySaveSession(s) === "saved";
      try {
        session = make(ai, aiReason, r.turns);
        saved = store(session);
      } catch {
        try {
          const safe = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined);
          const cleanTurns = r.turns.map((t) => ({
            ...t,
            text: t.text.slice(0, 3500),
            speakingSec: safe(t.speakingSec),
            pauseCount: safe(t.pauseCount) === undefined ? undefined : Math.round(t.pauseCount ?? 0),
            longestPauseSec: safe(t.longestPauseSec),
            latencySec: safe(t.latencySec),
          }));
          session = make(null, "The written feedback could not be saved this time. Your measured results are shown below.", cleanTurns);
          saved = store(session);
        } catch {
          // Last resort: the report still opens, with the reading and timing results only.
          try {
            session = make(null, "Some details could not be kept, so only the main results are shown.", []);
            saved = store(session);
          } catch {
            saved = false;
          }
        }
      }
      if (session) pending.current = session;
      if (saved && session) {
        openReport(session.id);
      } else {
        // `saveError` means: the report exists but could not be kept, so the student is shown their old sessions to delete.
        setSaveError(!!session);
        setPhase("save-error");
      }
    },
    [lesson, profile, mode, goal, settings.keepTranscripts, openReport, startProgress, stopProgress],
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
    <div className="mb-5 flex items-center justify-between">
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
      <div className="mx-auto max-w-xl space-y-5 pt-16 text-center">
        <h1 className="text-2xl font-bold">Making your report</h1>
        <p className="text-muted">Okay, we are generating your report based on this conversation.</p>
        <p className="text-6xl font-extrabold tabular-nums" aria-live="off">
          {progress}%
        </p>
        <div
          role="progressbar"
          aria-label="Report progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="h-3 w-full overflow-hidden rounded-full bg-line"
        >
          <div className="h-full rounded-full bg-black transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-sm font-semibold text-muted" role="status">
          {progress >= 100 ? "Done! Opening your report..." : progress < 25 ? "Counting your words and pauses..." : progress < 60 ? "Checking your answers..." : "Writing your feedback..."}
        </p>
        {canSkipWait && progress < 100 && (
          <div className="space-y-2">
            <p className="text-sm text-muted">This is taking longer than usual.</p>
            <Button variant="secondary" onClick={() => skipWait.current?.()}>
              Show my report now
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "save-error") {
    // The report is ready but the browser has no room for it: the student deletes old sessions right here, and the report opens.
    if (!saveError) {
      return (
        <Card className="mx-auto max-w-xl space-y-3">
          <h1 className="text-xl font-bold">We could not make your report</h1>
          <p className="text-muted">Something went wrong while putting the report together. Please try a new session.</p>
          <ButtonLink href="/">Back to home</ButtonLink>
        </Card>
      );
    }
    return (
      <>
        <MakeRoom
          sessions={sessions}
          onDelete={(id) => {
            deleteSession(id);
            saveAgain();
          }}
          onDeleteAll={() => {
            deleteAllSessions();
            saveAgain();
          }}
          onTryAgain={saveAgain}
          onOpenWithoutSaving={() => {
            const s = pending.current;
            if (s && keepInMemory(s)) openReport(s.id);
          }}
        />
        {saveError && <span className="sr-only">Save failed</span>}
      </>
    );
  }

  return (
    <div>
      {topBar}
      {phase === "setup" && (
        <div className="mx-auto max-w-5xl space-y-5">
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
                  Your words are turned into text and shown while you speak. Your voice is not saved. Use headphones to stop the coach&apos;s voice being picked up.
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
                <span className="font-semibold">Use my camera for feedback on my face and body (optional)</span>
                <span className="block text-sm text-muted">
                  Your report will say how you looked, for example nervous, tense or relaxed, and how to look more confident. The video stays on your device
                  and is never recorded.
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
          <ReadingPhase module={lesson} stream={audioStream} vad={vad} vadPending={vadPending} lang={settings.speechLang} onDone={onReadingDone} />
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
