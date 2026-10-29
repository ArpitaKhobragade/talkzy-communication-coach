"use client";

import { useSyncExternalStore } from "react";
import type { Profile, Session, Settings } from "@/features/session/types";
import { DEFAULT_SETTINGS } from "@/features/session/types";
import { getProfile, getSessions, getSettings, subscribe } from "./storage";

/** `undefined` while loading on the client's first render, `null` when no profile exists. */
export function useProfile(): Profile | null | undefined {
  return useSyncExternalStore(subscribe, getProfile, () => undefined);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
}

const EMPTY: Session[] = [];

/** Newest first. Empty array on the server. */
export function useSessions(): Session[] {
  return useSyncExternalStore(subscribe, getSessions, () => EMPTY);
}

/** True once running in the browser (after hydration). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
