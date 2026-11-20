/*
  The student model: an estimate of how well a student knows each concept,
  worked out from every saved answer on that concept.

  It is recalculated from the answers each time instead of being stored,
  so it can never disagree with the answers and the rule can change freely.
*/

// Older answers count less: each newer answer on the same concept multiplies earlier evidence by this
const DECAY = 0.85;

// A right answer to a hard question says more than a right answer to an easy one,
// and a wrong answer to an easy question says more than a wrong answer to a hard one.
const WEIGHTS = {
  easy: { right: 0.7, wrong: 1.3 },
  medium: { right: 1, wrong: 1 },
  hard: { right: 1.3, wrong: 0.7 },
};

const MIN_ANSWERS = 3;        // fewer answers than this is not enough to judge
const MASTERED = 0.75;
const LEARNING = 0.45;

function levelFor(mastery, answers) {
  if (answers < MIN_ANSWERS) return "new";
  if (mastery >= MASTERED) return "mastered";
  if (mastery >= LEARNING) return "learning";
  return "weak";
}

/*
  `answers` are [{ concept, difficulty, correct, at }], oldest first.
  Returns one entry per concept, weakest first:
  [{ name, mastery, level, answers, correct, lastSeen }]

  mastery = (weighted right + 1) / (weighted total + 2)
  The +1 and +2 start every concept at 50% and stop a single answer from swinging it to 0% or 100%.
*/
function conceptMastery(answers) {
  const byConcept = new Map();

  for (const item of answers) {
    const name = typeof item.concept === "string" ? item.concept.trim() : "";
    if (!name) continue;

    const key = name.toLowerCase();
    const entry = byConcept.get(key) || { name, right: 0, total: 0, answers: 0, correct: 0, lastSeen: null };
    const weight = (WEIGHTS[item.difficulty] || WEIGHTS.medium)[item.correct ? "right" : "wrong"];

    entry.right = entry.right * DECAY + (item.correct ? weight : 0);
    entry.total = entry.total * DECAY + weight;
    entry.answers += 1;
    entry.correct += item.correct ? 1 : 0;
    entry.name = name;          // the most recent spelling is shown
    entry.lastSeen = item.at || entry.lastSeen;
    byConcept.set(key, entry);
  }

  return [...byConcept.values()]
    .map((entry) => {
      const mastery = Math.round(((entry.right + 1) / (entry.total + 2)) * 100) / 100;
      return {
        name: entry.name,
        mastery,
        level: levelFor(mastery, entry.answers),
        answers: entry.answers,
        correct: entry.correct,
        lastSeen: entry.lastSeen,
      };
    })
    .sort((a, b) => a.mastery - b.mastery || b.answers - a.answers);
}

module.exports = { conceptMastery, levelFor, MIN_ANSWERS };
