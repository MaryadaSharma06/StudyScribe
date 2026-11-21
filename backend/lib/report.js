/*
  The progress report: one summary of how a student is doing,
  built from their saved quiz attempts and answers.

  Like mastery.js it is worked out fresh every time from the saved answers,
  so the report always matches the rest of the app.
*/
const { conceptMastery } = require("./mastery");

const DAY = 24 * 60 * 60 * 1000;
const LIST_SIZE = 8;          // concepts shown in each strengths / weaknesses list
const TREND_ATTEMPTS = 15;    // most recent attempts drawn in the score trend
const TREND_MIN = 4;          // attempts needed before saying whether scores are going up or down
const TREND_STEP = 5;         // percentage points of change that count as improving or slipping

const percent = (right, total) => (total > 0 ? Math.round((right / total) * 100) : null);

// The calendar day of a date for the student, as "YYYY-MM-DD".
// `tzOffset` is the browser's getTimezoneOffset(): minutes behind UTC (India is -330).
const dayOf = (iso, tzOffset) => new Date(Date.parse(iso) - tzOffset * 60 * 1000).toISOString().slice(0, 10);

// Days in a row with some studying, counting back from today (or from yesterday, if nothing yet today)
function currentStreak(days, today) {
  const studied = new Set(days);
  let cursor = Date.parse(today);
  if (!studied.has(today)) cursor -= DAY;
  let streak = 0;
  while (studied.has(new Date(cursor).toISOString().slice(0, 10))) {
    streak += 1;
    cursor -= DAY;
  }
  return streak;
}

// Compares the average score of the older half of the attempts with the newer half
function trendOf(scores) {
  if (scores.length < TREND_MIN) return { direction: "unknown", change: null };
  const half = Math.floor(scores.length / 2);
  const average = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const change = Math.round(average(scores.slice(-half)) - average(scores.slice(0, half)));
  const direction = change >= TREND_STEP ? "improving" : change <= -TREND_STEP ? "slipping" : "steady";
  return { direction, change };
}

const list = (names) => names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// Plain-language comments, like the remarks at the bottom of a school report
function remarksFor({ overview, strengths, weaknesses, almost, byDifficulty, trend, revisionDue }) {
  const remarks = [];

  if (trend.direction === "improving") remarks.push(`Your scores are going up: your recent quizzes average ${trend.change} points higher than your earlier ones.`);
  if (trend.direction === "slipping") remarks.push(`Your recent quiz scores are ${-trend.change} points lower than your earlier ones. Revising your weak concepts should help.`);
  if (trend.direction === "steady") remarks.push("Your quiz scores have been steady.");

  if (strengths.length > 0) remarks.push(`You are strongest in ${list(strengths.slice(0, 3).map((c) => c.name))}.`);
  if (weaknesses.length > 0) remarks.push(`Focus next on ${list(weaknesses.slice(0, 3).map((c) => c.name))}, where you get most questions wrong.`);
  else if (almost.length > 0) remarks.push(`${list(almost.slice(0, 3).map((c) => c.name))} ${almost.length === 1 ? "is" : "are"} close to mastered. A little more practice will get ${almost.length === 1 ? "it" : "them"} there.`);

  const hard = byDifficulty.find((d) => d.difficulty === "hard");
  const easy = byDifficulty.find((d) => d.difficulty === "easy");
  if (hard?.accuracy !== null && hard?.answers >= 3 && hard.accuracy >= 70) remarks.push(`You handle hard questions well (${hard.accuracy}% right).`);
  else if (easy?.accuracy !== null && easy?.answers >= 3 && easy.accuracy < 60) remarks.push(`Even easy questions are tricky right now (${easy.accuracy}% right), so start with the basics: the summary and flashcards.`);

  if (revisionDue > 0) remarks.push(`${revisionDue} ${revisionDue === 1 ? "concept is" : "concepts are"} due for revision today.`);
  if (overview.streak >= 2) remarks.push(`You have studied ${overview.streak} days in a row. Keep it going!`);

  return remarks;
}

/*
  `answers`: answerHistory() rows, oldest first: [{ concept, difficulty, correct, at, docId, fileName }]
  `attempts`: recentAttempts() rows, newest first: [{ id, fileName, practice, correct, total, createdAt }]
  `schedule`: revisionSchedule(answers)
  `now`: the time the report is made, `tzOffset`: the student's getTimezoneOffset()
*/
function progressReport({ answers = [], attempts = [], schedule = [], now = Date.now(), tzOffset = 0 }) {
  const concepts = conceptMastery(answers);
  const today = dayOf(new Date(now).toISOString(), tzOffset);
  const answeredQuestions = answers.length;
  const correctAnswers = answers.filter((a) => a.correct).length;

  // Unanswered questions count as wrong in an attempt's score, so the overall score uses attempt totals
  const scored = attempts.filter((a) => a.total > 0);
  const questionTotal = scored.reduce((sum, a) => sum + a.total, 0);
  const questionCorrect = scored.reduce((sum, a) => sum + a.correct, 0);

  const days = [...new Set([...attempts.map((a) => a.createdAt), ...answers.map((a) => a.at)].filter(Boolean).map((iso) => dayOf(iso, tzOffset)))].sort();

  const levels = { mastered: 0, learning: 0, weak: 0, new: 0 };
  concepts.forEach((c) => { levels[c.level] += 1; });

  const pick = ({ name, mastery, answers: count, correct }) => ({ name, mastery, answers: count, correct });
  const strengths = concepts.filter((c) => c.level === "mastered").sort((a, b) => b.mastery - a.mastery).slice(0, LIST_SIZE).map(pick);
  const weaknesses = concepts.filter((c) => c.level === "weak").slice(0, LIST_SIZE).map(pick);
  const almost = concepts.filter((c) => c.level === "learning").sort((a, b) => b.mastery - a.mastery).slice(0, LIST_SIZE).map(pick);

  const byDifficulty = ["easy", "medium", "hard"].map((difficulty) => {
    const group = answers.filter((a) => (a.difficulty || "medium") === difficulty);
    const right = group.filter((a) => a.correct).length;
    return { difficulty, answers: group.length, correct: right, accuracy: percent(right, group.length) };
  });

  // One row per file, by the study set the answers came from
  const files = new Map();
  for (const a of answers) {
    const key = a.docId || a.fileName || "unknown";
    const row = files.get(key) || { docId: a.docId || null, fileName: a.fileName || "Unknown file", answers: 0, correct: 0, concepts: new Set(), lastStudied: null };
    row.answers += 1;
    row.correct += a.correct ? 1 : 0;
    if (a.concept) row.concepts.add(a.concept.trim().toLowerCase());
    row.lastStudied = a.at || row.lastStudied;
    if (a.fileName) row.fileName = a.fileName;
    files.set(key, row);
  }
  const byFile = [...files.values()]
    .map(({ concepts: set, ...row }) => ({ ...row, concepts: set.size, accuracy: percent(row.correct, row.answers) }))
    .sort((a, b) => String(b.lastStudied).localeCompare(String(a.lastStudied)));

  const recent = scored.slice(0, TREND_ATTEMPTS).reverse();
  const timeline = recent.map((a) => ({ id: a.id, score: percent(a.correct, a.total), practice: a.practice, fileName: a.fileName, createdAt: a.createdAt }));
  const trend = trendOf(timeline.map((point) => point.score));

  const revisionDue = schedule.filter((entry) => entry.due).length;
  const nextReview = schedule.find((entry) => !entry.due) || null;

  const overview = {
    quizzes: attempts.filter((a) => !a.practice).length,
    practiceRounds: attempts.filter((a) => a.practice).length,
    questionsAnswered: answeredQuestions,
    correctAnswers,
    accuracy: percent(questionCorrect, questionTotal),
    conceptsStudied: concepts.length,
    studyDays: days.length,
    streak: currentStreak(days, today),
    firstActivity: days[0] || null,
    lastActivity: days[days.length - 1] || null,
  };

  return {
    generatedAt: new Date(now).toISOString(),
    overview,
    levels,
    strengths,
    weaknesses,
    almost,
    byDifficulty,
    byFile,
    timeline,
    trend,
    revision: { due: revisionDue, next: nextReview && { name: nextReview.name, dueAt: nextReview.dueAt } },
    remarks: remarksFor({ overview, strengths, weaknesses, almost, byDifficulty, trend, revisionDue }),
  };
}

module.exports = { progressReport, currentStreak, trendOf };
