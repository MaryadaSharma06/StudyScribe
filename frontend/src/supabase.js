import { createClient } from "@supabase/supabase-js";

// Supabase handles sign-up and sign-in. Set both values in frontend/.env.
// The publishable key is safe in the browser; the secret key must never be used here.
const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

// null when the keys are missing, so the app can explain what to set instead of crashing
export const supabase = url && key ? createClient(url, key) : null;
