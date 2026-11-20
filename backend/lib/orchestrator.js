/*
  The orchestrator: picks the next best learning actions for a study set,
  from the student's concept mastery (lib/mastery.js).

  It is a fixed list of rules in priority order rather than an AI call,
  so every recommendation can be explained and tested.
*/

const EXPLAIN_BELOW = 0.3;        // a weak concept this low is re-explained before more questions
const UNTESTED_SHARE = 0.3;       // suggest the quiz when at least this share of concepts is untested
const MAX_CONCEPTS = 3;           // concepts per practice round
const MAX_STEPS = 3;

// The question level that fits each mastery level: rebuild the basics, then stretch
const DIFFICULTY_FOR = { weak: "easy", new: "medium", learning: "medium", mastered: "hard" };

const percent = (value) => `${Math.round(value * 100)}%`;
const names = (list) => list.map((c) => c.name).join(", ");
const practise = (list) => list.slice(0, MAX_CONCEPTS).map((c) => ({ name: c.name, difficulty: DIFFICULTY_FOR[c.level] }));

/*
  `setConcepts` are the concept names in the open study set.
  `mastery` is conceptMastery() over all of the student's answers.
  `hasQuiz` says whether the study set has quiz questions.
  `revision` is revisionSchedule() (lib/revision.js): which concepts are due for review.

  Returns up to three steps, best first:
  [{ action: "explain" | "practice" | "quiz", title, reason, concepts: [{ name, difficulty }] }]
*/
function nextSteps({ setConcepts = [], mastery = [], hasQuiz = true, revision = [] }) {
  const known = new Map(mastery.map((entry) => [entry.name.trim().toLowerCase(), entry]));

  // Each concept in this set with what is known about it. Concepts never answered have no level.
  const concepts = [...new Set(setConcepts.map((name) => name.trim()).filter(Boolean))].map((name) => {
    const entry = known.get(name.toLowerCase());
    return entry ? { ...entry, name } : { name, level: null, mastery: null, answers: 0, correct: 0 };
  });

  const byMastery = (a, b) => a.mastery - b.mastery;
  const at = (level) => concepts.filter((c) => c.level === level).sort(byMastery);
  const weak = at("weak");
  const fresh = at("new");
  const learning = at("learning");
  const mastered = at("mastered");
  const untested = concepts.filter((c) => c.level === null);

  // Concepts in this set that are due for spaced review and are not already weak
  const dueKeys = new Set(revision.filter((entry) => entry.due).map((entry) => entry.name.trim().toLowerCase()));
  const due = concepts.filter((c) => c.level && c.level !== "weak" && dueKeys.has(c.name.toLowerCase())).sort(byMastery);

  const steps = [];

  // 1. A concept the student keeps getting wrong: more questions will not help until it is understood
  const struggling = weak.find((c) => c.mastery < EXPLAIN_BELOW);
  if (struggling) {
    steps.push({
      action: "explain",
      title: `Go over "${struggling.name}" again`,
      reason: `You got ${struggling.correct} of ${struggling.answers} questions on it right (${percent(struggling.mastery)} mastery). The tutor will explain it simply, from your file, before you practise.`,
      concepts: [{ name: struggling.name, difficulty: "easy" }],
    });
  }

  // 2. Weak concepts: easy practice first
  if (weak.length > 0) {
    steps.push({
      action: "practice",
      title: "Practise your weak concepts",
      reason: `${names(weak.slice(0, MAX_CONCEPTS))} ${weak.length === 1 ? "is" : "are"} below 45% mastery. Easy questions rebuild the basics first.`,
      concepts: practise(weak),
    });
  }

  // 3. Concepts due for spaced review, so they are not forgotten
  if (due.length > 0) {
    steps.push({
      action: "practice",
      title: "Revise what is due today",
      reason: `${names(due.slice(0, MAX_CONCEPTS))} ${due.length === 1 ? "is" : "are"} due for review. Reviewing just before you would forget makes it stick for longer.`,
      concepts: practise(due),
    });
  }

  // 4. Much of the set has never been tested, so its mastery is unknown
  if (hasQuiz && untested.length > 0 && untested.length >= Math.ceil(concepts.length * UNTESTED_SHARE)) {
    steps.push({
      action: "quiz",
      title: concepts.length === untested.length ? "Take the quiz" : "Finish testing this set",
      reason: concepts.length === untested.length
        ? `You have not been tested on this file yet. The quiz shows which of its ${concepts.length} concepts you already know.`
        : `${untested.length} of ${concepts.length} concepts in this file have not been tested yet.`,
      concepts: [],
    });
  }

  // 5. Concepts still being learned, or with too few answers to judge (unless already in the revision step)
  const unsure = [...learning, ...fresh].filter((c) => !due.includes(c)).sort(byMastery);
  if (unsure.length > 0) {
    steps.push({
      action: "practice",
      title: "Strengthen what you are still learning",
      reason: `${names(unsure.slice(0, MAX_CONCEPTS))} ${unsure.length === 1 ? "needs" : "need"} more correct answers to count as mastered.`,
      concepts: practise(unsure),
    });
  }

  // 6. Everything tested is mastered: stretch with hard questions
  if (steps.length === 0 && mastered.length > 0) {
    steps.push({
      action: "practice",
      title: "Challenge yourself",
      reason: `You have mastered every concept you were tested on. Hard questions on ${names(mastered.slice(0, MAX_CONCEPTS))} check that it sticks, or you can upload the next chapter.`,
      concepts: practise(mastered),
    });
  }

  // Without a concept map, the quiz is the only thing to suggest
  if (steps.length === 0 && hasQuiz) {
    steps.push({ action: "quiz", title: "Take the quiz", reason: "Test yourself on this file to see what to work on next.", concepts: [] });
  }

  return steps.slice(0, MAX_STEPS);
}

module.exports = { nextSteps, DIFFICULTY_FOR, EXPLAIN_BELOW };
