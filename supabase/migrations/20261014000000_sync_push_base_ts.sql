-- Optimistic concurrency for sync_push.
--
-- Until now the edit with the larger client_ts replaced the whole row, so two devices that edited different fields of one
-- record offline lost one of the edits. The app now merges such rows field by field on the device (src/cloud/merge.ts),
-- but only if it sees the other device's version before it writes. Each pushed row therefore carries `base_ts`: the
-- client_ts of the cloud version the edit was made on top of. If the cloud holds another version by now, the row is NOT
-- written and is reported in `conflicts`; the device pulls, merges and pushes again.
--
-- Rows without base_ts (new records, older app versions) behave exactly as before.
create or replace function public.sync_push(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  r jsonb;
  n_applied int := 0;
  n_stale int := 0;
  v_conflicts jsonb := '[]'::jsonb;
  got int;
  v_tbl text;
  v_data jsonb;
  v_deleted boolean;
  v_ts bigint;
  v_base bigint;
  v_current bigint;
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
      v_data := v_data - 'ai' - 'stt' - 'voice';
    end if;
    v_ts := greatest(0, least(coalesce((r->>'client_ts')::bigint, 0), v_max_ts));
    v_base := case when r ? 'base_ts' and jsonb_typeof(r->'base_ts') = 'number' then (r->>'base_ts')::bigint else null end;

    if v_base is not null then
      -- Lock the row so that two devices pushing at the same moment are decided one after the other.
      select t.client_ts into v_current
        from public.records t
       where t.user_id = uid and t.tbl = v_tbl and t.id = r->>'id'
       for update;
      if found and v_current <> v_base then
        v_conflicts := v_conflicts || to_jsonb(v_tbl || ':' || (r->>'id'));
        continue;
      end if;
    end if;

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

  return jsonb_build_object('applied', n_applied, 'stale', n_stale, 'conflicts', v_conflicts);
end;
$function$;
