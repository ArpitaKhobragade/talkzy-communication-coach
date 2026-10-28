/*
 * A name can hold letters, numbers, spaces and a few marks (apostrophe, hyphen, full stop, underscore).
 * Emojis and other symbols are removed, both while typing and when a saved profile is loaded, so they
 * never show anywhere in the app.
 */
export const NAME_MAX = 40;

/** Removes everything that is not allowed. Keeps spaces as typed, so a name can still be typed with a space. */
export function stripName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[0-9#*][︎️]?⃣/g, "")
    .replace(/[︎️⃣]/g, "")
    .replace(/[^\p{L}\p{M}\p{N} '’.\-_]/gu, "")
    .replace(/ {2,}/g, " ")
    .replace(/^ +/, "");
}

/** The name as it is saved and shown: cleaned, trimmed and at most 40 characters. */
export function cleanName(raw: string): string {
  return stripName(raw).slice(0, NAME_MAX).trim();
}
