# How well does the AI feedback work?

This page shows how we checked the AI parts of Talkzy, what we found, what we fixed, and what we could **not** check yet.

## How the check works

We made up four practice sessions. Three have **mistakes put in on purpose**, and we wrote down exactly what they are (the "answer key"). The fourth has no mistakes, to see if the AI invents problems.

| Session | Subject / goal | Mistakes planted on purpose |
|---|---|---|
| S1 | Computer Science, fluency | Fillers in every answer (um, uh, you know, basically), very short answers, 6 words misread while reading aloud |
| S2 | Business, clarity | 11 grammar mistakes ("I am agree", "It have", "more better", "many informations"...), "very" and "good" used again and again |
| S3 | Science, confidence | Off-topic answers (cricket, a phone), "I don't know" in 4 of 5 answers, no reasons, stopped reading at 55% |
| S4 | Computer Science, clarity | **None.** Strong answers, no fillers, correct grammar |

Each session goes through the **real** report service and the **real** coach (the same code the website uses, with the real AI key). Then the results are marked in three ways:

1. **Exact numbers (no AI).** Are the filler counts, missed words, pace and reading coverage right? We know the right answer because we typed the mistakes ourselves.
2. **Written feedback, marked by a second AI.** A different AI (Qwen, not the one that writes the report) reads the report and the answer key and says: was each planted mistake found? Is every statement true? Is the praise true? Did it invent problems?
3. **Plain checks.** Is every quote really in the student's answers? Do the corrections remove the mistake? How hard is the text to read (reading grade, sentence length, hard words)?

For the coach, the second AI rates how hard each question is (1 to 5) with the questions **shuffled**, so it cannot simply follow their order.

Run it yourself: `npm run eval` (about 10 minutes and a few cents of AI use). The code is in `evals/`. The saved runs are in `evals/results/`: `baseline` is Round 1, `after` is Round 2 with the smaller model, and `final` is Round 2 with the default models (it only has one finished report, see below). Each has a `.md` table and a `.json` file with every report and every mark.

## Round 1: before any fixes (report on `gpt-oss-120b`)

| Check | Result | Goal |
|---|---|---|
| Planted mistakes found | **93%** | at least 80% |
| Same mistakes found on a second run | 100% | at least 80% |
| Statements that are true | 95% | at least 90% |
| Misleading statements | 3% | at most 5% |
| Praise that is true | **80%** | at least 90% |
| Quotes that were really said | 100% | 100% |
| Reading grade of the short report | 5.0 (easy) | at most 7 |
| Words in the short report | 87 | at most 170 |
| Judge: simple language / accuracy (out of 5) | 5.0 / 4.6 | at least 4 |
| Filler counts exactly right | 100% | 100% |
| Misread words found while reading | 100% | at least 80% |
| Coach questions never get easier | 100% | at least 70% |
| Order of questions vs difficulty (Spearman) | 0.90 | at least 0.7 |
| Coach asks exactly one question | **67%** | at least 90% |
| Reports that arrived on the first try | **62%** | at least 95% |

The AI found the planted mistakes well, and its words were easy to read. These problems showed up:

1. **Reports failing.** Only 5 of 8 reports arrived on the first try, and the 2 for the strong session (S4) never arrived. The cause was the Groq key's daily limit, not a bug (see "Groq limits" below).
2. **Praise that was not true.** The report said "You read the passage correctly" when 6 words were skipped, and called off-topic answers "clear". Praise such as "you answered every question" fits any student and teaches nothing.
3. **Two questions at once.** The coach asked two questions in 1 reply out of 3. A student who answers by voice cannot tell which one to answer.
4. **Made-up work.** The report was told to give exactly two problems, so on a strong session it had to invent them. (The larger model never got a report for S4 because of the daily limit; the smaller model clearly did this, see Round 2.)
5. **Templates.** A "say it like this" example sometimes had a blank in it ("because [give one reason]").

## What we changed because of it

- **Reading points now come from the measurements, not the AI's words.** "You read clearly" is no longer said when words were skipped. The report lists the words instead.
- **Empty praise is never shown.** Praise that would fit any student is removed. Praise about variety needs answers long enough to show it.
- **The AI is told what the software can see for certain** (short answers, "I don't know" answers, fillers, plain words repeated, how much was read) and in what order to talk about problems: off-topic or no reason first, then grammar, fillers, short answers, repeated words, reading.
- **Strengths must be specific** (a number, a quote or a clear fact). If the student did very well, the report gives one small next step, not two invented problems.
- **The student's own words are shown next to each fix**, and "say it like this" sentences with blanks are skipped.
- **One question only.** If the coach asks two, everything after the first question is dropped.
- **Wait and try again** when Groq says "too many requests", but not when Groq asks us to wait many minutes.
- **Two models.** The conversation uses the smaller, faster `gpt-oss-20b`; the report stays on `gpt-oss-120b` (see below).

## Round 2: after the fixes

| Check | Result | Goal |
|---|---|---|
| Coach asks exactly one question | **100%** | at least 90% |
| Coach questions never get easier | 100% | at least 70% |
| Order of questions vs difficulty (Spearman) | **0.95** | at least 0.7 |
| Filler counts, misread words, reading coverage, pace | 100% exact | 100% |

The coach's questions really go from easy to difficult. In the science conversation the AI rated them 1, 2, 3, 3, 3, 5, 5 in the order asked.

### What we could not check yet

The written report was checked again with the **smaller** model (`gpt-oss-20b`), because the larger model's daily allowance on our Groq key was used up by Round 1. That is the main thing this page cannot yet prove:

| Check (report written by `gpt-oss-20b`) | Result | Goal |
|---|---|---|
| Reports that arrived | 100% in 1.4 s | at least 95% |
| Planted mistakes found | **64%** | at least 80% |
| Misleading statements | **9%** | at most 5% |
| Invented problems on the strong session | **60%** | at most 10% |
| Corrections that remove the mistake | 89% | at least 90% |

The smaller model is fast and reliable, but **it misses mistakes and invents problems**. That is why the report stays on the larger model. After the fixes, the larger model was re-checked on **one** of the four sessions (S1) before its daily allowance ended again: all three planted mistakes were found, nothing was untrue, and the report was 117 words at reading grade 4.6.

**To finish the proof:** run `npm run eval` after the Groq daily allowance has reset (or on a paid Groq key). It marks the four sessions again and writes the table to `evals/results/latest.md`.

## Groq limits (important for real students)

The free Groq key allows only **200,000 tokens per day for each model** and 8,000 per minute. One practice session uses about 12,000 to 15,000 tokens (the coach's replies plus the report). That means the free key supports roughly **15 sessions a day for the whole website**, and two students finishing at the same minute can hit the per-minute limit.

What we did: two models (two separate allowances), a short wait and retry for the per-minute limit, and quick failure with a clear message (and a **Try again** button) when the daily limit is used up. The real fix is to move the Groq account to the paid **Dev tier**, which has much higher limits.

## What this check does not prove

- **Made-up sessions are not real students.** The mistakes are ones we chose. Real students make other mistakes.
- **A second AI is not a teacher.** Qwen agreed with our answer key in most cases, but it can be wrong, and it is a language model like the one it marks. Have a real teacher read a few reports.
- **Speech recognition is not tested here.** The sessions use typed-in transcripts as if recognition were perfect. Real recognition drops "um" and "uh", and it can fix a grammar mistake without being asked, so real filler counts are a lower bound and real grammar mistakes may be hidden.
- **Small numbers.** Four sessions, two runs each. Percentages move a lot with so few.
- **The camera is not part of this check.**
