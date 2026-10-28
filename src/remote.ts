// Verbindung zu Supabase: Login, Lesen (RLS), Schreiben über die Edge Function `act`.
import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { fromRows, type Tables } from '@db/mapping';
import type { Call } from '@engine/registry';
import type { State } from '@engine/types';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const forcePreview = import.meta.env.VITE_PREVIEW === '1' || new URLSearchParams(location.search).has('vorschau');

/** Läuft die App gegen Supabase (sonst: Vorschau mit Beispieldaten im Browser)? */
export const REMOTE = !!(URL_ && KEY) && !forcePreview;

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(URL_!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
  }
  return client;
}

export function appUrl() {
  return `${location.origin}${location.pathname}`;
}

/** Fehlertext aus einer Edge-Function-Antwort holen. */
async function fnError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try { const b = await error.context.json(); if (b?.error) return String(b.error); } catch { /* ignorieren */ }
    return `Der Server hat die Anfrage abgelehnt (${error.context.status}).`;
  }
  if (error instanceof Error && /fetch|network/i.test(error.message)) return 'Keine Verbindung. Bist du online?';
  return error instanceof Error ? error.message : 'Unbekannter Fehler.';
}

export class RemoteError extends Error {}

/** Kurzer technischer Grund für Fehlermeldungen (hilft bei der Fehlersuche). */
function detail(e: { code?: string; message?: string }) {
  if (e.code === 'PGRST205' || /schema cache|does not exist/i.test(e.message ?? '')) return 'Datenbank noch nicht eingerichtet';
  if (e.code === '42501') return 'keine Berechtigung';
  return [e.code, e.message].filter(Boolean).join(': ').slice(0, 160);
}

export async function invoke<T>(fn: 'act' | 'accept-invite', body: unknown): Promise<T> {
  const { data, error } = await sb().functions.invoke(fn, { body: body as Record<string, unknown> });
  if (error) throw new RemoteError(await fnError(error));
  return data as T;
}

export interface ActResponse { state: State; version: number; token?: string }
export function sendCall(c: Call, ids: string[]) {
  return invoke<ActResponse>('act', { action: c.name, args: c.args, ids });
}

/** Gruppe des angemeldeten Nutzers (oder null, wenn noch keine Mitgliedschaft). */
export async function myGroupId(userId: string): Promise<string | null> {
  const { data, error } = await sb().from('group_members').select('group_id').eq('user_id', userId).eq('status', 'active').limit(1);
  if (error) throw new RemoteError(`Die Gruppe konnte nicht geladen werden. (${detail(error)})`);
  return (data?.[0]?.group_id as string) ?? null;
}

export async function fetchState(groupId: string, userId: string): Promise<{ state: State; version: number }> {
  const { data, error } = await sb().rpc('group_state', { gid: groupId });
  if (error || !data) throw new RemoteError(`Die Daten konnten nicht geladen werden.${error ? ` (${detail(error)})` : ''}`);
  const t = data as Tables & { groups: { state_version: number }[] };
  return { state: fromRows(t, userId), version: Number(t.groups[0]?.state_version ?? 0) };
}

/** Meldet sich, wenn jemand anderes etwas geändert hat. */
export function watchGroup(groupId: string, onVersion: (v: number) => void) {
  const ch = sb().channel(`gruppe-${groupId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${groupId}` },
      (p) => onVersion(Number((p.new as { state_version?: number }).state_version ?? 0)))
    .subscribe();
  return () => { sb().removeChannel(ch); };
}
