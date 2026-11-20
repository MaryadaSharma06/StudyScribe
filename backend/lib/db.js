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

// The student's most recent answers, oldest first, in the form conceptMastery() expects.
async function answerHistory(userId) {
  const { data, error } = await db()
    .from("quiz_answers")
    .select("concept, difficulty, is_correct, created_at")
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
  }));
}

module.exports = { userFromToken, saveAttempt, recentAttempts, answerHistory };
