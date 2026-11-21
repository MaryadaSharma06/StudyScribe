const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const fs = require("fs");
const gTTS = require("gtts");

const { UserError } = require("./lib/errors");
const { askGroq, safeParse } = require("./lib/ai");
const { extractSections } = require("./lib/extract");
const { toPieces, sampleText, buildKnowledgeMap } = require("./lib/understand");
const { cleanQuiz, cleanFlashcards, conceptNamesOf, questionRules, QUESTION_FORMAT, DIFFICULTIES } = require("./lib/quiz");
const { nextDifficulty, weakConcepts, analyzeMistakes, practiceQuestions } = require("./lib/assess");
const { saveDocument, getDocument, forgetDocument } = require("./lib/store");
const { answerQuestion, LEVELS } = require("./lib/tutor");
const {
  userFromToken, saveAttempt, recentAttempts, answerHistory,
  saveStudySet, listStudySets, getStudySet, studySetPieces, existingStudySetIds, deleteStudySet,
} = require("./lib/db");
const { conceptMastery } = require("./lib/mastery");
const { nextSteps, DIFFICULTY_FOR } = require("./lib/orchestrator");
const { revisionSchedule } = require("./lib/revision");
const { progressReport } = require("./lib/report");

/* ---------- CONFIG ---------- */
const MAX_FILE_MB = 25;
const STUDY_TEXT_CHARS = 6000;   // how much text the summary, notes and quiz prompts receive
const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_TURNS = 6;     // how many earlier chat messages the tutor is shown
const MAX_TURN_CHARS = 1000;
const MAX_ANSWERS = 60;          // most quiz answers accepted in one request
const MAX_SAVED_ANSWERS = 200;   // most answers saved from one quiz attempt

// A trimmed string no longer than `max`, or "" for anything that is not a string
const short = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

for (const key of ["GROQ_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
  if (!process.env[key]) {
    console.error(`${key} is missing. Copy backend/.env.example to backend/.env and add your keys.`);
    process.exit(1);
  }
}

// ALLOWED_ORIGINS is a comma-separated list of frontend URLs. If it is empty, every origin is allowed.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

/* ---------- ERRORS ---------- */
function sendError(res, error, fallbackMessage) {
  console.error("ERROR:", error.message);

  if (error instanceof UserError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.status === 401) {
    return res.status(502).json({ error: "The AI service rejected the API key. Check GROQ_API_KEY on the server." });
  }
  if (error.status === 429) {
    return res.status(429).json({ error: "The AI service is busy (rate limit reached). Please try again in a minute." });
  }
  res.status(500).json({ error: fallbackMessage, details: error.message });
}

/* ---------- SIGN-IN CHECK ---------- */
// Every route that uses the AI or the database needs a signed-in student.
// The frontend sends the Supabase access token as "Authorization: Bearer <token>".
async function requireUser(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await userFromToken(token).catch(() => null);
  if (!user) {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
  req.user = user;
  next();
}

/* ---------- AUDIO ---------- */
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

async function generateAudio(text) {
  return new Promise((resolve) => {
    try {
      const fileName = `audio_${Date.now()}.mp3`;
      const filePath = path.join(uploadsDir, fileName);

      const gtts = new gTTS(text || "No content", "en");

      gtts.save(filePath, (err) => {
        if (err) return resolve(null);
        resolve(`/uploads/${fileName}`);
      });
    } catch {
      resolve(null);
    }
  });
}

/* ---------- ROUTES ---------- */

app.get("/", (req, res) => {
  res.send("Backend working ✅");
});

/* ---------- MAIN UPLOAD ---------- */
app.post("/upload", requireUser, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      throw new UserError("No file was uploaded. Please choose a file first.");
    }

    const sections = await extractSections(req.file);

    console.log("📄 SECTIONS:", sections.length);

    const text = sampleText(sections, STUDY_TEXT_CHARS);
    const warnings = [];

    /* ---------- SUMMARY ---------- */
    let summaryRaw = await askGroq(`
You are a professor explaining a lecture.

Return ONLY JSON:
{
 "summary": "..."
}

Rules:
- Minimum 300 words
- No generic phrases like "this presentation covers"
- Explain concepts clearly with examples

TEXT:
${text}
`);

    let summaryData = safeParse(summaryRaw);

    if (!summaryData || typeof summaryData.summary !== "string" || summaryData.summary.length < 200) {
      console.log("🔁 Retry summary...");
      const retry = await askGroq(`Explain in detail (300+ words):\n${text}`);
      summaryData = { summary: retry };
    }

    /* ---------- NOTES ---------- */
    let notesRaw = await askGroq(`
Return ONLY JSON:
{
 "notes":["...", "..."]
}

Rules:
- Minimum 15 notes
- Each note must be 1–2 lines
- Explain concept clearly with examples

TEXT:
${text}
`);

    let notesData = safeParse(notesRaw);

    if (!notesData || !Array.isArray(notesData.notes) || notesData.notes.length < 10) {
      console.log("🔁 Retry notes...");
      const retry = await askGroq(`Give 15 detailed notes:\n${text}`);
      notesData = {
        notes: retry.split(".").map(l => l.trim()).filter(Boolean)
      };
    }

    /* ---------- KNOWLEDGE MAP ---------- */
    const knowledge = await buildKnowledgeMap(sections);

    if (!knowledge) {
      warnings.push("The topics and concepts could not be extracted for this file.");
    }

    /* ---------- QUIZ + FLASHCARDS ---------- */
    // Built after the knowledge map so every question can be tagged with one of its concepts
    const conceptNames = conceptNamesOf(knowledge);

    let quizRaw = await askGroq(`
Return ONLY JSON:
{
 "flashcards":[{"q":"...","a":"..."}],
 "quiz":[${QUESTION_FORMAT}]
}

Rules:
- Minimum 15 flashcards
- Minimum 15 MCQs: 5 easy, 5 medium and 5 hard
- Questions must test understanding
${questionRules(conceptNames)}

TEXT:
${text}
`, { maxTokens: 6000 });

    const quizData = safeParse(quizRaw) || {};
    let quiz = cleanQuiz(quizData.quiz, conceptNames);
    let flashcards = cleanFlashcards(quizData.flashcards);

    if (quiz.length < 10) {
      console.log("🔁 Retry quiz...");
      const retry = await askGroq(`Return ONLY JSON: {"quiz":[${QUESTION_FORMAT}]}.\nRules:\n${questionRules(conceptNames)}\nGenerate 15 MCQs, a mix of easy, medium and hard:\n${text}`, { maxTokens: 6000 });
      const retryQuiz = cleanQuiz(safeParse(retry)?.quiz, conceptNames);
      if (retryQuiz.length > quiz.length) quiz = retryQuiz;
    }

    if (flashcards.length < 10) {
      console.log("🔁 Retry flashcards...");
      const retry = await askGroq(`Return ONLY JSON: {"flashcards":[{"q":"...","a":"..."}]}. Generate 20 flashcards:\n${text}`);
      const retryCards = cleanFlashcards(safeParse(retry)?.flashcards);
      if (retryCards.length > flashcards.length) flashcards = retryCards;
    }

    if (quiz.length === 0) {
      warnings.push("The quiz could not be generated for this file. Try uploading it again.");
    }
    if (flashcards.length === 0) {
      warnings.push("The flashcards could not be generated for this file. Try uploading it again.");
    }

    /* ---------- RESPONSE ---------- */
    const audioUrl = await generateAudio(summaryData.summary);
    const pieces = toPieces(sections);

    const studySet = {
      fileName: short(req.file.originalname, 200),
      summary: summaryData.summary,
      notes: notesData.notes,
      flashcards,
      quiz,
      knowledge,
      originalText: text,
      audio: audioUrl,
    };

    // Save to the student's account; its id is the docId. If saving fails the set still works until a restart.
    let docId;
    try {
      docId = await saveStudySet(req.user.id, { ...studySet, pieces });
    } catch (saveError) {
      console.error("Study set not saved:", saveError.message);
      warnings.push("This study set could not be saved to your account, so it will be lost when you refresh.");
    }

    // Keep the whole document in memory too, so the tutor can search it without a database call
    docId = saveDocument(pieces, { id: docId, userId: req.user.id });

    res.json({
      docId,
      ...studySet,
      audioError: audioUrl ? null : "The text-to-speech service did not respond.",
      warnings,
    });

  } catch (error) {
    sendError(res, error, "Something went wrong while creating your study set.");
  }
});

app.post("/generate-more-questions", requireUser, async (req, res) => {
  try {
    const { text, score, concepts } = req.body || {};

    if (typeof text !== "string" || text.trim().length === 0) {
      throw new UserError("No text provided");
    }

    const contentText = text.substring(0, 10000);
    const conceptNames = (Array.isArray(concepts) ? concepts : [])
      .filter((name) => typeof name === "string" && name.trim())
      .slice(0, 60)
      .map((name) => name.trim().slice(0, 100));

    // Adaptive difficulty: the next questions depend on how the student has done so far
    const difficulty = nextDifficulty(Number(score?.correct) || 0, Number(score?.total) || 0);

    let quizRaw = await askGroq(`
Return ONLY JSON:
{
 "questions":[${QUESTION_FORMAT}]
}

Rules:
- Generate 10 NEW unique MCQs
- Different from the original questions
- Questions must test understanding
- Each option should be plausible
- Most questions should be of "${difficulty}" difficulty
${questionRules(conceptNames)}

TEXT:
${contentText}
`, { maxTokens: 5000 });

    let questions = cleanQuiz(safeParse(quizRaw)?.questions, conceptNames);

    if (questions.length === 0) {
      console.log("Retry more questions...");
      const retry = await askGroq(`Return ONLY JSON: {"questions":[${QUESTION_FORMAT}]}.\nRules:\n${questionRules(conceptNames)}\nGenerate 10 unique MCQs of mostly "${difficulty}" difficulty for a quiz:\n${contentText}`, { maxTokens: 5000 });
      questions = cleanQuiz(safeParse(retry)?.questions, conceptNames);
    }

    res.json({ questions, difficulty });

  } catch (error) {
    sendError(res, error, "Failed to generate more questions");
  }
});

/* ---------- ASSESSMENT ---------- */

// Keeps only well-formed quiz answers from a request.
function cleanAnswers(list, max) {
  const answers = (Array.isArray(list) ? list : []).slice(0, max).flatMap((item) => {
    const options = (Array.isArray(item?.options) ? item.options : []).map((opt) => short(opt, 300)).filter(Boolean).slice(0, 6);
    const answer = short(item?.answer, 300);
    const chosen = short(item?.chosen, 300);
    const q = short(item?.q, 500);

    // Both the right answer and the student's choice must be real options of the question
    if (!q || !options.includes(answer) || !options.includes(chosen)) return [];

    return [{
      index: Number.isInteger(item.index) ? item.index : -1,
      q,
      options,
      answer,
      chosen,
      concept: short(item.concept, 100),
      difficulty: DIFFICULTIES.includes(item.difficulty) ? item.difficulty : "medium",
    }];
  });

  if (answers.length === 0) {
    throw new UserError("No quiz answers were provided.");
  }
  return answers;
}

/*
  The document behind a study set, for the student who owns it.
  Recent documents are in memory; others are loaded from the database,
  so the tutor keeps working after the server restarts.
*/
async function findDocument(docId, userId) {
  if (typeof docId !== "string" || !docId) return null;

  const cached = getDocument(docId);
  if (cached) return cached.userId === userId ? cached : null;

  const pieces = await studySetPieces(userId, docId);
  if (!pieces) return null;
  saveDocument(pieces, { id: docId, userId });
  return getDocument(docId);
}

const MISSING_DOCUMENT = "This study set is no longer available. Please upload the file again.";

// Reads the document and the student's answers from a request.
async function readAssessment(body, userId) {
  const document = await findDocument(body?.docId, userId);
  if (!document) throw new UserError(MISSING_DOCUMENT, 404);
  return { document, answers: cleanAnswers(body.answers, MAX_ANSWERS) };
}

// Explains each wrong answer and suggests a likely cause
app.post("/analyze-mistakes", requireUser, async (req, res) => {
  try {
    const { document, answers } = await readAssessment(req.body, req.user.id);
    const analysis = await analyzeMistakes(document.pieces, answers);

    res.json({ analysis, weakConcepts: weakConcepts(answers) });

  } catch (error) {
    sendError(res, error, "The mistakes could not be analysed. Please try again.");
  }
});

// Writes new questions on the concepts the student got wrong
app.post("/practice", requireUser, async (req, res) => {
  try {
    const { document, answers } = await readAssessment(req.body, req.user.id);
    const concepts = weakConcepts(answers);

    if (concepts.length === 0) {
      throw new UserError("There are no weak concepts to practise. Every labelled question was answered correctly.");
    }

    const questions = await practiceQuestions(document.pieces, concepts, answers.map((item) => item.q));
    if (questions.length === 0) {
      throw new UserError("Practice questions could not be written for these concepts. Please try again.", 502);
    }

    res.json({ questions, concepts: [...new Set(questions.map((question) => question.concept))] });

  } catch (error) {
    sendError(res, error, "Practice questions could not be generated. Please try again.");
  }
});

// Practice on concepts the orchestrator chose, at the difficulty it chose for each
app.post("/practice-concepts", requireUser, async (req, res) => {
  try {
    const document = await findDocument(req.body?.docId, req.user.id);
    if (!document) throw new UserError(MISSING_DOCUMENT, 404);

    const concepts = (Array.isArray(req.body.concepts) ? req.body.concepts : []).slice(0, 3).flatMap((item) => {
      const name = short(item?.name, 100);
      return name ? [{ name, difficulty: DIFFICULTIES.includes(item.difficulty) ? item.difficulty : "medium" }] : [];
    });
    if (concepts.length === 0) throw new UserError("No concepts were chosen to practise.");

    const avoid = (Array.isArray(req.body.avoid) ? req.body.avoid : []).map((q) => short(q, 500)).filter(Boolean).slice(0, 60);
    const questions = await practiceQuestions(document.pieces, concepts, avoid);
    if (questions.length === 0) {
      throw new UserError("Practice questions could not be written for these concepts. Please try again.", 502);
    }

    res.json({ questions, concepts: [...new Set(questions.map((question) => question.concept))] });

  } catch (error) {
    sendError(res, error, "Practice questions could not be generated. Please try again.");
  }
});

/* ---------- PROGRESS ---------- */

// The student's recent attempts and how well they know each concept
async function progressFor(userId) {
  const [attempts, answers] = await Promise.all([recentAttempts(userId), answerHistory(userId)]);
  return { attempts, concepts: conceptMastery(answers) };
}

// Saves a submitted quiz and returns the updated progress.
// It does not need the document, so results still save after the server restarts.
app.post("/attempts", requireUser, async (req, res) => {
  try {
    const answers = cleanAnswers(req.body?.answers, MAX_SAVED_ANSWERS)
      .map((item) => ({ ...item, correct: item.chosen === item.answer }));

    // Unanswered questions still count towards the total
    const total = Math.min(Math.max(Number.parseInt(req.body.total, 10) || 0, answers.length), MAX_SAVED_ANSWERS);

    await saveAttempt(req.user.id, {
      docId: short(req.body.docId, 100),
      fileName: short(req.body.fileName, 200),
      practice: req.body.practice === true,
      total,
      answers,
    });

    res.json(await progressFor(req.user.id));

  } catch (error) {
    sendError(res, error, "Your quiz result could not be saved.");
  }
});

app.get("/progress", requireUser, async (req, res) => {
  try {
    res.json(await progressFor(req.user.id));
  } catch (error) {
    sendError(res, error, "Your progress could not be loaded.");
  }
});

/* ---------- PROGRESS REPORT ---------- */

const MAX_REPORT_ATTEMPTS = 500;

// A full progress report: overall scores, strong and weak concepts, results by difficulty and by file, and the score trend.
// `tz` is the browser's getTimezoneOffset(), so study days and streaks follow the student's own calendar.
app.get("/report", requireUser, async (req, res) => {
  try {
    const tz = Number.parseInt(req.query.tz, 10);
    const [attempts, answers] = await Promise.all([recentAttempts(req.user.id, MAX_REPORT_ATTEMPTS), answerHistory(req.user.id)]);
    res.json(progressReport({
      answers,
      attempts,
      schedule: revisionSchedule(answers),
      tzOffset: Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0,
    }));
  } catch (error) {
    sendError(res, error, "Your progress report could not be made.");
  }
});

/* ---------- NEXT STEPS (Phase 6) ---------- */

// The next best learning actions for the open study set, from the student's mastery
app.post("/next-steps", requireUser, async (req, res) => {
  try {
    const setConcepts = (Array.isArray(req.body?.concepts) ? req.body.concepts : [])
      .map((name) => short(name, 100))
      .filter(Boolean)
      .slice(0, 100);

    const answers = await answerHistory(req.user.id);
    res.json({
      steps: nextSteps({
        setConcepts,
        mastery: conceptMastery(answers),
        revision: revisionSchedule(answers),
        hasQuiz: req.body.hasQuiz !== false,
      }),
    });

  } catch (error) {
    sendError(res, error, "Your next steps could not be worked out.");
  }
});

/* ---------- SPACED REVISION (Phase 7) ---------- */

/*
  Concepts due for review, grouped by the study set they were last practised in,
  so each group can be revised with that file's material. Also the next few coming up.
*/
app.get("/revision", requireUser, async (req, res) => {
  try {
    const answers = await answerHistory(req.user.id);
    const schedule = revisionSchedule(answers);
    const levels = new Map(conceptMastery(answers).map((c) => [c.name.toLowerCase(), c.level]));
    const due = schedule.filter((entry) => entry.due);
    const available = await existingStudySetIds(req.user.id, due.map((entry) => entry.docId));

    const groups = new Map();
    for (const entry of due) {
      const key = entry.docId || "none";
      const group = groups.get(key) || { setId: entry.docId, fileName: entry.fileName, available: available.has(entry.docId), concepts: [] };
      const level = levels.get(entry.name.toLowerCase()) || "new";
      group.concepts.push({ name: entry.name, box: entry.box, dueAt: entry.dueAt, difficulty: DIFFICULTY_FOR[level] });
      groups.set(key, group);
    }

    res.json({
      due: [...groups.values()],
      upcoming: schedule.filter((entry) => !entry.due).slice(0, 5).map(({ name, dueAt, box }) => ({ name, dueAt, box })),
    });

  } catch (error) {
    sendError(res, error, "Your revision plan could not be loaded.");
  }
});

/* ---------- SAVED STUDY SETS ---------- */

app.get("/study-sets", requireUser, async (req, res) => {
  try {
    res.json({ studySets: await listStudySets(req.user.id) });
  } catch (error) {
    sendError(res, error, "Your study sets could not be loaded.");
  }
});

// A saved study set in the same shape as the upload response
app.get("/study-sets/:id", requireUser, async (req, res) => {
  try {
    const studySet = await getStudySet(req.user.id, req.params.id);
    if (!studySet) throw new UserError("This study set was not found. It may have been deleted.", 404);
    res.json({ ...studySet, warnings: [], audioError: studySet.audio ? null : "There is no audio for this study set." });
  } catch (error) {
    sendError(res, error, "This study set could not be opened.");
  }
});

// Deletes a study set. Quiz results from it stay, so mastery is not lost.
app.delete("/study-sets/:id", requireUser, async (req, res) => {
  try {
    if (!(await deleteStudySet(req.user.id, req.params.id))) {
      throw new UserError("This study set was not found. It may have been deleted already.", 404);
    }
    forgetDocument(req.params.id);
    res.json({ deleted: true });
  } catch (error) {
    sendError(res, error, "This study set could not be deleted.");
  }
});

/* ---------- TUTOR ---------- */
app.post("/ask", requireUser, async (req, res) => {
  try {
    const { docId, question, history, level } = req.body || {};

    if (typeof question !== "string" || !question.trim()) {
      throw new UserError("Please type a question.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
      throw new UserError(`Your question is too long. Keep it under ${MAX_QUESTION_CHARS} characters.`);
    }

    const document = await findDocument(docId, req.user.id);
    if (!document) throw new UserError(MISSING_DOCUMENT, 404);

    // Only well-formed, recent messages are passed on to the AI
    const recentTurns = (Array.isArray(history) ? history : [])
      .filter((turn) => turn && typeof turn.text === "string" && ["student", "tutor"].includes(turn.role))
      .slice(-MAX_HISTORY_TURNS)
      .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TURN_CHARS) }));

    const result = await answerQuestion({
      pieces: document.pieces,
      question: question.trim(),
      history: recentTurns,
      level: Object.hasOwn(LEVELS, level) ? level : "simple",
    });

    res.json(result);

  } catch (error) {
    sendError(res, error, "The tutor could not answer. Please try again.");
  }
});

/* ---------- UPLOAD ERRORS ---------- */
// Errors raised by multer before a route runs, such as a file that is too large.
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large. The limit is ${MAX_FILE_MB} MB.` });
  }
  if (err instanceof multer.MulterError || err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request could not be read. Please try again." });
  }
  sendError(res, err, "Server error");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
