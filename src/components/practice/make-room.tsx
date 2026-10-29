"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { getModule } from "@/features/content/modules";
import type { Session } from "@/features/session/types";

/**
 * Shown instead of the report when the browser has no room to keep it. The student chooses which old sessions to delete, right here,
 * and the report opens as soon as there is room. Nothing is deleted without the student pressing a button.
 */
export function MakeRoom({
  sessions,
  onDelete,
  onDeleteAll,
  onOpenWithoutSaving,
  onTryAgain,
}: {
  sessions: Session[];
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onOpenWithoutSaving: () => void;
  onTryAgain: () => void;
}) {
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <div className="mx-auto max-w-2xl" data-testid="make-room">
      <Card className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">One more step: make room for your report</h1>
        <p className="text-muted">
          Your report is ready, but this device has no space left to keep it. Delete some old sessions below, and your report opens as soon as there is room.
        </p>
      </div>

      {sessions.length > 0 ? (
        <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{getModule(s.moduleId)?.title ?? "Practice session"}</p>
                <p className="text-sm text-muted">
                  {new Date(s.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {Math.max(1, Math.round(s.durationSec / 60))} min
                </p>
              </div>
              <Button variant="danger" className="min-h-10 px-4" onClick={() => onDelete(s.id)} aria-label={`Delete the session from ${new Date(s.startedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}`} data-testid="make-room-delete">
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-white px-3 py-2 text-sm text-muted">
          There are no old sessions to delete, so this browser is not letting the app keep anything (for example in a private window). You can try again, or open the report now.
        </p>
      )}

      <p className="text-sm text-muted">Deleting a session removes its report from this device. It cannot be undone.</p>

      <div className="flex flex-wrap items-center gap-3">
        {sessions.length > 0 &&
          (confirmAll ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Delete all {sessions.length} old sessions?</span>
              <Button variant="danger" className="min-h-10 px-4" onClick={onDeleteAll} data-testid="make-room-delete-all">
                Yes, delete all
              </Button>
              <Button variant="secondary" className="min-h-10 px-4" onClick={() => setConfirmAll(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button variant="danger" className="min-h-10 px-4" onClick={() => setConfirmAll(true)}>
              Delete all old sessions
            </Button>
          ))}
        {sessions.length === 0 && <Button onClick={onTryAgain}>Try again</Button>}
        <Button variant="secondary" className="min-h-10 px-4" onClick={onOpenWithoutSaving} data-testid="make-room-open-unsaved">
          Open the report without saving it
        </Button>
      </div>
      <p className="text-xs text-muted">Without saving, the report stays on screen until you close this tab. You can still download the PDF.</p>
      </Card>
    </div>
  );
}
