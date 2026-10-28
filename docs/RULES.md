# Rules for AI-assisted development

1. Read `docs/` before coding. Update `docs/MEMORY.md` and `TASKS.md` after every feature.
2. TypeScript strict. No `any` without a comment explaining why.
3. Small functions, reuse components, no unrelated file edits.
4. Validate all input at API boundaries with zod; cap body sizes and array lengths.
5. Never expose secrets. Keys live in `.env.local` (git-ignored); only `.env.example` is committed.
6. Never fabricate metrics. If a value cannot be computed reliably, show "not available" and say why.
7. English only for UI, content, AI prompts, and reports.
8. Do not infer emotion, personality, honesty or confidence from face/posture. Report observable cues only.
9. Do not store raw audio/video. Keep video analysis on-device.
10. Loop per feature: Read, Plan, Build, Test, Review, Fix, Commit, Update docs.
11. Before each commit run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
12. Make small commits with clear messages. Debug by finding the root cause first, then the smallest fix.
