// Browser-only permission helpers. Permissions are requested only after the student clicks "Begin".
export type MediaResult = { ok: true; stream: MediaStream } | { ok: false; reason: "denied" | "no-device" | "unsupported" | "error" };

async function request(constraints: MediaStreamConstraints): Promise<MediaResult> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "unsupported" };
  try {
    return { ok: true, stream: await navigator.mediaDevices.getUserMedia(constraints) };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return { ok: false, reason: "denied" };
    if (name === "NotFoundError" || name === "OverconstrainedError") return { ok: false, reason: "no-device" };
    return { ok: false, reason: "error" };
  }
}

export const requestMicrophone = () =>
  request({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });

export const requestCamera = () => request({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } });

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export function describeMediaFailure(kind: "microphone" | "camera", reason: Exclude<MediaResult, { ok: true }>["reason"]): string {
  const what = kind === "microphone" ? "microphone" : "camera";
  switch (reason) {
    case "denied":
      return `The ${what} was blocked, so we will continue without it. You can allow it from the lock icon in your browser's address bar and start a new session.`;
    case "no-device":
      return `No ${what} was found, so we will continue without it.`;
    case "unsupported":
      return `This browser or connection does not support the ${what}. Use a recent Chrome or Edge on https or localhost. We will continue without it.`;
    default:
      return `The ${what} could not be started, so we will continue without it.`;
  }
}
