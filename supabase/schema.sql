-- StudyScribe database setup (Phase 5).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this file -> Run.
-- It is safe to run again: existing tables, policies and data are kept.
-- When this file gains new tables, run the whole file again.

-- One row per submitted quiz or practice round
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  doc_id text,
  file_name text not null default '',
  practice boolean not null default false,
  correct integer not null check (correct >= 0),
  total integer not null check (total > 0 and correct <= total),
  created_at timestamptz not null default now()
);

-- One row per answered question. Concept mastery is worked out from these rows.
create table if not exists public.quiz_answers (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  concept text not null default '',
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  chosen text not null,
  answer text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists quiz_attempts_user_time on public.quiz_attempts (user_id, created_at desc);
create index if not exists quiz_answers_user_time on public.quiz_answers (user_id, created_at desc);
create index if not exists quiz_answers_attempt on public.quiz_answers (attempt_id);

-- Row Level Security: a signed-in student can read only their own rows.
-- There are no insert, update or delete policies, so only the backend (using the secret key) can write.
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;

drop policy if exists "Students read their own attempts" on public.quiz_attempts;
create policy "Students read their own attempts" on public.quiz_attempts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Students read their own answers" on public.quiz_answers;
create policy "Students read their own answers" on public.quiz_answers
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.quiz_attempts, public.quiz_answers from anon;
revoke insert, update, delete on public.quiz_attempts, public.quiz_answers from authenticated;
grant select on public.quiz_attempts, public.quiz_answers to authenticated;

-- ---------- Added after Phase 5: saved study sets ----------

-- One row per uploaded file: everything shown in the app, plus the document text the tutor searches
create table if not exists public.study_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null default '',
  summary text not null default '',
  notes jsonb not null default '[]',
  flashcards jsonb not null default '[]',
  quiz jsonb not null default '[]',
  knowledge jsonb,
  original_text text not null default '',
  audio text,
  pieces jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists study_sets_user_time on public.study_sets (user_id, created_at desc);

alter table public.study_sets enable row level security;

drop policy if exists "Students read their own study sets" on public.study_sets;
create policy "Students read their own study sets" on public.study_sets
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.study_sets from anon;
revoke insert, update, delete on public.study_sets from authenticated;
grant select on public.study_sets to authenticated;
