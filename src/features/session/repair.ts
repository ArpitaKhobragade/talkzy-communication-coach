import { SessionSchema, type Session } from "./types";

/*
 * A finished session must always be able to open its report. The saved format is strict (numbers in range, text not too long), and
 * the data from the camera or the speech measures can be slightly outside it (for example 100.0000001 per cent, or a number that
 * is not a number). Instead of refusing the whole report, the few wrong values are put right here.
 */

type Path = (string | number)[];

function getAt(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function setAt(root: unknown, path: Path, value: unknown): boolean {
  if (!path.length) return false;
  const parent = getAt(root, path.slice(0, -1));
  if (parent === null || typeof parent !== "object") return false;
  (parent as Record<string | number, unknown>)[path[path.length - 1]] = value;
  return true;
}

/** Returns the session in the saved format, with any wrong values put right, or null when that cannot be done. */
export function repairSession(raw: unknown): Session | null {
  const first = SessionSchema.safeParse(raw);
  if (first.success) return first.data;

  // Numbers that are not real numbers (NaN, Infinity) become empty values first.
  let copy: unknown;
  try {
    copy = JSON.parse(JSON.stringify(raw, (_key, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
  } catch {
    return null;
  }

  for (let round = 0; round < 8; round++) {
    const parsed = SessionSchema.safeParse(copy);
    if (parsed.success) return parsed.data;
    let changed = false;
    for (const issue of parsed.error.issues) {
      const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
      const value = getAt(copy, path);
      const bound = issue as { minimum?: number | bigint; maximum?: number | bigint };
      if (issue.code === "too_small" && typeof value === "number" && bound.minimum !== undefined) {
        changed = setAt(copy, path, Number(bound.minimum)) || changed;
      } else if (issue.code === "too_big" && typeof value === "number" && bound.maximum !== undefined) {
        changed = setAt(copy, path, Number(bound.maximum)) || changed;
      } else if (issue.code === "too_big" && typeof value === "string" && bound.maximum !== undefined) {
        changed = setAt(copy, path, value.slice(0, Number(bound.maximum))) || changed;
      } else if (issue.code === "too_big" && Array.isArray(value) && bound.maximum !== undefined) {
        changed = setAt(copy, path, value.slice(0, Number(bound.maximum))) || changed;
      } else if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
        changed = setAt(copy, path, Math.round(value)) || changed; // a whole number was expected
      } else if (value === null && issue.code === "invalid_type") {
        changed = setAt(copy, path, 0) || changed; // a number was expected and there was none
      }
    }
    if (!changed) break;
  }

  // The camera data is the usual cause: leave it out and try once more.
  if (copy && typeof copy === "object") {
    (copy as Record<string, unknown>).vision = null;
    const last = SessionSchema.safeParse(copy);
    if (last.success) return last.data;
  }
  return null;
}
