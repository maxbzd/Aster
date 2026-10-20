-- Мост между приложениями (Aster ↔ Орбита): подключение по коду, обмен «витринами» данных.
-- Тот же файл применяется в обоих проектах Supabase. Подробности — docs/BRIDGE.md.
--
-- Идея: каждое приложение публикует у себя «витрину» (bridge_feed) в нейтральном формате. Второе приложение
-- читает её анонимно, по длинному ключу доступа (токену), который выдан при подключении. Ключ хранится
-- только как хэш, привязан к одному аккаунту и разрешённым видам данных и отзывается в любой момент.

create sequence if not exists public.bridge_feed_seq;

-- Соответствие вида данных и разрешения (scope), по которому владелец включает/выключает обмен.
create or replace function public.bridge_scope_of(p_entity text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_entity
    when 'person' then 'people'
    when 'person_stats' then 'people'
    when 'commitment' then 'commitments'
    when 'commitment_state' then 'commitments'
    when 'capture' then 'captures'
    when 'fact' then 'facts'
  end
$$;

create table public.bridge_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  peer_label    text not null default '',
  -- ключ, по которому ДРУГОЕ приложение читает мою витрину (хранится только хэш)
  inbound_hash  text unique,
  scopes        text[] not null default '{people,commitments,captures,facts}',
  -- как читаю витрину другого приложения я
  peer_url      text,
  peer_key      text,
  outbound_token text,
  created_at    timestamptz not null default now(),
  last_read_at  timestamptz,
  constraint bridge_scopes_known check (scopes <@ array['people','commitments','captures','facts']::text[]),
  constraint bridge_peer_url_https check (peer_url is null or peer_url ~ '^https://[^\s]+$')
);
create index bridge_connections_user_idx on public.bridge_connections (user_id);

create table public.bridge_offers (
  code_hash  text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null default '',
  scopes     text[] not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.bridge_feed (
  user_id    uuid not null references auth.users (id) on delete cascade,
  entity     text not null,
  key        text not null,
  scope      text not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_ms bigint not null default 0,
  seq        bigint not null default nextval('public.bridge_feed_seq'),
  primary key (user_id, entity, key),
  constraint bridge_feed_entity_known check (public.bridge_scope_of(entity) is not null),
  constraint bridge_feed_key_len check (char_length(key) between 1 and 200),
  constraint bridge_feed_live_has_data check (deleted or jsonb_typeof(data) = 'object'),
  constraint bridge_feed_size check (data is null or pg_column_size(data) <= 200000)
);
create unique index bridge_feed_user_seq_idx on public.bridge_feed (user_id, seq);

-- Какой человек в этом приложении = какой человек в другом (общая для всех устройств аккаунта).
create table public.bridge_links (
  user_id    uuid not null references auth.users (id) on delete cascade,
  local_id   text not null,
  peer_id    text not null,
  origin     text not null default 'user',
  deleted    boolean not null default false,
  updated_ms bigint not null default 0,
  primary key (user_id, local_id),
  constraint bridge_links_origin check (origin in ('auto', 'user')),
  constraint bridge_links_len check (char_length(local_id) <= 200 and char_length(peer_id) <= 200)
);
create index bridge_links_peer_idx on public.bridge_links (user_id, peer_id);

alter table public.bridge_connections enable row level security;
alter table public.bridge_offers enable row level security;
alter table public.bridge_feed enable row level security;
alter table public.bridge_links enable row level security;

create policy "bridge_connections: своё" on public.bridge_connections for select to authenticated using (user_id = (select auth.uid()));
create policy "bridge_links: своё" on public.bridge_links for select to authenticated using (user_id = (select auth.uid()));
-- bridge_offers и bridge_feed напрямую клиентам не открыты вовсе (только через функции).

revoke all on public.bridge_connections, public.bridge_offers, public.bridge_feed, public.bridge_links from anon, authenticated, public;
grant select on public.bridge_connections, public.bridge_links to authenticated;

create or replace function public.bridge_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

create or replace function public.bridge_random(p_prefix text, p_bytes int)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_prefix || left(replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), p_bytes * 2)
$$;

-- 1. Создать одноразовый код подключения (10 минут). Возвращает сам код — он показывается один раз.
create or replace function public.bridge_create_offer(p_label text, p_scopes text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_code text := public.bridge_random('bo_', 24);
  v_exp timestamptz := now() + interval '10 minutes';
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (p_scopes <@ array['people','commitments','captures','facts']::text[]) then
    raise exception 'unknown scope' using errcode = '22023';
  end if;
  delete from public.bridge_offers where user_id = uid and expires_at < now();
  if (select count(*) from public.bridge_offers where user_id = uid) >= 5 then
    raise exception 'too many active codes' using errcode = '22023';
  end if;
  if (select count(*) from public.bridge_connections where user_id = uid) >= 5 then
    raise exception 'too many connections' using errcode = '22023';
  end if;
  insert into public.bridge_offers (code_hash, user_id, label, scopes, expires_at)
  values (public.bridge_hash(v_code), uid, left(coalesce(p_label, ''), 60), p_scopes, v_exp);
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end;
$$;

-- 2. Принимающая сторона заранее заводит у себя запись «входящего» ключа (хэш) и получает её id.
create or replace function public.bridge_register(p_hash text, p_scopes text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad hash' using errcode = '22023'; end if;
  if not (p_scopes <@ array['people','commitments','captures','facts']::text[]) then
    raise exception 'unknown scope' using errcode = '22023';
  end if;
  if (select count(*) from public.bridge_connections where user_id = uid) >= 5 then
    raise exception 'too many connections' using errcode = '22023';
  end if;
  insert into public.bridge_connections (user_id, inbound_hash, scopes) values (uid, p_hash, p_scopes) returning id into v_id;
  return v_id;
end;
$$;

-- 3. Принимающая сторона дописывает, как читать другое приложение.
create or replace function public.bridge_complete(p_id uuid, p_label text, p_url text, p_key text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.bridge_connections
     set peer_label = left(coalesce(p_label, ''), 60), peer_url = p_url, peer_key = p_key, outbound_token = p_token
   where id = p_id and user_id = uid;
  if not found then raise exception 'connection not found' using errcode = 'P0002'; end if;
end;
$$;

-- 4. (анонимно) Обмен кода на ключ доступа. Принимающая сторона отдаёт свой ключ, получает мой.
create or replace function public.bridge_accept(p_code text, p_label text, p_peer_url text, p_peer_key text, p_peer_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.bridge_offers%rowtype;
  v_token text := public.bridge_random('bt_', 32);
begin
  if p_code is null or p_code !~ '^bo_[0-9a-f]{48}$' then raise exception 'invalid code' using errcode = '28000'; end if;
  if p_peer_url is null or p_peer_url !~ '^https://[^\s]+$' or char_length(p_peer_url) > 200 then raise exception 'invalid peer' using errcode = '22023'; end if;
  if p_peer_token is null or p_peer_token !~ '^bt_[0-9a-f]{64}$' then raise exception 'invalid peer token' using errcode = '22023'; end if;
  if p_peer_key is null or char_length(p_peer_key) > 400 then raise exception 'invalid peer key' using errcode = '22023'; end if;

  delete from public.bridge_offers where code_hash = public.bridge_hash(p_code) and expires_at >= now() returning * into o;
  if not found then raise exception 'invalid code' using errcode = '28000'; end if;
  if (select count(*) from public.bridge_connections where user_id = o.user_id) >= 5 then
    raise exception 'too many connections' using errcode = '22023';
  end if;

  insert into public.bridge_connections (user_id, peer_label, inbound_hash, scopes, peer_url, peer_key, outbound_token)
  values (o.user_id, left(coalesce(p_label, ''), 60), public.bridge_hash(v_token), o.scopes, p_peer_url, p_peer_key, p_peer_token);

  return jsonb_build_object('token', v_token, 'label', o.label, 'scopes', o.scopes);
end;
$$;

-- 5. (анонимно) Прочитать витрину по ключу доступа. Отдаёт только разрешённые виды данных.
create or replace function public.bridge_pull(p_token text, p_after bigint default 0, p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.bridge_connections%rowtype;
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_rows jsonb;
  v_next bigint;
begin
  if p_token is null or p_token !~ '^bt_[0-9a-f]{64}$' then raise exception 'invalid token' using errcode = '28000'; end if;
  select * into c from public.bridge_connections where inbound_hash = public.bridge_hash(p_token);
  if not found then raise exception 'invalid token' using errcode = '28000'; end if;
  if c.last_read_at is null or c.last_read_at < now() - interval '30 seconds' then
    update public.bridge_connections set last_read_at = now() where id = c.id;
  end if;

  with page as (
    select entity, key, data, deleted, updated_ms, seq
      from public.bridge_feed
     where user_id = c.user_id and seq > coalesce(p_after, 0) and scope = any (c.scopes)
     order by seq
     limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object('entity', entity, 'key', key, 'data', data, 'deleted', deleted, 'updated_ms', updated_ms, 'seq', seq) order by seq), '[]'::jsonb),
         max(seq)
    into v_rows, v_next
    from page;
  return jsonb_build_object('rows', v_rows, 'next', v_next);
end;
$$;

-- 6. (анонимно) Другая сторона сообщает, что отказывается от выданного ей ключа.
create or replace function public.bridge_drop(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^bt_[0-9a-f]{64}$' then return; end if;
  delete from public.bridge_connections where inbound_hash = public.bridge_hash(p_token);
end;
$$;

-- Отключить подключение у себя (ключ доступа перестаёт работать сразу).
create or replace function public.bridge_disconnect(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.bridge_connections where id = p_id and user_id = uid;
end;
$$;

create or replace function public.bridge_set_scopes(p_id uuid, p_scopes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not (p_scopes <@ array['people','commitments','captures','facts']::text[]) then
    raise exception 'unknown scope' using errcode = '22023';
  end if;
  update public.bridge_connections set scopes = p_scopes where id = p_id and user_id = uid;
end;
$$;

-- Публикация витрины. Побеждает более новая метка; одинаковое содержимое номер (seq) не меняет.
create or replace function public.bridge_publish(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r jsonb;
  n_applied int := 0;
  got int;
  v_deleted boolean;
  v_data jsonb;
  v_ms bigint;
  v_max bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint + 60000;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 300 then raise exception 'too many items (max 300)' using errcode = '22023'; end if;

  for r in select * from jsonb_array_elements(p_items) loop
    if public.bridge_scope_of(r->>'entity') is null then raise exception 'unknown entity' using errcode = '23514'; end if;
    v_deleted := coalesce((r->>'deleted')::boolean, false);
    v_data := case when v_deleted then null else r->'data' end;
    if not v_deleted and jsonb_typeof(v_data) is distinct from 'object' then raise exception 'live item needs object data' using errcode = '23514'; end if;
    v_ms := greatest(0, least(coalesce((r->>'updated_ms')::bigint, 0), v_max));

    insert into public.bridge_feed as t (user_id, entity, key, scope, data, deleted, updated_ms)
    values (uid, r->>'entity', r->>'key', public.bridge_scope_of(r->>'entity'), v_data, v_deleted, v_ms)
    on conflict (user_id, entity, key) do update
      set data = excluded.data, deleted = excluded.deleted, updated_ms = excluded.updated_ms, seq = nextval('public.bridge_feed_seq')
      where excluded.updated_ms > t.updated_ms
        and (t.data is distinct from excluded.data or t.deleted is distinct from excluded.deleted);
    get diagnostics got = row_count;
    n_applied := n_applied + got;
  end loop;
  return jsonb_build_object('applied', n_applied);
end;
$$;

-- Связи между людьми: пакетная запись, побеждает более новая метка.
create or replace function public.bridge_links_put(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r jsonb;
  v_max bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint + 60000;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'too many items (max 500)' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    insert into public.bridge_links as t (user_id, local_id, peer_id, origin, deleted, updated_ms)
    values (uid, r->>'local_id', r->>'peer_id', coalesce(r->>'origin', 'user'), coalesce((r->>'deleted')::boolean, false),
            greatest(0, least(coalesce((r->>'updated_ms')::bigint, 0), v_max)))
    on conflict (user_id, local_id) do update
      set peer_id = excluded.peer_id, origin = excluded.origin, deleted = excluded.deleted, updated_ms = excluded.updated_ms
      where excluded.updated_ms > t.updated_ms;
  end loop;
end;
$$;

revoke all on function public.bridge_create_offer(text, text[]), public.bridge_register(text, text[]),
  public.bridge_complete(uuid, text, text, text, text), public.bridge_disconnect(uuid), public.bridge_set_scopes(uuid, text[]),
  public.bridge_publish(jsonb), public.bridge_links_put(jsonb),
  public.bridge_accept(text, text, text, text, text), public.bridge_pull(text, bigint, int), public.bridge_drop(text),
  public.bridge_hash(text), public.bridge_random(text, int), public.bridge_scope_of(text)
  from public, anon, authenticated;

grant execute on function public.bridge_create_offer(text, text[]), public.bridge_register(text, text[]),
  public.bridge_complete(uuid, text, text, text, text), public.bridge_disconnect(uuid), public.bridge_set_scopes(uuid, text[]),
  public.bridge_publish(jsonb), public.bridge_links_put(jsonb) to authenticated;
-- Анонимные точки входа: ключ доступа проверяется внутри функций.
grant execute on function public.bridge_accept(text, text, text, text, text), public.bridge_pull(text, bigint, int), public.bridge_drop(text) to anon, authenticated;
-- Служебные функции вызываются из других функций (владельцем), права клиентам не нужны.
grant execute on function public.bridge_scope_of(text) to authenticated, anon;
