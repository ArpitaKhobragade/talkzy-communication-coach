# Design

## Feel
Friendly, calm, encouraging. Rounded, spacious, readable by a 10-year-old and a 22-year-old. No exam-like harshness.

## Tokens (defined in `src/app/globals.css`)
- Font: **Figtree** (variable, self-hosted via `@fontsource-variable/figtree`, so no request goes to a third-party font service). Base 16px. Reading passage 20-22px, line height 1.85, max 62 characters wide.
- Colours: page `#f5f6fb`, surface `#ffffff`, ink `#1a1d33`, muted `#565f7a`, line `#e1e4f0`.
  Accent indigo `#4f46e5` (hover `#4338ca`, text on tint `#3730a3`, tint `#eef0ff`); good `#0b7f70`; warn `#b45309`; bad `#c81e1e`.
- Radius: cards `1.25rem`, buttons `0.75rem`, pills full. Shadows are soft and indigo-tinted; primary buttons lift on hover.
- Icons: Phosphor (`@phosphor-icons/react`), one family everywhere. Icons are decorative (`aria-hidden`) and always sit beside text, so meaning never depends on an icon or a colour alone.

## Patterns
- **Two phases**: Phase 1 Reading, Phase 2 Conversation, shown with a two-segment progress bar and the visible labels "Phase 1 of 2: Reading" / "Phase 2 of 2: Conversation".
- **Dashboard**: one hero card: daily 20-minute ring on the left, today's recommendation and the two phases on the right, one primary action.
- **Conversation**: a coach orb (rings pulse while the coach speaks or the student is heard; static under reduced motion), a status chip, the question in large type, the live transcript as a quote card, one primary action ("I'm done speaking"), and always-visible Type instead / End session.
- **Report**: three sections (reading, answering, camera) with icon chips; each has "What went well", "What to improve" and "How to improve". Numbers sit in a collapsible section.
- **Buttons**: one primary action per screen; visible focus ring (3px accent, 2px offset); 44px minimum height (48px for large); pressed state moves 1px and scales 0.985.

## UX requirements
- Responsive at 375, 768 and 1440 px, no horizontal scroll. Navigation: bottom tab bar with icons on phones; header with labels (and icons from the large breakpoint) on desktop.
- Every async view has loading, empty and error states.
- Forms: labels always visible, errors next to fields, keyboard operable.
- Labels distinguish measured values ("Measured") from model opinions ("AI assessment").
- Dev mode banner on every practice screen when no API key is configured.
- Respect `prefers-reduced-motion`. Text contrast at least WCAG AA.
