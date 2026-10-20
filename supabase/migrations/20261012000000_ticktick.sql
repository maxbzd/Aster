-- Связка с TickTick: токен доступа и соответствие «запись приложения ↔ задача TickTick».
-- Обоими таблицами пользуется только Edge Function `ticktick` (ключ сервиса). Для клиентов таблицы закрыты полностью.

create table if not exists public.ticktick_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.ticktick_links (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null check (char_length(key) between 3 and 160),
  -- 'pending' — ключ занят, задача в TickTick ещё создаётся
  task_id    text not null,
  project_id text not null default '',
  completed  boolean not null default false,
  gone       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.ticktick_tokens enable row level security;
alter table public.ticktick_links enable row level security;
revoke all on public.ticktick_tokens from anon, authenticated, public;
revoke all on public.ticktick_links from anon, authenticated, public;
