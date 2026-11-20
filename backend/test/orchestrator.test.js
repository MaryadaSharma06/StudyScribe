const test = require("node:test");
const assert = require("node:assert");
const { nextSteps } = require("../lib/orchestrator");

const entry = (name, mastery, level, answers = 4, correct = 1) => ({ name, mastery, level, answers, correct });
const actions = (steps) => steps.map((step) => step.action);

test("a set that was never tested starts with the quiz", () => {
  const steps = nextSteps({ setConcepts: ["Paging", "Deadlock", "Thrashing"], mastery: [] });
  assert.deepStrictEqual(actions(steps), ["quiz"]);
  assert.strictEqual(steps[0].title, "Take the quiz");
});

test("a concept far below the line is explained before it is practised", () => {
  const steps = nextSteps({
    setConcepts: ["Paging", "Deadlock"],
    mastery: [entry("Deadlock", 0.2, "weak", 4, 0), entry("Paging", 0.8, "mastered", 5, 5)],
  });
  assert.deepStrictEqual(actions(steps), ["explain", "practice"]);
  assert.strictEqual(steps[0].concepts[0].name, "Deadlock");
  assert.match(steps[0].reason, /0 of 4/);
  assert.deepStrictEqual(steps[1].concepts, [{ name: "Deadlock", difficulty: "easy" }]);
});

test("weak concepts above the explain line go straight to easy practice, weakest first", () => {
  const steps = nextSteps({
    setConcepts: ["A", "B", "C"],
    mastery: [entry("A", 0.4, "weak"), entry("B", 0.35, "weak"), entry("C", 0.9, "mastered")],
  });
  assert.strictEqual(steps[0].action, "practice");
  assert.deepStrictEqual(steps[0].concepts.map((c) => c.name), ["B", "A"]);
  assert.ok(steps[0].concepts.every((c) => c.difficulty === "easy"));
});

test("many untested concepts suggest finishing the quiz; learning concepts get medium practice", () => {
  const steps = nextSteps({
    setConcepts: ["A", "B", "C", "D"],
    mastery: [entry("A", 0.6, "learning"), entry("B", 0.55, "new", 2, 1)],
  });
  assert.deepStrictEqual(actions(steps), ["quiz", "practice"]);
  assert.strictEqual(steps[0].title, "Finish testing this set");
  assert.match(steps[0].reason, /2 of 4/);
  assert.deepStrictEqual(steps[1].concepts, [{ name: "B", difficulty: "medium" }, { name: "A", difficulty: "medium" }]);
});

test("when everything is mastered, the next step is a hard challenge", () => {
  const steps = nextSteps({ setConcepts: ["A", "B"], mastery: [entry("A", 0.9, "mastered"), entry("B", 0.8, "mastered")] });
  assert.strictEqual(steps.length, 1);
  assert.strictEqual(steps[0].title, "Challenge yourself");
  assert.ok(steps[0].concepts.every((c) => c.difficulty === "hard"));
});

test("concept names match without case, mastery from other files is ignored, and at most three steps are given", () => {
  const steps = nextSteps({
    setConcepts: ["paging", "A", "B", "C", "D", "E"],
    mastery: [entry("Paging", 0.1, "weak", 5, 0), entry("Other file concept", 0.1, "weak"), entry("A", 0.6, "learning")],
  });
  assert.ok(steps.length <= 3);
  assert.strictEqual(steps[0].concepts[0].name, "paging");
  assert.ok(steps.every((step) => step.concepts.every((c) => c.name !== "Other file concept")));
});

test("without a concept map, only the quiz is suggested, and nothing when there is no quiz either", () => {
  assert.deepStrictEqual(actions(nextSteps({ setConcepts: [], mastery: [] })), ["quiz"]);
  assert.deepStrictEqual(nextSteps({ setConcepts: [], mastery: [], hasQuiz: false }), []);
});

test("concepts due for review get a revision step; weak ones stay in weak practice", () => {
  const steps = nextSteps({
    setConcepts: ["A", "B", "C"],
    mastery: [entry("A", 0.9, "mastered"), entry("B", 0.6, "learning"), entry("C", 0.4, "weak")],
    revision: [{ name: "a", due: true }, { name: "B", due: false }, { name: "C", due: true }, { name: "Other", due: true }],
  });
  assert.deepStrictEqual(actions(steps), ["practice", "practice", "practice"]);
  assert.strictEqual(steps[0].title, "Practise your weak concepts");
  assert.strictEqual(steps[1].title, "Revise what is due today");
  assert.deepStrictEqual(steps[1].concepts, [{ name: "A", difficulty: "hard" }]);
  assert.deepStrictEqual(steps[2].concepts.map((c) => c.name), ["B"]);
});
