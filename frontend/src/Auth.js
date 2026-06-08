import React, { useState } from "react";

export default function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (!email || !password) return alert("Fill all fields");

    if (isLogin) {
      const user = JSON.parse(localStorage.getItem("user"));

      if (user && user.email === email && user.password === password) {
        localStorage.setItem("loggedIn", "true");
        onLogin();
      } else {
        alert("Invalid credentials");
      }
    } else {
      localStorage.setItem(
        "user",
        JSON.stringify({ email, password })
      );
      alert("Signup successful! Please login.");
      setIsLogin(true);
    }
  };

  return (
    <div className="auth-wrapper">
      {/* LEFT SIDE */}
      <div className="auth-left">
        <h2>Hello, Welcome Back </h2>
        <p>Login to continue your learning journey</p>

        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button onClick={handleSubmit}>
          {isLogin ? "Sign In" : "Sign Up"}
        </button>

        <p className="switch" onClick={() => setIsLogin(!isLogin)}>
          {isLogin
            ? "Don't have an account? Sign Up"
            : "Already have an account? Login"}
        </p>
      </div>

      {/* RIGHT SIDE */}
      <div className="auth-right">
       <img src="/signin.png" alt="login" className="auth-img" />
        <h1>StudyScribe ✨</h1>
        <p>Smart learning powered by AI</p>
      </div>
    </div>
  );
}