/*
  Spaced revision: when each concept should be reviewed again.

  Each concept sits in a box. Getting it right on a review that was due moves it
  up a box, and the next review is further away. Getting it wrong sends it back
  to the start. Like mastery, the schedule is worked out from the saved answers
  each time, so it never needs to be stored or kept in sync.
*/

const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [1, 3, 7, 16, 35];   // days until the next review, for boxes 1 to 5
const EARLY_GRACE = DAY / 2;           // a review up to 12 hours early still counts as on time

/*
  Groups answers into review sessions: all answers on one concept in one quiz attempt.
  A session counts as right only if every answer on the concept in it was right.
*/
function sessionsByConcept(answers) {
  const concepts = new Map();

  for (const item of answers) {
    const name = typeof item.concept === "string" ? item.concept.trim() : "";
    if (!name) continue;

    const key = name.toLowerCase();
    const concept = concepts.get(key) || { name, sessions: new Map() };
    const sessionKey = item.attemptId || item.at;
    const session = concept.sessions.get(sessionKey) || { at: item.at, correct: true, docId: null, fileName: "" };

    session.correct = session.correct && Boolean(item.correct);
    session.docId = item.docId || session.docId;
    session.fileName = item.fileName || session.fileName;
    concept.sessions.set(sessionKey, session);
    concept.name = name;
    concepts.set(key, concept);
  }

  return concepts;
}

/*
  `answers` are [{ concept, correct, at, attemptId, docId, fileName }], oldest first.
  Returns one entry per concept, soonest due first:
  [{ name, box, dueAt, due, reviews, docId, fileName }]

  docId and fileName are the study set the concept was last practised in,
  so a revision round can use that file's material.
*/
function revisionSchedule(answers, now = Date.now()) {
  const schedule = [];

  for (const { name, sessions } of sessionsByConcept(answers).values()) {
    let box = 0;
    let dueAt = null;
    let last = null;

    for (const session of sessions.values()) {
      const at = new Date(session.at).getTime();
      if (!session.correct) {
        box = 0;
        dueAt = at + INTERVALS[0] * DAY;
      } else if (dueAt === null || at >= dueAt - EARLY_GRACE) {
        // Right on a review that was due: move up a box
        box = Math.min(box + 1, INTERVALS.length);
        dueAt = at + INTERVALS[box - 1] * DAY;
      }
      // Right but early: no change, so cramming does not push a concept further away
      last = session;
    }

    schedule.push({
      name,
      box,
      dueAt: new Date(dueAt).toISOString(),
      due: dueAt <= now,
      reviews: sessions.size,
      docId: last.docId,
      fileName: last.fileName,
    });
  }

  return schedule.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

module.exports = { revisionSchedule, INTERVALS, DAY };
