import React, { useState } from "react";
import { supabase } from "./supabase";

// Sign-up and sign-in through Supabase. App notices the new session on its own.
export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const handleSubmit = async () => {
    if (!supabase) return setError("Sign-in is not set up. Add the Supabase URL and publishable key to frontend/.env.");
    if (!email || !password) return setError("Please enter your email and password.");

    setBusy(true);
    setError(null);
    setNotice(null);

    if (isLogin) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) setError(signInError.message);
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else if (!data.session) {
        // Email confirmation is switched on in Supabase, so there is no session until the link is clicked
        setNotice("Check your email and click the confirmation link, then sign in.");
        setIsLogin(true);
      }
    }
    setBusy(false);
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-left">
        <div className="auth-brand auth-brand-dark"><span className="brand-mark">S</span><span>StudyScribe</span></div>
        <div className="auth-form-wrap">
          <span className="eyebrow">Your personal study desk</span>
          <h1>{isLogin ? "Welcome back" : "Start learning smarter"}</h1>
          <p className="auth-intro">{isLogin ? "Pick up where you left off and turn your next file into momentum." : "Create an account and turn dense material into clear, useful study tools."}</p>
          <form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} placeholder={isLogin ? "Enter your password" : "At least 6 characters"} value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p className="auth-message auth-error" role="alert">{error}</p>}
            {notice && <p className="auth-message">{notice}</p>}
            <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Please wait..." : isLogin ? "Sign In" : "Sign Up"}</button>
          </form>
          <p className="switch" onClick={switchMode}>{isLogin ? "Don't have an account? Sign Up" : "Already have an account? Login"}</p>
        </div>
        <p className="auth-footnote">Private by design · Built for focused learning</p>
      </div>

      <div className="auth-right">
        <div className="auth-right-content">
          <span className="eyebrow eyebrow-light">A clearer way to study</span>
          <h2>Make every page<br /><em>count.</em></h2>
          <p>Notes, flashcards, and quizzes made from the material you already have.</p>
          <div className="auth-feature-list"><span><b>01</b> Upload your material</span><span><b>02</b> Get your study set</span><span><b>03</b> Learn at your pace</span></div>
        </div>
        <img src="/signin.png" alt="StudyScribe study workspace" className="auth-img" />
        <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      </div>
    </div>
  );
}
