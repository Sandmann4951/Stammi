// Nachbildung der Supabase-Umgebung (Rollen, auth, storage, realtime) in PGlite + alle Migrationen.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

const MIG = new URL('../migrations/', import.meta.url);

export async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select, insert on storage.objects to authenticated;
    create publication supabase_realtime;
  `);
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
    try { await db.exec(readFileSync(new URL(f, MIG), 'utf8')); }
    catch (e) { throw new Error(`Migration ${f}: ${e.message}`); }
  }
  return db;
}

/** Als eingeloggter Nutzer (uid) bzw. anonym handeln; ohne Argument: wieder Server/Admin. */
export async function actAs(db, uid, role = 'authenticated') {
  if (uid === undefined && role === 'authenticated') { await db.exec('reset role'); return; }
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
}
