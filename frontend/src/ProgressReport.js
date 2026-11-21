import React from "react";

const LEVELS = [
  { id: "mastered", label: "Mastered" },
  { id: "learning", label: "Learning" },
  { id: "weak", label: "Weak" },
  { id: "new", label: "Not enough answers" },
];

const TREND_LABELS = { improving: "Improving ↑", slipping: "Slipping ↓", steady: "Steady →", unknown: "Not enough quizzes yet" };

const longDate = (value) => new Date(value).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
const shortDate = (value) => new Date(value).toLocaleDateString([], { day: "numeric", month: "short" });
// "2026-11-21" is a calendar day, so it is read as local midnight rather than UTC
const fromDay = (day) => new Date(`${day}T00:00:00`);
const pct = (value) => (value === null || value === undefined ? "–" : `${value}%`);

function ConceptList({ items, empty, tone }) {
  if (items.length === 0) return <p className="report-empty">{empty}</p>;
  return (
    <ul className={`report-concepts tone-${tone}`}>
      {items.map((c) => (
        <li key={c.name}>
          <div className="report-concept-head"><strong>{c.name}</strong><span>{Math.round(c.mastery * 100)}%</span></div>
          <div className="report-bar"><span style={{ width: `${Math.round(c.mastery * 100)}%` }} /></div>
          <small>{c.correct} of {c.answers} answers right</small>
        </li>
      ))}
    </ul>
  );
}

// Score of each recent quiz as a bar, oldest on the left
function ScoreTrend({ timeline }) {
  const width = 600;
  const height = 180;
  const top = 10;
  const bottom = 24;
  const left = 34;
  const plot = height - top - bottom;
  const slot = (width - left) / timeline.length;
  const bar = Math.min(34, slot * 0.6);
  const y = (score) => top + plot * (1 - score / 100);

  return (
    <svg className="report-chart" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Scores of your last ${timeline.length} quizzes: ${timeline.map((p) => `${p.score}%`).join(", ")}`}>
      {[0, 50, 100].map((mark) => (
        <g key={mark}>
          <line x1={left} x2={width} y1={y(mark)} y2={y(mark)} className="chart-grid" />
          <text x={left - 6} y={y(mark) + 4} textAnchor="end" className="chart-label">{mark}%</text>
        </g>
      ))}
      {timeline.map((point, i) => {
        const x = left + slot * i + (slot - bar) / 2;
        return (
          <g key={point.id}>
            <title>{`${point.practice ? "Practice" : "Quiz"} · ${point.fileName || "Unknown file"} · ${shortDate(point.createdAt)} · ${point.score}%`}</title>
            <rect x={x} y={y(point.score)} width={bar} height={Math.max(2, plot * point.score / 100)} rx="2"
              className={point.practice ? "chart-bar practice" : "chart-bar"} />
            <text x={x + bar / 2} y={height - 8} textAnchor="middle" className="chart-label">{shortDate(point.createdAt)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ProgressReport({ report, error, email, onRetry }) {
  if (error) {
    return (
      <div className="error-banner">
        {error} <button className="app-button secondary-button report-retry" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!report) return <p className="app-loading">Preparing your report...</p>;

  const { overview, levels, strengths, weaknesses, almost, byDifficulty, byFile, timeline, trend, revision, remarks } = report;

  if (overview.questionsAnswered === 0 && overview.quizzes + overview.practiceRounds === 0) {
    return (
      <section className="panel report-panel">
        <h2>No results yet</h2>
        <p className="report-empty">Take a quiz on one of your study sets. Your report will then show your scores, your strong and weak concepts, and how you improve over time.</p>
      </section>
    );
  }

  const levelTotal = Object.values(levels).reduce((sum, n) => sum + n, 0);

  const stats = [
    ["Overall score", pct(overview.accuracy), "of all quiz questions"],
    ["Questions answered", overview.questionsAnswered, `${overview.correctAnswers} right`],
    ["Quizzes taken", overview.quizzes, `+ ${overview.practiceRounds} practice ${overview.practiceRounds === 1 ? "round" : "rounds"}`],
    ["Concepts studied", overview.conceptsStudied, `${levels.mastered} mastered`],
    ["Study days", overview.studyDays, overview.firstActivity ? `since ${shortDate(fromDay(overview.firstActivity))}` : ""],
    ["Day streak", overview.streak, overview.streak === 1 ? "day in a row" : "days in a row"],
  ];

  return (
    <div className="report">
      <section className="panel report-cover">
        <div className="report-cover-row">
          <div>
            <span className="section-kicker">StudyScribe · Progress report</span>
            <h2>Study progress report</h2>
            <dl className="report-meta">
              <div><dt>Student</dt><dd>{email}</dd></div>
              <div><dt>Report date</dt><dd>{longDate(report.generatedAt)}</dd></div>
              {overview.firstActivity && (
                <div><dt>Period</dt><dd>{shortDate(fromDay(overview.firstActivity))} – {shortDate(fromDay(overview.lastActivity))}</dd></div>
              )}
            </dl>
          </div>
          <button className="app-button secondary-button no-print" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>

        <div className="report-stats">
          {stats.map(([label, value, note]) => (
            <div key={label} className="report-stat">
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{note}</small>
            </div>
          ))}
        </div>
      </section>

      {remarks.length > 0 && (
        <section className="panel report-remarks">
          <div className="panel-head"><div><span className="section-kicker">In short</span><h2>Summary</h2></div></div>
          <ul>{remarks.map((remark) => <li key={remark}>{remark}</li>)}</ul>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div><span className="section-kicker">Concept mastery</span><h2>Where you stand</h2></div>
          <span className="result-count">{levelTotal} {levelTotal === 1 ? "concept" : "concepts"}</span>
        </div>
        {levelTotal > 0 && (
          <>
            <div className="level-strip" role="img" aria-label={LEVELS.map((l) => `${levels[l.id]} ${l.label.toLowerCase()}`).join(", ")}>
              {LEVELS.filter((l) => levels[l.id] > 0).map((l) => (
                <span key={l.id} className={`level-${l.id}`} style={{ flexGrow: levels[l.id] }} />
              ))}
            </div>
            <ul className="level-legend">
              {LEVELS.map((l) => <li key={l.id} className={`level-${l.id}`}><b>{levels[l.id]}</b> {l.label}</li>)}
            </ul>
          </>
        )}
      </section>

      <div className="report-columns">
        <section className="panel report-strong">
          <div className="panel-head"><div><span className="section-kicker">Strong points</span><h2>What you know well</h2></div></div>
          <ConceptList items={strengths} tone="strong" empty="No concept is mastered yet. A concept counts as mastered at 75% after at least three answers." />
        </section>
        <section className="panel report-weak">
          <div className="panel-head"><div><span className="section-kicker">Weak points</span><h2>What needs more work</h2></div></div>
          <ConceptList items={weaknesses} tone="weak" empty="No weak concepts right now. Well done!" />
        </section>
      </div>

      {almost.length > 0 && (
        <section className="panel">
          <div className="panel-head"><div><span className="section-kicker">Almost there</span><h2>Still learning</h2></div></div>
          <ConceptList items={almost} tone="learning" empty="" />
        </section>
      )}

      {timeline.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div><span className="section-kicker">Over time</span><h2>Quiz scores</h2></div>
            <span className={`trend-badge trend-${trend.direction}`}>{TREND_LABELS[trend.direction]}</span>
          </div>
          <ScoreTrend timeline={timeline} />
          <p className="chart-key"><span className="key-quiz" /> Quiz <span className="key-practice" /> Practice round · last {timeline.length}</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><div><span className="section-kicker">By difficulty</span><h2>Easy, medium and hard questions</h2></div></div>
        <ul className="difficulty-bars">
          {byDifficulty.map((d) => (
            <li key={d.difficulty} className={`difficulty-${d.difficulty}`}>
              <span className="difficulty-name">{d.difficulty}</span>
              <div className="report-bar"><span style={{ width: `${d.accuracy || 0}%` }} /></div>
              <span className="difficulty-score">{d.answers > 0 ? `${d.accuracy}% · ${d.correct}/${d.answers}` : "No answers yet"}</span>
            </li>
          ))}
        </ul>
      </section>

      {byFile.length > 0 && (
        <section className="panel">
          <div className="panel-head"><div><span className="section-kicker">By study set</span><h2>Results for each file</h2></div></div>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>File</th><th>Answers</th><th>Score</th><th>Concepts</th><th>Last studied</th></tr></thead>
              <tbody>
                {byFile.map((f) => (
                  <tr key={f.docId || f.fileName}>
                    <td title={f.fileName}>{f.fileName}</td>
                    <td>{f.answers}</td>
                    <td>{pct(f.accuracy)}</td>
                    <td>{f.concepts}</td>
                    <td>{f.lastStudied ? shortDate(f.lastStudied) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="report-footnote">
        {revision.due > 0
          ? `${revision.due} ${revision.due === 1 ? "concept is" : "concepts are"} due for revision today. `
          : revision.next ? `Next revision: ${revision.next.name} on ${shortDate(revision.next.dueAt)}. ` : ""}
        Mastery is worked out from every saved answer; recent answers count more, and a concept needs at least three answers before it is judged.
      </p>
    </div>
  );
}
