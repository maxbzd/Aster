-- MCP для Claude: личные ключи доступа и запись данных от имени владельца.
--
-- Ключ показывается человеку один раз при создании; в базе лежит только его SHA-256. Таблица закрыта для клиентов целиком:
-- создавать, смотреть и отзывать ключи можно только через функции ниже, а проверяет ключ Edge Function `mcp` (ключ сервиса).

create table if not exists public.mcp_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  label        text not null default 'Claude' check (char_length(label) between 1 and 60),
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id) where revoked_at is null;

alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_tokens from anon, authenticated, public;

create or replace function public.mcp_create_token(p_label text default 'Claude')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tok text;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if (select count(*) from public.mcp_tokens where user_id = uid and revoked_at is null) >= 5 then
    raise exception 'too many active keys (max 5)' using errcode = '54000';
  end if;
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.mcp_tokens (user_id, label, token_hash)
  values (uid, left(coalesce(nullif(trim(p_label), ''), 'Claude'), 60), encode(extensions.digest(tok, 'sha256'), 'hex'))
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'token', tok);
end;
$$;

create or replace function public.mcp_list_tokens()
returns table (id uuid, label text, created_at timestamptz, last_used_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return query
    select t.id, t.label, t.created_at, t.last_used_at
    from public.mcp_tokens t
    where t.user_id = auth.uid() and t.revoked_at is null
    order by t.created_at desc;
end;
$$;

create or replace function public.mcp_revoke_token(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.mcp_tokens set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null;
end;
$$;

revoke all on function public.mcp_create_token(text) from public, anon;
revoke all on function public.mcp_list_tokens() from public, anon;
revoke all on function public.mcp_revoke_token(uuid) from public, anon;
grant execute on function public.mcp_create_token(text) to authenticated;
grant execute on function public.mcp_list_tokens() to authenticated;
grant execute on function public.mcp_revoke_token(uuid) to authenticated;

-- Aster: запись в records от имени владельца для Edge Function `mcp`. Сама следит за client_ts, чтобы запись всегда была новее прежней
-- и приложения на всех устройствах её приняли. Вызывать может только сервис.
create or replace function public.mcp_put(p_user uuid, p_tbl text, p_id text, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ts bigint;
begin
  select greatest(coalesce(max(client_ts), 0) + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint)
    into ts
    from public.records
   where user_id = p_user and tbl = p_tbl and id = p_id;
  insert into public.records as t (user_id, tbl, id, data, deleted, client_ts)
  values (p_user, p_tbl, p_id, p_data, false, ts)
  on conflict (user_id, tbl, id) do update
    set data = excluded.data,
        deleted = false,
        client_ts = excluded.client_ts,
        seq = nextval('public.records_seq'),
        updated_at = now();
  return ts;
end;
$$;

revoke all on function public.mcp_put(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_put(uuid, text, text, jsonb) to service_role;
