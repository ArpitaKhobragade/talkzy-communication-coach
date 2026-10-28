# PRD: Talkzy

## One-liners
- **Problem:** School and college students rarely get regular, personalised speaking practice with feedback based on what they actually said.
- **User:** Students aged ~10-25 (school and college), English only.
- **Outcome:** A student can do a short daily session (reading, live voice conversation, feedback report) and see their communication improve over time.

## MVP features (the complete student journey)
1. **Profile and specialization** - display name, age band, field of study, level, communication goal.
2. **Learning module library** - modules per field and difficulty (Beginner / Intermediate / Advanced).
3. **Reading phase** - passage on screen, optional read-aloud with speech recognition (accuracy and pace).
4. **Live AI voice conversation** - the coach speaks (text-to-speech), the student answers by microphone (speech recognition), the coach asks relevant follow-ups using the passage and earlier answers.
5. **Speech analysis** - pace, pauses, fillers, repetitions, vocabulary variety, answer length; grammar, structure, relevance via the AI model (live AI mode only).
6. **Optional body-language analysis** - on-device webcam analysis: face visibility, head orientation, posture, movement.
7. **Post-session report** - strengths, improvements, metrics, quotes from the actual conversation, next exercises.
8. **Daily practice and progress** - max 20 minutes/day, history, trends, recommended next practice.
9. **Settings and privacy** - consent, camera/transcript defaults, delete one session or everything, export.

## Out of scope for version one (the "not now" list)
- Multi-device sync and server-side accounts/passwords.
- Teacher/parent dashboards.
- Payments, social features, leaderboards.
- Non-English languages.
- Raw audio/video recording or playback.
- Emotion, personality, honesty or confidence inference from the face or posture.
- Custom-trained models.

## Honesty rules (product requirements)
- Every number shown must be computed from real session data. No invented measurements.
- Pronunciation: only an approximate "words the speech recogniser had trouble with" list; never a pronunciation score.
- Grammar/vocabulary/structure/relevance judgements come only from the AI model and are labelled "AI assessment". In development mode (no API key) they are not shown at all.
- Development mode is clearly labelled and uses a scripted coach, not AI.

## Success criteria
- A student can: pick a field, read a passage, hold a spoken conversation of up to ~10 minutes, receive a report, and see the session in history, in one sitting, without developer help.
- Without a camera, microphone permission, or API key, the app degrades gracefully and says so.
- Total practice never exceeds 20 minutes per calendar day.
