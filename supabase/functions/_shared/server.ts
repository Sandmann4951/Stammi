// Server-Logik der Edge Functions – unabhängig von Deno/HTTP, damit sie gegen PGlite testbar ist.
// Aufrufer öffnen die Transaktion; hier wird gesperrt, gerechnet und geschrieben.
import * as A from './engine/actions.ts';
import { applyCall, isAction, stateOf } from './engine/registry.ts';
import { DomainError, type State } from './engine/types.ts';
import { ID_RE, addDays, localToday, replayIds, weekdayMon0 } from './engine/util.ts';
import { fromRows, TABLE_ORDER, toRows, type Tables } from './db/mapping.ts';
import { loadTables, writeDiff, type Db } from './db/writer.ts';
import { buildIcs } from './ics.ts';

export interface AuthUser { id: string; email?: string }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const emptyTables = (): Tables => Object.fromEntries(TABLE_ORDER.map((k) => [k, []])) as unknown as Tables;

async function bump(db: Db, groupId: string): Promise<number> {
  const r = await db.query('update public.groups set state_version = state_version + 1 where id = $1::text returning state_version', [groupId]);
  return Number(r[0].state_version);
}

/** Was die App zurückbekommt: ohne Token-Hashes, Einladungen nur für Admins. */
export function forClient(s: State): State {
  const me = s.members.find((m) => m.id === s.currentUserId);
  const admin = me?.role === 'admin' && me.status === 'active';
  return { ...s, invitations: admin ? s.invitations.map((i) => ({ ...i, token: '' })) : [] };
}

export interface ActBody { action?: unknown; args?: unknown; ids?: unknown }
export interface ActResult { state: State; version: number; token?: string; removedMedia: string[]; groupId: string }

export async function handleAct(db: Db, user: AuthUser, body: ActBody, now = new Date()): Promise<ActResult> {
  const action = body.action;
  const args = Array.isArray(body.args) ? body.args : [];

  // Ersteinrichtung: nur solange es noch keine Gruppe gibt
  if (action === 'createGroup') {
    const exists = await db.query('select 1 from public.groups limit 1');
    if (exists.length) throw new HttpError(403, 'Die Gruppe ist schon eingerichtet. Bitte lass dich vom Admin einladen.');
    const [groupName, adminName] = args as [string, string];
    let s = A.createGroup(String(groupName ?? ''), { name: String(adminName ?? ''), email: user.email ?? '', userId: user.id }, now);
    const t = localToday(now);
    s = A.updateSeries(s, { actor: s.currentUserId, now }, { startDate: addDays(t, (7 - weekdayMon0(t)) % 7), intervalWeeks: 2, time: '19:00', title: 'Stammtisch' });
    await writeDiff(db, emptyTables(), toRows(s));
    const version = await bump(db, s.group.id);
    return { state: forClient(s), version, removedMedia: [], groupId: s.group.id };
  }

  const mem = await db.query(
    "select group_id, id from public.group_members where user_id = $1::uuid and status = 'active' order by joined_at limit 1", [user.id]);
  if (!mem.length) throw new HttpError(403, 'Du bist (noch) kein Mitglied einer Gruppe.');
  const groupId = mem[0].group_id as string;
  await db.query('select id from public.groups where id = $1::text for update', [groupId]);
  const before = fromRows(await loadTables(db, groupId), user.id);
  const ctx: A.Ctx = { actor: mem[0].id as string, now };

  // Kalender-Abo: neuer geheimer Link (ersetzt den alten), am Zustand ändert sich nichts
  if (action === 'calendarToken') {
    const token = randomToken();
    await db.query(
      `insert into public.calendar_tokens (group_id, member_id, token_hash, created_at) values ($1::text, $2::text, $3::text, now())
       on conflict (group_id, member_id) do update set token_hash = excluded.token_hash, created_at = excluded.created_at`,
      [groupId, ctx.actor, await sha256Hex(token)]);
    const v = await db.query('select state_version from public.groups where id = $1::text', [groupId]);
    return { state: forClient({ ...before, currentUserId: ctx.actor }), version: Number(v[0].state_version), token, removedMedia: [], groupId };
  }
  const base = A.ensureSeries(before, now);

  let after: State;
  let token: string | undefined;
  if (action === 'inviteMember') {
    token = randomToken();
    after = A.inviteMember(base, ctx, String(args[0] ?? ''), await sha256Hex(token)).state;
  } else if (isAction(action)) {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length > 50 || ids.some((x) => typeof x !== 'string' || !ID_RE.test(x))) throw new DomainError('Ungültige Kennung in der Anfrage.');
    const known = JSON.stringify(before);
    if ((ids as string[]).some((id) => known.includes(`"${id}"`))) throw new DomainError('Ungültige Kennung in der Anfrage.');
    after = stateOf(replayIds(ids as string[], () => applyCall(base, ctx, { name: action, args } as never)));
  } else {
    throw new HttpError(400, 'Unbekannte Aktion.');
  }

  await writeDiff(db, toRows(before), toRows(after));
  const version = await bump(db, groupId);
  const removedMedia = before.media.filter((m) => !after.media.some((x) => x.id === m.id)).map((m) => `${groupId}/${m.eventId}/${m.id}`);
  return { state: forClient({ ...after, currentUserId: ctx.actor }), version, token, removedMedia, groupId };
}

// ---------- Einladung annehmen (ohne Login) ----------
export interface AcceptInput { token: string; name: string; email: string; password: string }

function parseAccept(body: unknown): AcceptInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  if (!/^[a-f0-9]{64}$/.test(s('token'))) throw new HttpError(400, 'Dieser Einladungslink ist ungültig.');
  const email = s('email').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Bitte eine gültige E-Mail-Adresse eingeben.');
  return { token: s('token'), name: s('name'), email, password: s('password') };
}

async function stateForToken(db: Db, hash: string, lock: boolean) {
  const inv = await db.query('select group_id from public.invitations where token_hash = $1::text', [hash]);
  if (!inv.length) throw new DomainError('Diesen Einladungslink gibt es nicht (mehr). Bitte den Admin um einen neuen.');
  const groupId = inv[0].group_id as string;
  if (lock) await db.query('select id from public.groups where id = $1::text for update', [groupId]);
  return { groupId, state: fromRows(await loadTables(db, groupId)) };
}

/** Schritt 1: alles prüfen, bevor ein Konto angelegt wird. */
export async function checkInvite(db: Db, body: unknown, now = new Date()) {
  const input = parseAccept(body);
  const hash = await sha256Hex(input.token);
  const { state, groupId } = await stateForToken(db, hash, false);
  A.acceptInvite(state, now, hash, input); // wirft bei abgelaufen/benutzt/Name vergeben/Passwort zu kurz
  return { input, hash, groupId };
}

/** Schritt 2 (nach dem Anlegen des Kontos): Mitgliedschaft schreiben. */
export async function commitInvite(db: Db, hash: string, input: AcceptInput, userId: string, now = new Date()) {
  const { state, groupId } = await stateForToken(db, hash, true);
  const r = A.acceptInvite(state, now, hash, { ...input, userId });
  await writeDiff(db, toRows(state), toRows(r.state));
  await bump(db, groupId);
  return { groupId, memberId: r.memberId };
}

// ---------- Kalender-Abo (ohne Login, per geheimem Link) ----------
export async function handleCalendar(db: Db, token: string, appUrl: string, now = new Date()): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await db.query(
    `select t.group_id, t.member_id from public.calendar_tokens t
       join public.group_members m on m.group_id = t.group_id and m.id = t.member_id and m.status = 'active'
      where t.token_hash = $1::text`, [await sha256Hex(token)]);
  if (!rows.length) return null;
  const state = fromRows(await loadTables(db, rows[0].group_id as string));
  return buildIcs({ ...state, currentUserId: rows[0].member_id as string }, rows[0].member_id as string, appUrl, now);
}
