# Writing a module

There are 360 modules: 8 subjects x 3 levels x 5 goals x 3 age groups. Each has a passage to read aloud, 5 or 6 key words, and 7 questions that go from easy to hard. They live in `src/features/content/library/<age group>/<subject>.ts`, where the age group folder is `under13`, `13to17` or `18plus`.

**The level is about the English. The age group is about the topic, the people in the story and the tone.** For the same subject, level and goal, the three age groups get three different modules: a different title, a different story, different examples and different questions.

The rules below are checked by `tests/unit/content.test.ts` and `tests/unit/content-quality.test.ts`. The tests check the shape and the reading level. They cannot check that a fact is true or a topic is interesting, so a teacher should still read the modules.

## The professional standard (read this first)

A module is a short lesson from a good teacher, not a story. It teaches something true and useful about the subject, and at the same time gives the student a model of clear spoken English to read aloud and then talk about.

- **No made-up characters.** Do not write "Imran is a trainee..." or "Riya goes to...". The passage speaks to the reader ("you", "we") or explains a thing in general ("A team...", "A doctor..."). A short real-life scene is fine only when nobody has a name.
- **Real content.** Each passage explains a real idea, process, skill or issue in the subject, with a reason and a concrete example. The student should learn something from reading it.
- **A clear title** that names the topic ("How a Website Loads", "Why Checking a Drawing Saves Time"), never "<Name> and the <Thing>".
- **Written to be said aloud:** natural rhythm, linking words, no long lists.
- **Questions that coach.** The seven questions are a ladder: recall, then explain, then give an example from your own life, then give an opinion or teach it. Each question is about the ideas in the passage or about the student's own life, never about "what did <character> do".
- **Answer hints.** Each module has seven answer hints (kept in `src/features/content/hints`, read only by the server), one per question in the same order (the opening question first). A hint is one sentence that says what a strong answer contains ("A strong answer says that ... and gives one reason or example."). It uses facts from the passage. The coach reads the hint to judge the student's answer. Keep each hint between 8 and 40 words.

Per goal, the passage is:

| Goal | The passage is |
|---|---|
| **Fluency** | A clear process or sequence explained smoothly (how something works, a routine, steps in order), full of linking words such as first, then, after that, finally |
| **Clarity** | One idea explained well: the main point, the reason and an example, in a clear order |
| **Vocabulary** | A topic that uses six important terms, each one explained by the sentences around it |
| **Confidence** | A fair look at a question with two sides that the student can have a view on, ending by inviting a choice |
| **Interview** | A short professional guide to one real interview situation in the subject: what the interviewer wants, what a weak answer sounds like, and how a strong answer is built (for example point, example, result). No named candidate |

Where the tables below say "people in the story", read "the examples and the reader": the age group decides what the examples are about and how the lesson sounds, not who a story is about.

## Who it is for

Students in India who are learning to speak English with confidence. Write plain English. Use examples they know (school, cricket, trains, monsoon, phones, UPI, the market, festivals, family), without forcing them in. Use British spelling (favourite, practise, colour). Never assume a Western setting.

### The three age groups

| | Under 13 (about 8 to 12) | 13 to 17 | 18 and older |
|---|---|---|---|
| **People in the story** | Children of the same age, with family, a teacher, a pet or a friend | Teenagers at school: clubs, exams, friends, phones | Young adults at college or at their first work: interns, new staff, project teams |
| **Places and topics** | Home, class, playground, pets, festivals with family, nature, drawing, games, simple experiments | School life, hobbies, clubs, exams, technology, a first look at careers | Campus, internships, placements, a first job, teamwork, deadlines, a small budget, how workplaces run |
| **Tone** | Warm, playful, very encouraging; short and concrete | Friendly, a little more serious; real choices and opinions | Respectful and professional, still plain English; real results and responsibility |
| **Opinion topics** (confidence goal) | Small choices a child can feel strongly about: a class pet, school lunch, playground rules, stories or TV | School and teen questions: uniforms, homework, phones, social media | Study and work questions: working from home, internships, social media at work, saving, group projects |
| **Interview goal** | Being asked questions by a teacher, a new class or a club leader: introduce yourself, say what you like, say what you can do | A school or college club, a prefect or monitor, a volunteer role, a first admission talk | A campus placement, an internship, a first job, a college or course admission |
| **Question style** | Concrete and personal ("What is your favourite...?"). A "what if" is a playful imagine | A mix of facts, reasons and opinions | Facts, reasons, experience ("Tell me about a time when..."), decisions and results |

Rules for each age group:

- **Under 13:** nothing scary, sad or violent; nothing about money worries, jobs, dating, dieting, health worries or exam stress; the people in the story are children, never adults at work. The English level still follows the module level, but choose everyday words, short sentences and clear pictures in the mind.
- **13 to 17:** school and teen life; no adult money or work problems; careers are explored, not needed yet.
- **18 and older:** do not write for children: no "school monitor" or "class pet" stories. The people are adults, the stakes are real, and the words can be more grown up for the level. Still no politics, religion or caste, and no medical or legal advice.
- All age groups: only facts you are certain of, and no violence, drugs, alcohol, religion, politics or caste.

## What makes a good passage

1. **True.** Use only facts that are well known and certain. Do not invent numbers, dates or quotes. If you are not sure, leave it out. For an opinion topic, show both sides fairly.
2. **A hook in the first sentence.** Start with a surprise, a question or an everyday scene a student recognises. Not "X is a Y."
3. **The passage explains its own key words.** A student who has never heard the word should understand it from the sentences around it.
4. **Easy to read aloud.** No long lists of hard names, no tongue-twisters, no brackets, no numbers that are hard to say.
5. **Safe.** No violence, drugs, alcohol, religion, politics, caste, or medical advice. Health topics are about habits and wellbeing only.
6. **No dashes used as punctuation, and only plain letters** (curly quotes are allowed). The test checks this.

### The three levels must feel different

| | Beginner | Intermediate | Advanced |
|---|---|---|---|
| Length | 60 to 160 words | 90 to 200 words | 120 to 260 words |
| Sentences | about 9 words on average, none over 20 | about 14, none over 27 | about 18, none over 34 |
| Reading grade | 2 to 6.5 | 6 to 9.5 | 9 to 13.5 |
| Ideas | one idea, a short story or a clear list | cause and effect, a comparison, an example | two sides, trade-offs, a careful opinion |
| Words | everyday words, one new word at a time | some subject words, explained | abstract words and phrases such as "on the other hand" |

For the same subject and goal, intermediate must be clearly harder than beginner, and advanced harder again.

## What each goal practises

| Goal | The passage is | The questions make the student |
|---|---|---|
| **Fluency** | A smooth story or sequence that sounds good read aloud | Retell it in order, with "first, then, after that", and talk for longer each time |
| **Clarity** | An explanation with a point, a reason and an example | Explain in steps, give reasons, give an example, teach someone younger |
| **Vocabulary** | Six useful words, each explained by the sentences around it | Say what a word means, use it in their own sentence, compare two words, use the words on a new topic |
| **Confidence** | A fair look at two sides of a question that students can have a view on | Say what they think, choose a side, give two reasons, and politely answer someone who disagrees |
| **Interview** | A realistic short scene in the subject (a school club, an internship, a first job) that shows good and weak answers | Answer real interview questions: introduce yourself, strengths, a time when, how would you handle, why should we choose you |

## The seven questions

> **Note (v6).** The AI coach does **not** ask these questions: it has a free conversation about the passage, and every question grows out of what the student just said (see `docs/DECISIONS.md`, rows 86 to 95). The seven questions are still required of every module because the **scripted coach** (development mode with no AI key, and the emergency fallback when the AI is down) asks them in order, and because the content tests check them. They also show the kind of topic and difficulty the module is for.

The coach asks the opening question first, then the six follow-ups in order. The order is a ladder:

| Question | Difficulty | What it asks for | Answer length |
|---|---|---|---|
| Opening | Easiest | One fact from the passage, or one simple fact about the student | One sentence |
| Follow-up 1 and 2 | Easy | A fact from the passage, or a simple personal answer | One or two sentences |
| Follow-up 3 and 4 | Medium | Why or how, or an example from the student's own life | Two to four sentences |
| Follow-up 5 and 6 | Hard | An opinion, a choice, a "what if", a comparison, or teaching the idea, and a reason for it | Four or more sentences |

Rules for every question:

- **One question at a time.** Never "Do you like it? Why?" The coach says the question aloud, and the student answers one thing.
- **Short and easy to say aloud:** the opening question is at most 18 words, the easy ones at most 22, and none is over 30.
- **Hard questions are never yes or no.** They ask for a reason, a choice, an example or an explanation.
- **Do not start two follow-ups the same way** (not "Why do..." twice, not "Tell me..." twice).
- **Different topics are not mixed in one question.** Each question stays on the passage or on the student's own life.
- Questions must end with a question mark, or with a full stop if they are a request ("Tell me about...").

## An example (beginner, clarity)

> **Why Do We Have Seasons?** The passage explains the tilt of the Earth in three short paragraphs and names the key words Earth, Sun, tilted, seasons, equator, summer.
>
> Opening: Which two seasons does the passage talk about the most?
> 1. What happens to the days when your part of the Earth leans toward the Sun? (easy: a fact)
> 2. How long does it take the Earth to travel once around the Sun? (easy: a fact)
> 3. Why do many people wrongly believe summer happens because the Earth is closer to the Sun? (medium: why)
> 4. Tell me about your favourite season and what you do during it. (medium: own life)
> 5. Explain in simple words why we have seasons. Start with the main point, then give the reason. (hard: explain with structure)
> 6. How would you teach a younger student about seasons using a ball and a lamp? Explain it step by step. (hard: teach)

## Checking your work

```bash
npx vitest run tests/unit/content.test.ts tests/unit/content-quality.test.ts
```

Then have a teacher read it. A teacher or a parent should read the under-13 modules in particular. The things only a person can check: is every fact true, is it interesting, is it suitable for the age group, and does a hard question really feel harder than an easy one?
