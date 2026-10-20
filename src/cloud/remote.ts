import type { SupabaseClient } from '@supabase/supabase-js'
import { PermanentRemoteError, type PushRow, type Remote, type RemoteRecord, type SyncTable } from './engine'

/** Postgres/PostgREST codes for "the request is invalid": 22 data, 23 constraints, 42 permissions and syntax, PGRST1 request parsing. */
const isPermanent = (e: { code?: string; status?: number }) => /^(22|23|42|PGRST1)/.test(e.code ?? '') || e.status === 400 || e.status === 413

/** The Remote implementation on top of Supabase: reads through RLS, writes only through the sync_push function. */
export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async push(rows: PushRow[]) {
      const { data, error } = await client.rpc('sync_push', { rows })
      if (error) throw isPermanent(error as { code?: string }) ? new PermanentRemoteError(error.message) : error
      const r = (data ?? {}) as { applied?: number; stale?: number }
      return { applied: r.applied ?? 0, stale: r.stale ?? 0 }
    },
    async pull(afterSeq: number, limit: number) {
      const { data, error } = await client
        .from('records')
        .select('tbl,id,data,deleted,client_ts,seq')
        .gt('seq', afterSeq)
        .order('seq', { ascending: true })
        .limit(limit)
      if (error) throw error
      return (data ?? []).map(r => ({
        tbl: r.tbl as SyncTable,
        id: r.id as string,
        data: (r.data ?? null) as Record<string, unknown> | null,
        deleted: !!r.deleted,
        client_ts: Number(r.client_ts),
        seq: Number(r.seq),
      })) satisfies RemoteRecord[]
    },
  }
}
