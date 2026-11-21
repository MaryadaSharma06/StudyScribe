const test = require("node:test");
const assert = require("node:assert");
const { progressReport, currentStreak, trendOf } = require("../lib/report");

const NOW = Date.parse("2026-11-21T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const answer = (concept, correct, daysAgo, extra = {}) => ({ concept, correct, difficulty: "medium", at: at(daysAgo), docId: "set-1", fileName: "os.pdf", ...extra });
const attempt = (correct, total, daysAgo, practice = false) => ({ id: `a-${daysAgo}-${correct}`, correct, total, practice, fileName: "os.pdf", createdAt: at(daysAgo) });

test("an empty history gives an empty report without errors", () => {
  const report = progressReport({ now: NOW });
  assert.strictEqual(report.overview.accuracy, null);
  assert.strictEqual(report.overview.streak, 0);
  assert.deepStrictEqual(report.strengths, []);
  assert.strictEqual(report.trend.direction, "unknown");
});

test("the overview counts quizzes, practice and the overall score including unanswered questions", () => {
  const report = progressReport({
    now: NOW,
    attempts: [attempt(3, 5, 0, true), attempt(4, 10, 1)],
    answers: [answer("Paging", true, 1), answer("Paging", false, 1)],
  });
  assert.strictEqual(report.overview.quizzes, 1);
  assert.strictEqual(report.overview.practiceRounds, 1);
  assert.strictEqual(report.overview.accuracy, 47);   // 7 of 15
  assert.strictEqual(report.overview.questionsAnswered, 2);
  assert.strictEqual(report.overview.studyDays, 2);
});

test("strong and weak concepts are split by mastery level", () => {
  const answers = [
    ...[0, 1, 2, 3].map(() => answer("Paging", true, 1)),
    ...[0, 1, 2, 3].map(() => answer("Deadlock", false, 1)),
    answer("Thrashing", true, 1),
  ];
  const report = progressReport({ now: NOW, answers });
  assert.deepStrictEqual(report.strengths.map((c) => c.name), ["Paging"]);
  assert.deepStrictEqual(report.weaknesses.map((c) => c.name), ["Deadlock"]);
  assert.strictEqual(report.levels.new, 1);
  assert.ok(report.remarks.some((r) => r.includes("strongest in Paging")));
  assert.ok(report.remarks.some((r) => r.includes("Focus next on Deadlock")));
});

test("results are broken down by difficulty and by file", () => {
  const report = progressReport({
    now: NOW,
    answers: [
      answer("A", true, 2, { difficulty: "hard" }),
      answer("A", false, 2, { difficulty: "easy" }),
      answer("B", true, 1, { docId: "set-2", fileName: "memory.pdf" }),
    ],
  });
  const hard = report.byDifficulty.find((d) => d.difficulty === "hard");
  assert.deepStrictEqual([hard.answers, hard.accuracy], [1, 100]);
  assert.deepStrictEqual(report.byFile.map((f) => [f.fileName, f.answers, f.accuracy]), [["memory.pdf", 1, 100], ["os.pdf", 2, 50]]);
});

test("the streak counts study days in a row ending today or yesterday", () => {
  assert.strictEqual(currentStreak(["2026-11-19", "2026-11-20", "2026-11-21"], "2026-11-21"), 3);
  assert.strictEqual(currentStreak(["2026-11-19", "2026-11-20"], "2026-11-21"), 2);
  assert.strictEqual(currentStreak(["2026-11-18"], "2026-11-21"), 0);
});

test("study days follow the student's time zone", () => {
  // 20:00 UTC on the 20th is already the 21st in India (UTC+5:30)
  const late = { ...attempt(1, 1, 0), createdAt: "2026-11-20T20:00:00Z" };
  assert.strictEqual(progressReport({ now: NOW, attempts: [late], tzOffset: -330 }).overview.lastActivity, "2026-11-21");
  assert.strictEqual(progressReport({ now: NOW, attempts: [late], tzOffset: 0 }).overview.lastActivity, "2026-11-20");
});

test("the trend compares newer scores with older ones", () => {
  assert.strictEqual(trendOf([40, 50, 70, 80]).direction, "improving");
  assert.strictEqual(trendOf([80, 70, 50, 40]).direction, "slipping");
  assert.strictEqual(trendOf([60, 62, 61, 60]).direction, "steady");
  assert.strictEqual(trendOf([10, 90]).direction, "unknown");

  const report = progressReport({ now: NOW, attempts: [attempt(9, 10, 0), attempt(8, 10, 1), attempt(4, 10, 2), attempt(3, 10, 3)] });
  assert.deepStrictEqual(report.timeline.map((p) => p.score), [30, 40, 80, 90]);
  assert.strictEqual(report.trend.direction, "improving");
});
