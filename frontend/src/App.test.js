import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from './App';
import { supabase } from './supabase';

jest.mock('axios');
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

const SESSION = { access_token: 'token-1', user: { id: 'user-1', email: 'student@example.com' } };
const NO_PROGRESS = { attempts: [], concepts: [] };

// Backend responses by path. A test replaces an entry before the request it expects.
let routes;
const respond = (url) => {
  const path = Object.keys(routes).find((key) => url.endsWith(key));
  if (!path) return Promise.reject(new Error(`No mock response for ${url}`));
  return Promise.resolve(routes[path]);
};
const bodiesSentTo = (path) => axios.post.mock.calls.filter(([url]) => url.endsWith(path)).map(([, body]) => body);

// Create React App resets every mock before each test, so the behaviour is set here
beforeEach(() => {
  routes = { '/attempts': { data: NO_PROGRESS }, '/progress': { data: NO_PROGRESS }, '/study-sets': { data: { studySets: [] } }, '/next-steps': { data: { steps: [] } }, '/revision': { data: { due: [], upcoming: [] } } };
  localStorage.clear();
  axios.defaults = { headers: { common: {} } };
  axios.post.mockImplementation(respond);
  axios.get.mockImplementation(respond);
  supabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
});

// Renders the app as a signed-in student and waits for the dashboard
const renderSignedIn = async () => {
  const result = render(<App />);
  await screen.findByText(/generate my study set/i);
  return result;
};

const uploadFile = (name = 'lecture.pdf') => {
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['x'], name)] } });
  fireEvent.click(screen.getByText(/generate my study set/i));
};

// Sidebar tools unlock once the upload has finished
const openView = async (name) => {
  const button = screen.getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};

test('shows the sign-in screen when nobody is signed in', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  render(<App />);
  expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});

test('signs in through Supabase and shows its error message', async () => {
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
  render(<App />);

  fireEvent.change(await screen.findByLabelText(/email address/i), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret1' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'secret1' });
});

test('shows the upload screen after signing in and sends the sign-in token to the backend', async () => {
  await renderSignedIn();
  expect(screen.getByText('student@example.com')).toBeInTheDocument();
  expect(axios.defaults.headers.common.Authorization).toBe('Bearer token-1');
  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/progress$/));
});

test('accepts Word files and no longer offers old PowerPoint files', async () => {
  const { container } = await renderSignedIn();
  const accepted = container.querySelector('input[type="file"]').accept.split(',');
  expect(accepted).toContain('.docx');
  expect(accepted).not.toContain('.ppt');
});

test('shows topics, concepts and their sources after an upload', async () => {
  routes['/upload'] = {
    data: {
      summary: 'A summary.',
      notes: ['A note'],
      flashcards: [],
      quiz: [],
      warnings: [],
      knowledge: {
        topics: [{
          name: 'Trees',
          subtopics: ['Traversal'],
          concepts: [{ name: 'Binary tree', definition: 'At most two children.', example: 'A family tree.', source: 'Page 2' }],
        }],
        relationships: [],
        coverage: { percent: 40, sections: 30, firstSource: 'Page 1', lastSource: 'Page 30' },
      },
    },
  };

  await renderSignedIn();
  uploadFile();

  await openView('Topics');
  expect(screen.getByText('Binary tree')).toBeInTheDocument();
  expect(screen.getByText('Page 2')).toBeInTheDocument();
  expect(screen.getByText(/A family tree/)).toBeInTheDocument();
  expect(screen.getByText(/about 40% of your material/)).toBeInTheDocument();
});

test('rejects an unsupported file before uploading', async () => {
  await renderSignedIn();
  uploadFile('slides.ppt');

  expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
});

test('tutor shows an answer with its source and sends the conversation with a follow-up', async () => {
  routes['/upload'] = { data: { docId: 'doc-1', summary: 'A summary.', notes: [], flashcards: [], quiz: [], warnings: [], knowledge: null } };
  await renderSignedIn();
  uploadFile();
  await openView('Tutor');

  routes['/ask'] = { data: { answer: 'Thrashing is constant page swapping.', found: true, sources: [{ source: 'Page 4', excerpt: 'Thrashing happens when' }] } };
  fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: 'What is thrashing?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

  expect(await screen.findByText('Thrashing is constant page swapping.')).toBeInTheDocument();
  expect(screen.getByText('Page 4')).toBeInTheDocument();
  expect(bodiesSentTo('/ask')[0]).toEqual({ docId: 'doc-1', question: 'What is thrashing?', history: [], level: 'simple' });

  routes['/ask'] = { data: { answer: 'The material does not cover this topic.', found: false, sources: [] } };
  fireEvent.click(screen.getByText('Give me an example'));

  expect(await screen.findByText(/not found in your material/i)).toBeInTheDocument();
  expect(bodiesSentTo('/ask')[1].history).toEqual([
    { role: 'student', text: 'What is thrashing?' },
    { role: 'tutor', text: 'Thrashing is constant page swapping.' },
  ]);
});

test('quiz explains a wrong answer, suggests a cause, and offers practice on weak concepts', async () => {
  const question = (q, concept, difficulty) => ({
    q, options: ['FCFS', 'Round Robin'], answer: 'Round Robin', difficulty, concept, explanation: 'Stored explanation.',
  });
  routes['/upload'] = {
    data: {
      docId: 'doc-1', summary: 'A summary.', notes: [], flashcards: [], warnings: [], knowledge: null, originalText: 'text',
      quiz: [question('Which uses a time quantum?', 'Round Robin', 'easy'), question('Which preempts?', 'Preemption', 'hard')],
    },
  };

  await renderSignedIn();
  uploadFile();
  await openView('Quiz');

  expect(screen.getByText('easy')).toBeInTheDocument();
  expect(screen.getByText('hard')).toBeInTheDocument();

  // First question wrong, second right
  fireEvent.click(screen.getAllByText('FCFS')[0]);
  fireEvent.click(screen.getAllByText('Round Robin')[2]);

  routes['/analyze-mistakes'] = {
    data: {
      analysis: [{ index: 0, explanation: 'FCFS has no time quantum.', category: 'knowledge_gap', evidence: 'You picked an unrelated algorithm.', source: 'Page 2' }],
      weakConcepts: [{ name: 'Round Robin', wrong: 1, difficulty: 'easy' }],
    },
  };
  fireEvent.click(screen.getByText('Submit Quiz'));

  expect(screen.getByText('Score: 1 / 2')).toBeInTheDocument();
  expect(await screen.findByText('FCFS has no time quantum.')).toBeInTheDocument();
  expect(screen.getByText(/Knowledge gap - You picked an unrelated algorithm\./)).toBeInTheDocument();
  expect(screen.getByText(/Concepts to work on:/)).toBeInTheDocument();
  const sent = bodiesSentTo('/analyze-mistakes')[0];
  expect(sent.answers).toHaveLength(2);
  expect(sent.answers[0]).toMatchObject({ index: 0, chosen: 'FCFS', answer: 'Round Robin', concept: 'Round Robin' });

  routes['/practice'] = { data: { questions: [question('What happens when the quantum expires?', 'Round Robin', 'easy')], concepts: ['Round Robin'] } };
  fireEvent.click(screen.getByText('Practice weak concepts'));

  expect(await screen.findByText(/Practice round on your weak concepts/)).toBeInTheDocument();
  expect(screen.getByText(/What happens when the quantum expires\?/)).toBeInTheDocument();
  expect(screen.queryByText(/Which preempts\?/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Back to full quiz'));
  expect(screen.getByText(/Which preempts\?/)).toBeInTheDocument();
});

test('quiz does not guess a cause when the evidence is unclear', async () => {
  routes['/upload'] = {
    data: {
      docId: 'doc-2', summary: 'S', notes: [], flashcards: [], warnings: [], knowledge: null,
      quiz: [{ q: 'Which uses a time quantum?', options: ['FCFS', 'Round Robin'], answer: 'Round Robin', difficulty: 'easy', concept: 'Round Robin', explanation: '' }],
    },
  };

  await renderSignedIn();
  uploadFile();
  await openView('Quiz');
  fireEvent.click(screen.getByText('FCFS'));

  routes['/analyze-mistakes'] = { data: { analysis: [{ index: 0, explanation: 'FCFS has no quantum.', category: 'unclear', evidence: '', source: '' }], weakConcepts: [] } };
  fireEvent.click(screen.getByText('Submit Quiz'));

  expect(await screen.findByText(/one wrong answer is not enough to tell why/)).toBeInTheDocument();
});

test('dashboard locks the tools until a file is uploaded, then saves the quiz result and shows progress', async () => {
  await renderSignedIn();

  expect(screen.getByRole('button', { name: 'Quiz' })).toBeDisabled();
  expect(screen.getByText(/upload a file to unlock/i)).toBeInTheDocument();

  routes['/upload'] = {
    data: {
      docId: 'doc-3', summary: 'The summary text.', notes: ['n1', 'n2'], flashcards: [{ q: 'a', a: 'b' }], warnings: [],
      knowledge: { topics: [{ name: 'T', subtopics: [], concepts: [{ name: 'C1', definition: 'd', example: '', source: '' }] }], relationships: [], coverage: { percent: 100, sections: 1, firstSource: 'Page 1', lastSource: 'Page 1' } },
      quiz: [{ q: 'Pick one?', options: ['A', 'B'], answer: 'A', difficulty: 'easy', concept: 'C1', explanation: '' }],
    },
  };
  uploadFile('chapter.pdf');

  // The summary opens straight after the upload
  expect(await screen.findByText('The summary text.')).toBeInTheDocument();

  routes['/attempts'] = {
    data: {
      attempts: [{ id: 'a1', fileName: 'chapter.pdf', practice: false, correct: 1, total: 1, createdAt: '2026-11-20T10:00:00Z' }],
      concepts: [{ name: 'C1', mastery: 0.6, level: 'new', answers: 1, correct: 1, lastSeen: '2026-11-20T10:00:00Z' }],
    },
  };
  await openView('Quiz');
  fireEvent.click(screen.getByText('A'));
  fireEvent.click(screen.getByText('Submit Quiz'));

  await waitFor(() => expect(bodiesSentTo('/attempts')).toHaveLength(1));
  expect(bodiesSentTo('/attempts')[0]).toMatchObject({ docId: 'doc-3', fileName: 'chapter.pdf', practice: false, total: 1 });
  expect(bodiesSentTo('/attempts')[0].answers[0]).toMatchObject({ q: 'Pick one?', chosen: 'A', answer: 'A', concept: 'C1' });

  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  expect(screen.getByRole('heading', { name: 'chapter.pdf' })).toBeInTheDocument();
  expect(screen.getByText('100% analysed')).toBeInTheDocument();
  expect(await screen.findByText('Recent quiz results')).toBeInTheDocument();
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  expect(screen.getByText('Concept mastery')).toBeInTheDocument();
  expect(screen.getByText('Not enough answers yet')).toBeInTheDocument();
});

test('a returning student sees saved progress before uploading anything', async () => {
  routes['/progress'] = {
    data: {
      attempts: [{ id: 'a1', fileName: 'os.pdf', practice: true, correct: 2, total: 4, createdAt: '2026-11-19T10:00:00Z' }],
      concepts: [
        { name: 'Deadlock', mastery: 0.3, level: 'weak', answers: 4, correct: 1, lastSeen: '2026-11-19T10:00:00Z' },
        { name: 'Paging', mastery: 0.8, level: 'mastered', answers: 5, correct: 5, lastSeen: '2026-11-19T10:00:00Z' },
      ],
    },
  };
  await renderSignedIn();

  expect(await screen.findByText('Recent quiz results')).toBeInTheDocument();
  expect(screen.getByText('2 / 4')).toBeInTheDocument();
  expect(screen.getByText(/Focus next:/).parentElement).toHaveTextContent('Deadlock');
  expect(screen.getByText('Mastered')).toBeInTheDocument();
  expect(screen.getByText('1 of 4 answers right · 30%')).toBeInTheDocument();
});

test('summary shows AI bold markers as bold text, not symbols', async () => {
  routes['/upload'] = { data: { docId: 'd', summary: 'A **process** is a program.', notes: [], flashcards: [], quiz: [], warnings: [], knowledge: null } };
  await renderSignedIn();
  uploadFile('a.pdf');

  const bold = await screen.findByText('process');
  expect(bold.tagName).toBe('STRONG');
  expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
});

test('a returning student can open a saved study set, and it reopens after a refresh', async () => {
  routes['/study-sets'] = { data: { studySets: [{ id: 'set-1', fileName: 'networks.pdf', createdAt: '2026-11-19T10:00:00Z' }] } };
  routes['/study-sets/set-1'] = {
    data: { docId: 'set-1', fileName: 'networks.pdf', summary: 'Saved summary.', notes: ['n'], flashcards: [], quiz: [], knowledge: null, warnings: [], audio: null },
  };
  const { unmount } = await renderSignedIn();

  expect(await screen.findByText('Your study sets')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));

  // Opens on the summary, with the tools unlocked
  expect(await screen.findByText('Saved summary.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Quiz' })).toBeEnabled();

  // After a refresh the same set is back, on the dashboard
  unmount();
  await renderSignedIn();
  expect(await screen.findByRole('heading', { name: 'networks.pdf' })).toBeInTheDocument();
  expect(screen.getByText('Open now')).toBeInTheDocument();
});

test('a new upload appears in the saved study sets', async () => {
  routes['/upload'] = { data: { docId: 'set-2', summary: 'S', notes: [], flashcards: [], quiz: [], warnings: [], knowledge: null } };
  await renderSignedIn();
  expect(screen.queryByText('Your study sets')).not.toBeInTheDocument();

  routes['/study-sets'] = { data: { studySets: [{ id: 'set-2', fileName: 'chapter.pdf', createdAt: '2026-11-20T10:00:00Z' }] } };
  uploadFile('chapter.pdf');
  await screen.findByText('S');

  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  expect(await screen.findByText('Your study sets')).toBeInTheDocument();
  expect(screen.getByText('Open now')).toBeInTheDocument();
});

// A saved study set with one concept and one question, opened from the dashboard
const openSavedSet = async () => {
  routes['/study-sets'] = { data: { studySets: [{ id: 'set-9', fileName: 'os.pdf', createdAt: '2026-11-20T10:00:00Z' }] } };
  routes['/study-sets/set-9'] = {
    data: {
      docId: 'set-9', fileName: 'os.pdf', summary: 'S', notes: [], flashcards: [], warnings: [], audio: null,
      knowledge: { topics: [{ name: 'Memory', subtopics: [], concepts: [{ name: 'Deadlock', definition: 'd', example: '', source: '' }] }], relationships: [], coverage: { percent: 100, sections: 1, firstSource: 'Page 1', lastSource: 'Page 1' } },
      quiz: [{ q: 'Old question?', options: ['A', 'B'], answer: 'A', difficulty: 'easy', concept: 'Deadlock', explanation: '' }],
    },
  };
  await renderSignedIn();
  fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
  await screen.findByText('S');
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
};

test('the next step starts a practice round on the concepts it chose', async () => {
  routes['/next-steps'] = {
    data: { steps: [{ action: 'practice', title: 'Practise your weak concepts', reason: 'Deadlock is below 45% mastery.', concepts: [{ name: 'Deadlock', difficulty: 'easy' }] }] },
  };
  await openSavedSet();

  expect(await screen.findByText('Practise your weak concepts')).toBeInTheDocument();
  expect(bodiesSentTo('/next-steps')[0]).toEqual({ concepts: ['Deadlock'], hasQuiz: true });

  routes['/practice-concepts'] = {
    data: { questions: [{ q: 'What causes a deadlock?', options: ['A', 'B'], answer: 'A', difficulty: 'easy', concept: 'Deadlock', explanation: '' }], concepts: ['Deadlock'] },
  };
  fireEvent.click(screen.getByRole('button', { name: /start practice/i }));

  expect(await screen.findByText(/What causes a deadlock\?/)).toBeInTheDocument();
  expect(screen.getByText(/Practice round on your weak concepts/)).toBeInTheDocument();
  expect(bodiesSentTo('/practice-concepts')).toEqual([
    { docId: 'set-9', concepts: [{ name: 'Deadlock', difficulty: 'easy' }], avoid: ['Old question?'] },
  ]);
});

test('the explain step asks the tutor to go over the concept again', async () => {
  routes['/next-steps'] = {
    data: { steps: [{ action: 'explain', title: 'Go over "Deadlock" again', reason: 'You got 0 of 4 right.', concepts: [{ name: 'Deadlock', difficulty: 'easy' }] }] },
  };
  await openSavedSet();

  routes['/ask'] = { data: { answer: 'A deadlock is when processes wait for each other forever.', found: true, sources: [] } };
  fireEvent.click(await screen.findByRole('button', { name: /explain it to me/i }));

  expect(await screen.findByText('A deadlock is when processes wait for each other forever.')).toBeInTheDocument();
  expect(bodiesSentTo('/ask')).toHaveLength(1);
  expect(bodiesSentTo('/ask')[0]).toMatchObject({ docId: 'set-9', question: expect.stringContaining('"Deadlock"') });
});

test('revision lists due concepts and Revise opens their study set with a practice round', async () => {
  routes['/revision'] = {
    data: {
      due: [
        { setId: 'set-5', fileName: 'networks.pdf', available: true, concepts: [{ name: 'TCP handshake', box: 2, dueAt: '2026-11-19T10:00:00Z', difficulty: 'hard' }] },
        { setId: 'gone', fileName: 'old.pdf', available: false, concepts: [{ name: 'Old idea', box: 1, dueAt: '2026-11-18T10:00:00Z', difficulty: 'medium' }] },
      ],
      upcoming: [{ name: 'Paging', dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), box: 3 }],
    },
  };
  routes['/study-sets/set-5'] = {
    data: { docId: 'set-5', fileName: 'networks.pdf', summary: 'S', notes: [], flashcards: [], quiz: [], knowledge: null, warnings: [], audio: null },
  };
  routes['/practice-concepts'] = {
    data: { questions: [{ q: 'What is the first packet of a TCP handshake?', options: ['SYN', 'ACK'], answer: 'SYN', difficulty: 'hard', concept: 'TCP handshake', explanation: '' }], concepts: ['TCP handshake'] },
  };
  await renderSignedIn();

  expect(await screen.findByText('Due for revision')).toBeInTheDocument();
  expect(screen.getByText(/this study set is no longer saved/)).toBeInTheDocument();
  expect(screen.getByText(/Paging in 3 days/)).toBeInTheDocument();
  // Only the set that still exists can be revised
  expect(screen.getAllByRole('button', { name: 'Revise' })).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Revise' }));

  expect(await screen.findByText(/What is the first packet of a TCP handshake\?/)).toBeInTheDocument();
  expect(bodiesSentTo('/practice-concepts')[0]).toMatchObject({ docId: 'set-5', concepts: [{ name: 'TCP handshake', difficulty: 'hard' }] });
});
