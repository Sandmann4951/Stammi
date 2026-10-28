// HTTP- und Supabase-Hilfen für die Edge Functions (Deno).
import postgres from 'npm:postgres@3.4.5';
import type { Db } from './db/writer.ts';
import { DomainError } from './engine/types.ts';
import { HttpError, type AuthUser } from './server.ts';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Fehler → verständliche Antwort. Fachliche Fehler sind 400, alles Unerwartete 500 (Details nur im Log). */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e instanceof DomainError) return json({ error: e.message }, 400);
  const msg = e instanceof Error ? e.message : String(e);
  if (/Doppelte Buchung|unveränderlich|geht nicht auf/.test(msg)) return json({ error: msg }, 409);
  console.error(e);
  return json({ error: 'Unerwarteter Fehler auf dem Server. Bitte noch einmal versuchen.' }, 500);
}

function firstKey(envName: string): string | undefined {
  const raw = Deno.env.get(envName);
  if (!raw) return undefined;
  try { const o = JSON.parse(raw); return typeof o === 'string' ? o : (Object.values(o)[0] as string); } catch { return raw; }
}
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const PUBLISHABLE_KEY = firstKey('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
export const SECRET_KEY = firstKey('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Prüft das Login des Aufrufers bei Supabase Auth. */
export async function getUser(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: req.headers.get('apikey') ?? PUBLISHABLE_KEY } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? { id: u.id, email: u.email } : null;
}

/** Führt fn in einer Datenbank-Transaktion aus (direkte Verbindung, umgeht RLS – nur hier!). */
export async function inTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1, idle_timeout: 5 });
  try {
    return await sql.begin(async (tx) => fn({ query: async (text, params) => (await tx.unsafe(text, (params ?? []) as never[])) as unknown as Record<string, unknown>[] })) as T;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Aufruf der Supabase-Admin-API mit dem geheimen Schlüssel (nur serverseitig). */
export async function adminFetch(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}
