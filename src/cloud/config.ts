/**
 * The settings of your own Supabase project (see docs/CLOUD.md). The "publishable" key is meant for the browser:
 * data is protected by access policies (RLS) on the server, not by the secrecy of the key.
 *
 * Without VITE_SUPABASE_URL and VITE_SUPABASE_KEY the cloud is off: the app works entirely locally.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY ?? ''
export const cloudEnabled = (): boolean => !!SUPABASE_URL && !!SUPABASE_KEY && import.meta.env.VITE_CLOUD !== 'off'
