const { createClient } = require("@supabase/supabase-js");

/*
  Talks to the Supabase database and checks who is signed in.
  The backend uses the secret key, which bypasses Row Level Security,
  so every query here must filter by the signed-in user's id.
*/
const MAX_HISTORY_ANSWERS = 1000;   // most answers read when working out mastery

let client = null;

// Created on first use, so the module can be loaded before the environment is checked
function db() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// The user an access token belongs to, or null if the token is missing, expired or fake.
async function userFromToken(token) {
  if (!token) return null;
  const { data, error } = await db().auth.getUser(token);
  return error ? null : data.user;
}

async function saveAttempt(userId, { docId, fileName, practice, total, answers }) {
  const correct = answers.filter((item) => item.correct).length;

  const { data: attempt, error } = await db()
    .from("quiz_attempts")
    .insert({ user_id: userId, doc_id: docId || null, file_name: fileName, practice, correct, total })
    .select("id")
    .single();
  if (error) throw error;

  const rows = answers.map((item) => ({
    attempt_id: attempt.id,
    user_id: userId,
    question: item.q,
    concept: item.concept,
    difficulty: item.difficulty,
    chosen: item.chosen,
    answer: item.answer,
    is_correct: item.correct,
  }));

  const { error: answersError } = await db().from("quiz_answers").insert(rows);
  if (answersError) {
    // Without its answers the attempt would be misleading, so remove it
    await db().from("quiz_attempts").delete().eq("id", attempt.id).eq("user_id", userId);
    throw answersError;
  }
}

async function recentAttempts(userId, limit = 10) {
  const { data, error } = await db()
    .from("quiz_attempts")
    .select("id, file_name, practice, correct, total, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return data.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    practice: row.practice,
    correct: row.correct,
    total: row.total,
    createdAt: row.created_at,
  }));
}

// The student's most recent answers, oldest first, in the form conceptMastery() and revisionSchedule() expect.
async function answerHistory(userId) {
  const { data, error } = await db()
    .from("quiz_answers")
    .select("concept, difficulty, is_correct, created_at, attempt_id, quiz_attempts(doc_id, file_name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_HISTORY_ANSWERS);
  if (error) throw error;

  return data.reverse().map((row) => ({
    concept: row.concept,
    difficulty: row.difficulty,
    correct: row.is_correct,
    at: row.created_at,
    attemptId: row.attempt_id,
    docId: row.quiz_attempts?.doc_id || null,
    fileName: row.quiz_attempts?.file_name || "",
  }));
}

/* ---------- STUDY SETS ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Saves an uploaded file's study set and returns its id, which the app uses as the docId.
async function saveStudySet(userId, set) {
  const { data, error } = await db()
    .from("study_sets")
    .insert({
      user_id: userId,
      file_name: set.fileName,
      summary: set.summary,
      notes: set.notes,
      flashcards: set.flashcards,
      quiz: set.quiz,
      knowledge: set.knowledge,
      original_text: set.originalText,
      audio: set.audio,
      pieces: set.pieces,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function listStudySets(userId, limit = 20) {
  const { data, error } = await db()
    .from("study_sets")
    .select("id, file_name, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return data.map((row) => ({ id: row.id, fileName: row.file_name, createdAt: row.created_at }));
}

// One study set in the shape the upload route returns, or null if it is not this student's.
async function getStudySet(userId, id) {
  if (!UUID.test(id)) return null;
  const { data, error } = await db()
    .from("study_sets")
    .select("id, file_name, summary, notes, flashcards, quiz, knowledge, original_text, audio, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    docId: data.id,
    fileName: data.file_name,
    summary: data.summary,
    notes: data.notes,
    flashcards: data.flashcards,
    quiz: data.quiz,
    knowledge: data.knowledge,
    originalText: data.original_text,
    audio: data.audio,
    createdAt: data.created_at,
  };
}

// The document text of a study set, for the tutor and practice questions.
async function studySetPieces(userId, id) {
  if (!UUID.test(id)) return null;
  const { data, error } = await db()
    .from("study_sets")
    .select("pieces")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.pieces : null;
}

// Which of these ids are study sets the student still has (some may have been deleted).
async function existingStudySetIds(userId, ids) {
  const valid = [...new Set(ids)].filter((id) => UUID.test(id || ""));
  if (valid.length === 0) return new Set();
  const { data, error } = await db().from("study_sets").select("id").eq("user_id", userId).in("id", valid);
  if (error) throw error;
  return new Set(data.map((row) => row.id));
}

// Returns true if a study set was deleted. Quiz results from it are kept.
async function deleteStudySet(userId, id) {
  if (!UUID.test(id)) return false;
  const { data, error } = await db()
    .from("study_sets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  return data.length > 0;
}

module.exports = {
  userFromToken, saveAttempt, recentAttempts, answerHistory,
  saveStudySet, listStudySets, getStudySet, studySetPieces, existingStudySetIds, deleteStudySet,
};
