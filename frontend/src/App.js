import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "./App.css";
import Auth from "./Auth";
import Quiz from "./Quiz";
import { API_URL } from "./config";
import { supabase } from "./supabase";

const MAX_FILE_MB = 25;
const SUPPORTED_TYPES = [".pdf", ".pptx", ".docx", ".txt", ".mp3", ".wav", ".m4a", ".ogg"];

// Tools in the sidebar. "needsSet" tools only open once a file has been uploaded.
const VIEWS = [
  { id: "dashboard", label: "Dashboard", icon: "⌂", needsSet: false },
  { id: "summary", label: "Summary", icon: "¶", needsSet: true, title: "Summary", intro: "A lecture-style explanation of your material, with an audio version." },
  { id: "notes", label: "Notes", icon: "✎", needsSet: true, title: "Notes", intro: "Short notes to skim before a class or exam." },
  { id: "topics", label: "Topics", icon: "◎", needsSet: true, title: "Topic map", intro: "The topics and key concepts in your file, with definitions and where they appear." },
  { id: "tutor", label: "Tutor", icon: "✦", needsSet: true, title: "AI tutor", intro: "Ask questions and get answers taken only from your file." },
  { id: "flashcards", label: "Flashcards", icon: "❏", needsSet: true, title: "Flashcards", intro: "Click a card to flip it." },
  { id: "quiz", label: "Quiz", icon: "✓", needsSet: true, title: "Quiz", intro: "Test yourself, see why answers were wrong, and practise your weak concepts." },
];

// Dashboard shortcuts into the tools. Each has its own accent colour, defined in App.css.
const TOOL_TILES = [
  { view: "tutor", accent: "coral", title: "Ask the tutor", text: "Questions answered from your own file, with sources." },
  { view: "quiz", accent: "navy", title: "Take the quiz", text: "Easy, medium and hard questions on each concept." },
  { view: "topics", accent: "blue", title: "Explore the topic map", text: "Concepts, definitions and how they connect." },
  { view: "flashcards", accent: "sage", title: "Review flashcards", text: "Quick recall practice, one card at a time." },
  { view: "summary", accent: "amber", title: "Read the summary", text: "The whole file explained, with audio." },
  { view: "notes", accent: "plum", title: "Skim the notes", text: "The key points in a few lines each." },
];

// Shows AI text readably: **bold** becomes bold, and a long block is split into paragraphs.
// Built from React elements, never raw HTML, so text from the AI cannot inject markup.
function withBold(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

function RichText({ text }) {
  let paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // One long block: start a new paragraph every four sentences
  if (paragraphs.length === 1 && text.length > 800) {
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
    paragraphs = [];
    for (let i = 0; i < sentences.length; i += 4) paragraphs.push(sentences.slice(i, i + 4).join("").trim());
  }

  return paragraphs.map((paragraph, i) => <p key={i}>{withBold(paragraph)}</p>);
}

const MASTERY_LABELS = { new: "Not enough answers yet", weak: "Weak", learning: "Learning", mastered: "Mastered" };

const formatDate = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Which study set to reopen after a refresh. Only a convenience for this browser, so failures are ignored.
const lastSetKey = (userId) => `studyscribe.lastSet.${userId}`;
function readLastSet(userId) {
  try {
    return localStorage.getItem(lastSetKey(userId));
  } catch {
    return null;
  }
}
function writeLastSet(userId, id) {
  try {
    if (id) localStorage.setItem(lastSetKey(userId), id);
    else localStorage.removeItem(lastSetKey(userId));
  } catch {
    // Storage blocked: the set just will not reopen by itself
  }
}

export default function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadStage, setUploadStage] = useState("idle");
  const [uploadPopupVisible, setUploadPopupVisible] = useState(false);
  const [view, setView] = useState("dashboard");
  const [data, setData] = useState({});
  const [progress, setProgress] = useState(null);   // saved attempts and concept mastery, from the backend
  const [studySets, setStudySets] = useState([]);   // the student's saved uploads, newest first

  const [errorMessage, setErrorMessage] = useState(null);
  const [session, setSession] = useState(undefined);   // undefined while checking, null when signed out

  const hasSet = Object.keys(data).length > 0;
  const userId = session?.user?.id;

  // Every backend request carries the sign-in token. Signing out clears the previous student's work.
  useEffect(() => {
    if (!supabase) return setSession(null);

    const apply = (next) => {
      if (next) axios.defaults.headers.common.Authorization = `Bearer ${next.access_token}`;
      else {
        delete axios.defaults.headers.common.Authorization;
        setData({});
        setProgress(null);
        setStudySets([]);
        setView("dashboard");
      }
      setSession(next);
    };

    supabase.auth.getSession().then(({ data: { session: current } }) => apply(current));
    // Also fires when Supabase refreshes the token, so the header stays valid
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => apply(next));
    return () => subscription.unsubscribe();
  }, []);

  const loadProgress = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/progress`);
      setProgress(res.data);
    } catch (err) {
      setErrorMessage(err.response?.data?.error || "Your saved progress could not be loaded.");
    }
  }, []);

  const loadStudySets = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/study-sets`);
      setStudySets(res.data.studySets || []);
    } catch (err) {
      setErrorMessage(err.response?.data?.error || "Your saved study sets could not be loaded.");
    }
  }, []);

  // `quiet` is for reopening the last set after a refresh: if that fails, nothing is shown
  const openStudySet = useCallback(async (id, { quiet = false, nextView = "summary" } = {}) => {
    try {
      const res = await axios.get(`${API_URL}/study-sets/${id}`);
      setData(res.data);
      setView(nextView);
      if (!quiet) setErrorMessage(null);
      return true;
    } catch (err) {
      if (!quiet) setErrorMessage(err.response?.data?.error || "This study set could not be opened.");
      return false;
    }
  }, []);

  // On sign-in: load progress and saved sets, and reopen the set that was open last time
  useEffect(() => {
    if (!userId) return;
    loadProgress();
    loadStudySets();
    const last = readLastSet(userId);
    if (last) openStudySet(last, { quiet: true, nextView: "dashboard" }).then((opened) => opened || writeLastSet(userId, null));
  }, [userId, loadProgress, loadStudySets, openStudySet]);

  useEffect(() => {
    if (userId && data.docId) writeLastSet(userId, data.docId);
  }, [userId, data.docId]);

  const removeStudySet = async (set) => {
    if (!window.confirm(`Delete "${set.fileName}"? Your quiz results from it are kept.`)) return;
    try {
      await axios.delete(`${API_URL}/study-sets/${set.id}`);
      setStudySets((prev) => prev.filter((item) => item.id !== set.id));
      if (data.docId === set.id) {
        setData({});
        writeLastSet(userId, null);
      }
    } catch (err) {
      setErrorMessage(err.response?.data?.error || "This study set could not be deleted.");
    }
  };

  const saveAttempt = async (result) => {
    if (result.answers.length === 0) return;
    try {
      const res = await axios.post(`${API_URL}/attempts`, {
        docId: data.docId,
        fileName: data.fileName,
        practice: result.practice,
        total: result.total,
        answers: result.answers,
      });
      setProgress(res.data);
    } catch (err) {
      setErrorMessage(err.response?.data?.error || "Your quiz result could not be saved.");
    }
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select a file");

    const fileName = file.name.toLowerCase();
    if (!SUPPORTED_TYPES.some((type) => fileName.endsWith(type))) {
      return setErrorMessage("Unsupported file type. Use PDF, PPTX, DOCX, TXT, MP3, WAV, M4A or OGG.");
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return setErrorMessage(`File is too large. The limit is ${MAX_FILE_MB} MB.`);
    }

    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);

    const stageTimeouts = [];

    try {
      setLoading(true);
      setUploadPopupVisible(true);
      setUploadStage("loading");

      stageTimeouts.push(
        setTimeout(() => setUploadStage("processing"), 800)
      );
      stageTimeouts.push(
        setTimeout(() => setUploadStage("generating"), 1600)
      );

      const res = await axios.post(`${API_URL}/upload`, formData);
      const result = res.data;

      setData({ ...result, fileName: file.name });
      setView("summary");
      loadStudySets();
      setErrorMessage(result?.warnings?.join(" ") || null);
      setUploadStage("done");
      setTimeout(() => setUploadPopupVisible(false), 700);
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setUploadPopupVisible(false);
      const apiError = err.response?.data?.error || err.response?.data?.details;
      const networkError = !err.response && "Could not reach the server. Check your connection and try again.";
      setErrorMessage(apiError || networkError || err.message || "Upload failed");
    } finally {
      stageTimeouts.forEach(clearTimeout);
    }
  };

  const uploadStageLabel = {
    idle: "Ready to upload your file",
    loading: "Uploading file...",
    processing: "Processing the content...",
    generating: "Generating your study notes...",
    done: "All set!"
  }[uploadStage];

  if (session === undefined) return <p className="app-loading">Loading...</p>;
  if (!session) return <Auth />;

  const current = VIEWS.find((item) => item.id === view);
  const conceptNames = (data?.knowledge?.topics || []).flatMap((topic) => topic.concepts.map((c) => c.name));
  const email = session.user.email;
  const attempts = progress?.attempts || [];
  const concepts = progress?.concepts || [];
  const focusNext = concepts.filter((concept) => concept.level === "weak").slice(0, 5);

  // Shown first on the dashboard before any upload, and last once a study set exists
  const uploadBox = (
    <section className="upload-box">
      <div className="upload-heading"><div><span className="section-kicker">{hasSet ? "Start a new study set" : "Create a study set"}</span><h2>What are you working on?</h2></div><span className="secure-note">✦ AI-powered</span></div>
      <div className="upload-dropzone"><div className="upload-icon">↑</div><div><strong>{file ? file.name : "Choose a file to get started"}</strong><span>Browse from your device</span></div><label className="browse-button">Browse<input type="file" accept={SUPPORTED_TYPES.join(",")} onChange={(e) => setFile(e.target.files[0])} /></label></div>
      <div className="input-group">
        <button className="app-button primary-button" onClick={handleUpload} disabled={loading}>
          Generate my study set <span className="button-arrow">→</span>
        </button>
      </div>
      <div className="upload-meta"><span>Supported formats</span><strong>PDF · PPTX · DOCX · TXT · MP3 · WAV · M4A · OGG</strong><span className="size-note">Max 25 MB</span></div>
    </section>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark">S</span><span>StudyScribe</span></div>

        <nav className="side-nav" aria-label="Study tools">
          {[["Workspace", VIEWS.filter((item) => !item.needsSet)], ["Study tools", VIEWS.filter((item) => item.needsSet)]].map(([group, items]) => (
            <div key={group} className="nav-group">
              <span className="nav-heading">{group}</span>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${view === item.id ? "active" : ""}`}
                  onClick={() => setView(item.id)}
                  disabled={item.needsSet && !hasSet}
                  title={item.needsSet && !hasSet ? "Upload a file first" : undefined}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
          {!hasSet && <p className="nav-hint">Upload a file to unlock the study tools.</p>}
        </nav>

        <div className="sidebar-footer">
          {email && <span className="user-email" title={email}>{email}</span>}
          <button
            className="nav-item"
            onClick={() => supabase.auth.signOut()}
          >
            <span className="nav-icon" aria-hidden="true">↪</span>
            Log out
          </button>
        </div>
      </aside>

      <main className="main">
        {errorMessage && <div className="error-banner">{errorMessage}</div>}

        {/* DASHBOARD */}
        {/* Before the first upload the page leads with the upload box.
            Once a study set exists it leads with that set, and the upload box moves to the end. */}
        {view === "dashboard" && (
          <>
            {hasSet ? (
              <header className="view-head">
                <span className="section-kicker">Dashboard</span>
                <h2>Welcome back.</h2>
                <p>Your study set is ready. Pick a tool, or upload a new file below.</p>
              </header>
            ) : (
              <section className="home-hero">
                <div><span className="eyebrow">AI study workspace</span><h1 className="title">Learn from your<br /><em>source material.</em></h1><p className="hero-copy">Drop in a lecture, chapter, or recording. StudyScribe turns it into notes, a topic map, a tutor, flashcards, and questions that adapt to you.</p></div>
                <div className="hero-stamp"><span>⌁</span><strong>01</strong><small>UPLOAD<br />TO LEARN</small></div>
              </section>
            )}

            {!hasSet && uploadBox}

            {hasSet && (
              <section className="panel">
                <div className="panel-head">
                  <div><span className="section-kicker">Current study set</span><h2>{data.fileName}</h2></div>
                  {data.knowledge?.coverage && <span className="result-count">{data.knowledge.coverage.percent}% analysed</span>}
                </div>
                <div className="stat-row">
                  {[
                    ["Concepts", conceptNames.length],
                    ["Notes", Array.isArray(data.notes) ? data.notes.length : 0],
                    ["Flashcards", (data.flashcards || []).length],
                    ["Quiz questions", (data.quiz || []).length],
                  ].map(([label, value]) => (
                    <div key={label} className="stat"><strong>{value}</strong><span>{label}</span></div>
                  ))}
                </div>
              </section>
            )}

            {studySets.length > 0 && (
              <section className="panel">
                <div className="panel-head">
                  <div><span className="section-kicker">Saved to your account</span><h2>Your study sets</h2></div>
                  <span className="result-count">{studySets.length} saved</span>
                </div>
                <ul className="set-list">
                  {studySets.map((set) => (
                    <li key={set.id} className={set.id === data.docId ? "set-item current" : "set-item"}>
                      <div>
                        <strong title={set.fileName}>{set.fileName || "Untitled file"}</strong>
                        <span>{formatDate(set.createdAt)}</span>
                      </div>
                      {set.id === data.docId
                        ? <span className="set-open-now">Open now</span>
                        : <button className="app-button secondary-button" onClick={() => openStudySet(set.id)}>Open</button>}
                      <button className="set-delete" onClick={() => removeStudySet(set)} aria-label={`Delete ${set.fileName}`} title="Delete">×</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="panel">
              <div className="panel-head"><div><span className="section-kicker">Study tools</span><h2>Pick up where you want.</h2></div></div>
              <div className="tile-grid">
                {TOOL_TILES.map((tile) => {
                  const tool = VIEWS.find((item) => item.id === tile.view);
                  return (
                    <button key={tile.view} className={`tile accent-${tile.accent}`} onClick={() => setView(tile.view)} disabled={!hasSet}>
                      <span className="tile-icon" aria-hidden="true">{tool.icon}</span>
                      <strong>{tile.title}</strong>
                      <span className="tile-text">{tile.text}</span>
                      {hasSet ? <span className="tile-go">Open →</span> : <span className="tile-lock">Upload a file first</span>}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Saved in Supabase, so it is still here after a refresh or on another device */}
            {attempts.length > 0 && (
              <section className="panel">
                <div className="panel-head">
                  <div><span className="section-kicker">Your progress</span><h2>Recent quiz results</h2></div>
                  <span className="result-count">Saved to your account</span>
                </div>
                <div className="attempt-list">
                  {attempts.slice(0, 6).map((attempt) => (
                    <div key={attempt.id} className="attempt">
                      <span className="attempt-kind">{attempt.practice ? "Practice" : "Quiz"}</span>
                      <strong>{attempt.correct} / {attempt.total}</strong>
                      <span>{Math.round((attempt.correct / attempt.total) * 100)}% · {formatDate(attempt.createdAt)}</span>
                      {attempt.fileName && <span className="attempt-file" title={attempt.fileName}>{attempt.fileName}</span>}
                    </div>
                  ))}
                </div>
                {focusNext.length > 0 && (
                  <div className="weak-concepts">
                    <b>Focus next:</b> {focusNext.map((concept) => concept.name).join(", ")}
                    {hasSet && <button className="app-button secondary-button" onClick={() => setView("quiz")}>Go to quiz</button>}
                  </div>
                )}
              </section>
            )}

            {concepts.length > 0 && (
              <section className="panel">
                <div className="panel-head">
                  <div><span className="section-kicker">Your progress</span><h2>Concept mastery</h2></div>
                  <span className="result-count">Weakest first</span>
                </div>
                <p className="mastery-note">Worked out from every quiz answer you have saved. Recent answers count more, and a concept needs at least three answers before it is judged.</p>
                <ul className="mastery-list">
                  {concepts.slice(0, 12).map((concept) => (
                    <li key={concept.name} className={`mastery-item level-${concept.level}`}>
                      <div className="mastery-head">
                        <strong>{concept.name}</strong>
                        <span className="mastery-level">{MASTERY_LABELS[concept.level]}</span>
                      </div>
                      <div className="mastery-bar" role="img" aria-label={`${Math.round(concept.mastery * 100)}% mastery`}>
                        <span style={{ width: `${Math.round(concept.mastery * 100)}%` }} />
                      </div>
                      <small>{concept.correct} of {concept.answers} answers right · {Math.round(concept.mastery * 100)}%</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {hasSet && uploadBox}
          </>
        )}

        {/* TOOL VIEWS */}
        {hasSet && current?.needsSet && (
          <header className="view-head">
            <span className="section-kicker">Your study set · {data.fileName}</span>
            <h2>{current.title}</h2>
            <p>{current.intro}</p>
          </header>
        )}

        {hasSet && (
          <div className="card" hidden={!current?.needsSet}>
            {/* SUMMARY */}
            {view === "summary" && (
              <>
                {data?.summary ? <RichText text={data.summary} /> : <p>No summary available</p>}

                {data?.audio ? (
                  <audio
                    controls
                    src={`${API_URL}${data.audio}`}
                    style={{ marginTop: "15px", width: "100%" }}
                  />
                ) : (
                  <div className="error-banner">
                    <strong>Audio unavailable</strong>
                    {data?.audioError && <div>Reason: {data.audioError}</div>}
                  </div>
                )}
              </>
            )}

            {/* NOTES */}
            {view === "notes" && (
              <ul>
                {data?.notes
                  ? typeof data.notes === "string"
                    ? data.notes
                        .split(/\n|\. /)
                        .filter((l) => l.trim())
                        .map((l, i) => <li key={i}>{l}</li>)
                    : data.notes.map((l, i) => <li key={i}>{withBold(String(l))}</li>)
                  : <li>No notes available.</li>}
              </ul>
            )}

            {/* TOPICS */}
            {view === "topics" && <KnowledgeMap knowledge={data?.knowledge} />}

            {/* TUTOR */}
            {/* Kept on the page but hidden in other views, so the conversation survives switching.
                The key gives each uploaded document its own fresh conversation. */}
            <div hidden={view !== "tutor"}><Tutor key={data?.docId} docId={data?.docId} /></div>

            {/* FLASHCARDS */}
            {view === "flashcards" && (
              <div className="grid">
                {(data?.flashcards || []).map((f, i) => (
                  <FlipCard key={i} q={f.q} a={f.a} />
                ))}
              </div>
            )}

            {/* QUIZ */}
            {/* Hidden rather than removed in other views, so answers and the timer are kept */}
            <div hidden={view !== "quiz"}>
              <Quiz
                key={data?.docId}
                docId={data?.docId}
                initialQuestions={data?.quiz || []}
                originalText={data?.originalText}
                conceptNames={conceptNames}
                onResult={saveAttempt}
              />
            </div>
          </div>
        )}

        {uploadPopupVisible && (
          <div className="upload-popup-overlay">
            <div className="upload-popup-card">
              <div className={"popup-icon " + (uploadStage === "done" ? "popup-done" : "")}/>
              <h2>{uploadStageLabel}</h2>
              <p className="popup-subtitle">This can take up to a minute depending on file size.</p>
              <div className="popup-progress">
                {[
                  { label: "Uploading", stage: "loading" },
                  { label: "Processing", stage: "processing" },
                  { label: "Generating", stage: "generating" },
                ].map((step) => {
                  const activeStages = ["loading", "processing", "generating", "done"];
                  const isActive = activeStages.indexOf(uploadStage) >= activeStages.indexOf(step.stage);
                  return (
                    <div key={step.stage} className={"popup-step " + (isActive ? "active" : "")}>
                      <span className="step-dot" />
                      <span>{step.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const FOLLOW_UPS = ["Explain that more simply", "Give me an example", "Give me an analogy"];

function Tutor({ docId }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [level, setLevel] = useState("simple");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);

  const ask = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || asking) return;

    const history = messages.map(({ role, text }) => ({ role, text }));
    setMessages([...messages, { role: "student", text: trimmed }]);
    setQuestion("");
    setError(null);
    setAsking(true);

    try {
      const res = await axios.post(`${API_URL}/ask`, { docId, question: trimmed, history, level });
      setMessages((prev) => [...prev, { role: "tutor", text: res.data.answer, found: res.data.found, sources: res.data.sources || [] }]);
    } catch (err) {
      setError(err.response?.data?.error || "Could not reach the tutor. Please try again.");
    }
    setAsking(false);
  };

  if (!docId) return <p>The tutor is not available for this study set. Please upload the file again.</p>;

  const lastIsTutor = messages.length > 0 && messages[messages.length - 1].role === "tutor";

  return (
    <div className="tutor">
      <div className="tutor-head">
        <p>Ask anything about your material. Answers come only from the file you uploaded.</p>
        <div className="level-toggle">
          {["simple", "detailed"].map((option) => (
            <button key={option} className={level === option ? "active-level" : ""} onClick={() => setLevel(option)}>
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="chat">
        {messages.map((message, i) => (
          <div key={i} className={`chat-message ${message.role}${message.found === false ? " not-found" : ""}`}>
            <span className="chat-role">{message.role === "tutor" ? "Tutor" : "You"}</span>
            <p>{message.text}</p>
            {message.found === false && <small>This was not found in your material.</small>}
            {message.sources?.map((source) => (
              <details key={source.source} className="chat-source">
                <summary>{source.source}</summary>
                <blockquote>{source.excerpt}…</blockquote>
              </details>
            ))}
          </div>
        ))}
        {asking && <p className="chat-thinking">Tutor is reading your material...</p>}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {lastIsTutor && !asking && (
        <div className="follow-ups">
          {FOLLOW_UPS.map((text) => <button key={text} onClick={() => ask(text)}>{text}</button>)}
        </div>
      )}

      <form className="tutor-form" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
        <input
          type="text"
          value={question}
          maxLength={500}
          placeholder="Ask a question about your material"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="app-button primary-button" disabled={asking || !question.trim()}>Ask</button>
      </form>
    </div>
  );
}

function KnowledgeMap({ knowledge }) {
  if (!knowledge || knowledge.topics.length === 0) {
    return <p>No topics could be extracted from this file.</p>;
  }

  const { topics, relationships, coverage } = knowledge;
  const range = coverage.sections > 1 ? `${coverage.firstSource} to ${coverage.lastSource}` : coverage.firstSource;

  return (
    <div className="knowledge-map">
      <p className="coverage-note">
        {coverage.percent >= 100
          ? `Built from all of your material (${range}).`
          : `Built from about ${coverage.percent}% of your material, sampled evenly from ${range}. Long files are only partly analysed for now.`}
      </p>

      {topics.map((topic) => (
        <section key={topic.name} className="topic-block">
          <h3>{topic.name}</h3>

          {topic.subtopics.length > 0 && (
            <div className="subtopic-list">
              {topic.subtopics.map((subtopic) => <span key={subtopic}>{subtopic}</span>)}
            </div>
          )}

          {topic.concepts.map((concept) => (
            <div key={concept.name} className="concept-item">
              <div className="concept-head">
                <strong>{concept.name}</strong>
                {concept.source && <span className="source-tag">{concept.source}</span>}
              </div>
              <p>{concept.definition}</p>
              {concept.example && <p className="concept-example"><b>Example:</b> {concept.example}</p>}
            </div>
          ))}
        </section>
      ))}

      {relationships.length > 0 && (
        <section className="topic-block">
          <h3>How the concepts connect</h3>
          <ul className="relationship-list">
            {relationships.map((rel) => (
              <li key={`${rel.from}-${rel.to}`}>
                <strong>{rel.from}</strong> <em>{rel.relation}</em> <strong>{rel.to}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FlipCard({ q, a }) {
  const [flip, setFlip] = useState(false);

  return (
    <div className="flashcard" onClick={() => setFlip(!flip)}>
      <div className={flip ? "flip-inner flipped" : "flip-inner"}>
        <div className="front">{q}</div>
        <div className="back">{a}</div>
      </div>
    </div>
  );
}