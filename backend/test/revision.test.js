const test = require("node:test");
const assert = require("node:assert");
const { revisionSchedule, DAY } = require("../lib/revision");

const START = Date.parse("2026-11-01T09:00:00Z");
const day = (n) => new Date(START + n * DAY).toISOString();
// One answer in its own quiz attempt on day n
const answer = (concept, correct, n, extra = {}) => ({ concept, correct, at: day(n), attemptId: `attempt-${n}-${concept}`, ...extra });
const entryFor = (answers, name, now) => revisionSchedule(answers, now).find((e) => e.name === name);

test("each on-time right review moves the concept up a box, and the gaps grow", () => {
  const answers = [answer("Paging", true, 0), answer("Paging", true, 1), answer("Paging", true, 4), answer("Paging", true, 11)];
  const entry = entryFor(answers, "Paging", START + 12 * DAY);

  assert.strictEqual(entry.box, 4);
  assert.strictEqual(entry.dueAt, day(11 + 16));
  assert.strictEqual(entry.due, false);
});

test("a wrong answer sends the concept back to the start, due tomorrow", () => {
  const answers = [answer("Paging", true, 0), answer("Paging", true, 1), answer("Paging", false, 4)];
  const entry = entryFor(answers, "Paging", START + 6 * DAY);

  assert.strictEqual(entry.box, 0);
  assert.strictEqual(entry.dueAt, day(5));
  assert.strictEqual(entry.due, true);
});

test("getting it right again before it is due does not move it up", () => {
  const crammed = [answer("Paging", true, 0), answer("Paging", true, 0.2), answer("Paging", true, 0.4)];
  const entry = entryFor(crammed, "Paging", START);
  assert.strictEqual(entry.box, 1);
  assert.strictEqual(entry.dueAt, day(1));
});

test("a review up to 12 hours early still counts", () => {
  const entry = entryFor([answer("Paging", true, 0), answer("Paging", true, 0.6)], "Paging", START);
  assert.strictEqual(entry.box, 2);
});

test("one wrong answer in a quiz makes the whole session wrong for that concept", () => {
  const sameQuiz = { attemptId: "quiz-1" };
  const entry = entryFor([answer("Paging", true, 0, sameQuiz), answer("Paging", false, 0, sameQuiz)], "Paging", START);
  assert.strictEqual(entry.box, 0);
  assert.strictEqual(entry.reviews, 1);
});

test("due concepts come first, and each keeps the study set it was last practised in", () => {
  const answers = [
    answer("Deadlock", true, 0, { docId: "set-1", fileName: "os.pdf" }),
    answer("Paging", true, 0, { docId: "set-1", fileName: "os.pdf" }),
    answer("Paging", true, 1, { docId: "set-2", fileName: "memory.pdf" }),
  ];
  const schedule = revisionSchedule(answers, START + 2 * DAY);

  assert.deepStrictEqual(schedule.map((e) => [e.name, e.due]), [["Deadlock", true], ["Paging", false]]);
  assert.strictEqual(schedule[1].docId, "set-2");
  assert.strictEqual(schedule[1].fileName, "memory.pdf");
});

test("concept names are matched without case, and unlabelled answers are skipped", () => {
  const schedule = revisionSchedule([answer("paging", true, 0), answer("Paging", true, 1), answer("", true, 1)], START);
  assert.strictEqual(schedule.length, 1);
  assert.strictEqual(schedule[0].box, 2);
});
