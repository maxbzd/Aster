// Entry point of the Supabase Edge Function. All the logic is in handler.ts (the tests exercise it).
import { handle } from './handler.ts'

const deno = (globalThis as unknown as { Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void; env: { toObject: () => Record<string, string> } } }).Deno

deno.serve(req => handle(req, deno.env.toObject() as unknown as Parameters<typeof handle>[1]))
