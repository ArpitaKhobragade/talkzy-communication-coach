"use client";

import { forwardRef } from "react";

/** Small mirrored self-view. The video is analysed on this device only and never recorded. */
export const CameraPreview = forwardRef<HTMLVideoElement, { faceVisible: boolean | null; analysing: "loading" | "on" | "failed" | "off" }>(
  function CameraPreview({ faceVisible, analysing }, ref) {
    return (
      <div className="fixed bottom-20 right-3 z-30 w-36 overflow-hidden rounded-2xl border border-line bg-surface shadow-card md:bottom-6 md:right-6 md:w-52">
        <video ref={ref} autoPlay muted playsInline aria-label="Your camera preview" className="aspect-[4/3] w-full -scale-x-100 bg-ink/80 object-cover" />
        <div className="space-y-0.5 px-2 py-1.5 text-[0.7rem] leading-tight text-muted md:text-xs">
          <p className="font-semibold text-ink">Camera on · not recorded</p>
          <p>
            {analysing === "loading" && "Loading on-device analysis..."}
            {analysing === "failed" && "Body-language analysis is unavailable. Your session continues without it."}
            {analysing === "off" && "Analysis off."}
            {analysing === "on" && (faceVisible === false ? "Face not in view. Try moving into the frame." : "Analysed on this device.")}
          </p>
        </div>
      </div>
    );
  },
);
