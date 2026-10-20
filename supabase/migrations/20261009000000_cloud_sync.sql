-- Aster: облачная копия данных.
-- Одна строка = одна запись любой таблицы приложения (people, interactions, …).
-- Клиент читает через RLS, а пишет ТОЛЬКО через sync_push: проверка владельца, формата и правило «побеждает новейшая правка».

create sequence if not exists public.records_seq;

create table if not exists public.records (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text    not null,
  id         text    not null,
  data       jsonb,
  deleted    boolean not null default false,
  client_ts  bigint  not null default 0,
  seq        bigint  not null default nextval('public.records_seq'),
  updated_at timestamptz not null default now(),
  primary key (user_id, tbl, id),
  constraint records_tbl_known check (tbl in ('people','interactions','reminders','circles','settings','intros','events','captures','leads')),
  constraint records_id_len check (char_length(id) between 1 and 100),
  constraint records_live_has_data check (deleted or data is not null),
  constraint records_data_size check (data is null or pg_column_size(data) <= 3000000)
);

create unique index if not exists records_user_seq_idx on public.records (user_id, seq);

alter table public.records enable row level security;

create policy "records: читать только своё"
  on public.records for select to authenticated
  using (user_id = (select auth.uid()));

-- Прямая запись клиентам закрыта: нет политик insert/update/delete.
revoke all on public.records from anon, authenticated, public;
grant select on public.records to authenticated;

-- Пакетная запись. Побеждает правка со строго большим client_ts; ключи API из settings никогда не сохраняются.
create or replace function public.sync_push(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r jsonb;
  n_applied int := 0;
  n_stale int := 0;
  got int;
  v_tbl text;
  v_data jsonb;
  v_deleted boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(rows) is distinct from 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 500 then
    raise exception 'too many rows (max 500)' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(rows) loop
    v_tbl := r->>'tbl';
    v_deleted := coalesce((r->>'deleted')::boolean, false);
    v_data := case when v_deleted then null else r->'data' end;
    if not v_deleted and jsonb_typeof(v_data) is distinct from 'object' then
      raise exception 'live record needs object data' using errcode = '23514';
    end if;
    if v_tbl = 'settings' and v_data is not null then
      v_data := v_data - 'ai';
    end if;

    insert into public.records as t (user_id, tbl, id, data, deleted, client_ts)
    values (uid, v_tbl, r->>'id', v_data, v_deleted, coalesce((r->>'client_ts')::bigint, 0))
    on conflict (user_id, tbl, id) do update
      set data = excluded.data,
          deleted = excluded.deleted,
          client_ts = excluded.client_ts,
          seq = nextval('public.records_seq'),
          updated_at = now()
      where excluded.client_ts > t.client_ts;

    get diagnostics got = row_count;
    if got > 0 then n_applied := n_applied + 1; else n_stale := n_stale + 1; end if;
  end loop;

  return jsonb_build_object('applied', n_applied, 'stale', n_stale);
end;
$$;

-- Стереть все облачные данные вызывающего (аккаунт остаётся).
create or replace function public.delete_my_data()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n bigint;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.records where user_id = uid;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Удалить аккаунт целиком (записи уйдут каскадом).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.delete_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Живые обновления между устройствами.
alter publication supabase_realtime add table public.records;
