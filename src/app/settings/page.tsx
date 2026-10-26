"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { Button, Card, Notice, PageHeader } from "@/components/ui";
import type { Settings } from "@/features/session/types";
import { clearAllTranscripts, deleteAllData, exportAllData, saveSettings } from "@/services/storage";
import { DevModeBanner, useCoachMode } from "@/services/use-coach-mode";
import { useHydrated, useProfile, useSessions, useSettings } from "@/services/use-storage";

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-6 w-11 shrink-0 cursor-pointer accent-[var(--color-accent)]"
      />
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="border-b border-line last:border-0">{children}</div>;
}

export default function SettingsPage() {
  const router = useRouter();
  const profile = useProfile();
  const settings = useSettings();
  const sessions = useSessions();
  const hydrated = useHydrated();
  const mode = useCoachMode();
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"transcripts" | "all" | null>(null);
  const rateId = useId();

  if (!hydrated || !profile) return null;

  const update = (patch: Partial<Settings>) => saveSettings({ ...settings, ...patch });

  function exportData() {
    const blob = new Blob([exportAllData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "talkzy-data.json";
    a.click();
    URL.revokeObjectURL(url);
    setMessage("Your data was downloaded as a file.");
  }

  const withTranscripts = sessions.filter((s) => s.transcriptKept && s.turns.length > 0).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Settings and privacy" subtitle="You are in control of your voice, camera and saved data." />
      <DevModeBanner mode={mode} />
      {message && (
        <Notice tone="good" role="status">
          {message}
        </Notice>
      )}

      <Card>
        <h2 className="mb-1 text-lg font-bold">Practice</h2>
        <Row>
          <Toggle label="Coach speaks aloud" hint="Turn off to read the coach's messages instead." checked={settings.coachVoice} onChange={(v) => update({ coachVoice: v })} />
        </Row>
        <Row>
          <div className="py-3">
            <label htmlFor={rateId} className="font-semibold">
              Coach speaking speed: {settings.speechRate.toFixed(2)}x
            </label>
            <input
              id={rateId}
              type="range"
              min={0.7}
              max={1.2}
              step={0.05}
              value={settings.speechRate}
              onChange={(e) => update({ speechRate: Number(e.target.value) })}
              className="mt-2 block w-full max-w-sm accent-[var(--color-accent)]"
            />
          </div>
        </Row>
        <Row>
          <Toggle
            label="Pre-select the camera option"
            hint="Off by default. You are still asked each time, and your browser asks for permission."
            checked={settings.cameraDefault}
            onChange={(v) => update({ cameraDefault: v })}
          />
        </Row>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Your saved data</h2>
        <Row>
          <Toggle label="Save conversation transcripts" checked={settings.keepTranscripts} onChange={(v) => update({ keepTranscripts: v })} />
        </Row>
        <div className="flex flex-wrap gap-3 pt-4">
          <Button variant="secondary" onClick={exportData}>
            Download my data
          </Button>
          {confirm !== "transcripts" ? (
            <Button variant="secondary" onClick={() => setConfirm("transcripts")} disabled={withTranscripts === 0}>
              Delete saved transcripts
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
              <span className="text-sm font-semibold">Delete all transcripts?</span>
              <Button
                variant="danger"
                onClick={() => {
                  clearAllTranscripts();
                  setConfirm(null);
                  setMessage("Saved transcripts were deleted. Your reports and measurements were kept.");
                }}
              >
                Yes, delete
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="space-y-3 border-bad/30">
        <h2 className="text-lg font-bold text-bad">Delete everything</h2>
        <p className="text-sm text-muted">
          This removes your profile, settings, every session and every report from this device. It cannot be undone. Individual sessions can be deleted from
          their report page.
        </p>
        {confirm !== "all" ? (
          <Button variant="danger" onClick={() => setConfirm("all")}>
            Delete all my data
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Are you sure? This cannot be undone.</span>
            <Button
              variant="danger"
              onClick={() => {
                deleteAllData();
                router.replace("/onboarding");
              }}
            >
              Yes, delete everything
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
