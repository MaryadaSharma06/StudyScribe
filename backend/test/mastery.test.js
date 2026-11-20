const test = require("node:test");
const assert = require("node:assert");
const { conceptMastery, levelFor } = require("../lib/mastery");

const answer = (concept, correct, difficulty = "medium") => ({ concept, correct, difficulty, at: "2026-11-20T10:00:00Z" });
const masteryOf = (answers, name) => conceptMastery(answers).find((c) => c.name === name);

test("a concept with fewer than three answers is too new to judge", () => {
  const result = masteryOf([answer("Paging", true), answer("Paging", true)], "Paging");
  assert.strictEqual(result.level, "new");
  assert.strictEqual(result.answers, 2);
  assert.strictEqual(result.correct, 2);
});

test("mostly right answers reach mastered, mostly wrong answers are weak", () => {
  const right = Array.from({ length: 5 }, () => answer("Paging", true));
  const wrong = Array.from({ length: 5 }, () => answer("Deadlock", false));
  const result = conceptMastery([...right, ...wrong]);

  assert.strictEqual(result.find((c) => c.name === "Paging").level, "mastered");
  assert.strictEqual(result.find((c) => c.name === "Deadlock").level, "weak");
  // Weakest first, so the dashboard can show what to work on
  assert.strictEqual(result[0].name, "Deadlock");
});

test("one answer never moves a concept to 0% or 100%", () => {
  assert.ok(masteryOf([answer("Paging", true)], "Paging").mastery < 1);
  assert.ok(masteryOf([answer("Paging", false)], "Paging").mastery > 0);
});

test("recent answers count more than old ones", () => {
  const improving = [answer("Paging", false), answer("Paging", false), answer("Paging", true), answer("Paging", true)];
  const slipping = [answer("Paging", true), answer("Paging", true), answer("Paging", false), answer("Paging", false)];
  assert.ok(masteryOf(improving, "Paging").mastery > masteryOf(slipping, "Paging").mastery);
});

test("a right hard answer counts more than a right easy one, a wrong easy answer more than a wrong hard one", () => {
  const base = [answer("Paging", true), answer("Paging", false)];
  assert.ok(masteryOf([...base, answer("Paging", true, "hard")], "Paging").mastery > masteryOf([...base, answer("Paging", true, "easy")], "Paging").mastery);
  assert.ok(masteryOf([...base, answer("Paging", false, "easy")], "Paging").mastery < masteryOf([...base, answer("Paging", false, "hard")], "Paging").mastery);
});

test("concept names are matched without case or spaces, and unlabelled answers are skipped", () => {
  const result = conceptMastery([answer("paging", true), answer(" Paging ", false), answer("", true), answer(null, true)]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, "Paging");
  assert.strictEqual(result[0].answers, 2);
});

test("levelFor uses the thresholds", () => {
  assert.strictEqual(levelFor(0.9, 2), "new");
  assert.strictEqual(levelFor(0.8, 3), "mastered");
  assert.strictEqual(levelFor(0.5, 3), "learning");
  assert.strictEqual(levelFor(0.3, 3), "weak");
});
