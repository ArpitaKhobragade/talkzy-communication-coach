/*
 * The AI writes the student's first name as the placeholder {name} (for example "Hey {name}, that is a great point"). The real
 * first name is put in on the student's device, and it is turned back into {name} before anything is sent to the AI, so the name is
 * never sent to the AI by the app.
 */

export const NAME_TOKEN = "{name}";

/** The first word of what the student typed as their name or nickname. */
export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? "";
}

/** Puts the student's first name in place of {name}. With no name, the placeholder (and the space before it) is dropped: "Hi {name}!" becomes "Hi!". */
export function fillName(text: string, displayName: string): string {
  const name = firstNameOf(displayName);
  if (name) return text.replaceAll(NAME_TOKEN, name);
  return text.replace(/,?\s*\{name\}/gi, "").replace(/\s+([!?.,])/g, "$1");
}

/** Turns the student's first name back into {name}, for text that is sent to the AI (the coach's own earlier words). */
export function maskName(text: string, displayName: string): string {
  const name = firstNameOf(displayName);
  if (name.length < 2) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${escaped}\\b`, "g"), NAME_TOKEN);
}
