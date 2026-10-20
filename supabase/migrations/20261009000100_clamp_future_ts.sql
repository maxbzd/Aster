-- Устройство с неверными часами (далеко в будущем) не должно навсегда «выигрывать» все конфликты:
-- метка правки не может быть позже серверного времени больше чем на минуту.
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
  v_ts bigint;
  v_max_ts bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint + 60000;
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
    v_ts := greatest(0, least(coalesce((r->>'client_ts')::bigint, 0), v_max_ts));

    insert into public.records as t (user_id, tbl, id, data, deleted, client_ts)
    values (uid, v_tbl, r->>'id', v_data, v_deleted, v_ts)
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

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
