// Server-Ablauf wie in der Edge Function – gegen echtes Postgres (PGlite).
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error – JS-Hilfsmodul ohne Typen
import { makeDb } from '../../tests/pg-env.mjs';
import { call } from './engine/registry.ts';
import { DomainError } from './engine/types.ts';
import { localToday, recordIds } from './engine/util.ts';
import { applyCall, stateOf } from './engine/registry.ts';
import type { Db } from './db/writer.ts';
import { checkInvite, commitInvite, handleAct, HttpError, type ActBody, type AuthUser } from './server.ts';

type PG = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (t: string) => Promise<unknown> };
let pg: PG;
let db: Db;
const daniel: AuthUser = { id: '11111111-1111-4111-8111-111111111111', email: 'daniel@example.de' };
const markus: AuthUser = { id: '22222222-2222-4222-8222-222222222222', email: 'markus@example.de' };
const stranger: AuthUser = { id: '99999999-9999-4999-8999-999999999999', email: 'x@example.de' };

async function tx<T>(fn: () => Promise<T>) {
  await pg.exec('begin');
  try { const r = await fn(); await pg.exec('commit'); return r; } catch (e) { await pg.exec('rollback'); throw e; }
}
const act = (u: AuthUser, body: ActBody) => tx(() => handleAct(db, u, body));

beforeAll(async () => {
  pg = (await makeDb()) as unknown as PG;
  db = { query: async (t, p) => (await pg.query(t, p)).rows };
  for (const u of [daniel, markus, stranger]) await pg.query('insert into auth.users (id) values ($1)', [u.id]);
});

describe('Edge Function act / accept-invite (Ablauf)', () => {
  let token = '';
  it('Ersteinrichtung legt Gruppe, Admin und Serie an – nur einmal', async () => {
    const r = await act(daniel, { action: 'createGroup', args: ['Stammtisch Kirchheim', 'Daniel'] });
    expect(r.state.members[0]).toMatchObject({ name: 'Daniel', role: 'admin', userId: daniel.id });
    expect(r.state.series?.intervalWeeks).toBe(2);
    expect(r.state.events.length).toBeGreaterThan(3);
    await expect(act(stranger, { action: 'createGroup', args: ['Zweite', 'X'] })).rejects.toBeInstanceOf(HttpError);
  });

  it('Admin lädt ein: Link-Token kommt zurück, gespeichert wird nur der Hash', async () => {
    const r = await act(daniel, { action: 'inviteMember', args: ['markus@example.de'] });
    token = r.token!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(r.state.invitations[0].token).toBe('');
    const raw = await pg.query('select token_hash from invitations');
    expect(raw.rows[0].token_hash).not.toBe(token);
  });

  it('Einladung annehmen: Prüfung vor Kontoanlage, dann Mitgliedschaft', async () => {
    await expect(checkInvite(db, { token: 'a'.repeat(64), name: 'Markus', email: 'markus@example.de', password: 'geheim123' })).rejects.toBeInstanceOf(DomainError);
    await expect(checkInvite(db, { token, name: 'Markus', email: 'markus@example.de', password: 'kurz' })).rejects.toThrow(/8 Zeichen/);
    await expect(checkInvite(db, { token, name: 'Daniel', email: 'markus@example.de', password: 'geheim123' })).rejects.toThrow(/vergeben/);
    const ok = await checkInvite(db, { token, name: 'Markus', email: 'Markus@Example.de', password: 'geheim123' });
    expect(ok.input.email).toBe('markus@example.de');
    await tx(() => commitInvite(db, ok.hash, ok.input, markus.id));
    await expect(checkInvite(db, { token, name: 'Markus2', email: 'm2@example.de', password: 'geheim123' })).rejects.toThrow(/schon verwendet/);
  });

  it('Mitglied handelt mit IDs aus der App – Server erzeugt denselben Eintrag', async () => {
    const st = await act(markus, { action: 'setRsvp', args: [] }).catch((e) => e);
    expect(st).toBeInstanceOf(Error); // falsche Argumente → fachlicher Fehler, nichts geschrieben
    const cur = (await act(daniel, { action: 'startCashPool', args: [] })).state;
    const next = cur.events.find((e) => e.date >= localToday())!;
    const me = cur.members.find((m) => m.userId === markus.id)!;
    const c = call('addNote', next.id, 'Ich bring Brezn mit', false);
    const local = recordIds(() => stateOf(applyCall({ ...cur, currentUserId: me.id }, { actor: me.id, now: new Date() }, c)));
    const r = await act(markus, { action: c.name, args: c.args, ids: local.ids });
    expect(r.state.notes.map((n) => n.id)).toEqual(local.result.notes.map((n) => n.id));
    expect(r.version).toBeGreaterThan(1);
  });

  it('Rechte und Missbrauch werden abgewiesen', async () => {
    const cur = (await act(daniel, { action: 'setRsvp', args: [] }).catch(() => null)) ?? null;
    expect(cur).toBeNull();
    await expect(act(stranger, { action: 'addNote', args: ['t1', 'x', false] })).rejects.toThrow(/kein Mitglied/);
    await expect(act(markus, { action: 'startCashPool', args: [] })).rejects.toThrow(/Admin/);
    await expect(act(markus, { action: 'evil', args: [] })).rejects.toThrow(/Unbekannte Aktion/);
    const st = (await pg.query('select id from events limit 1')).rows[0].id as string;
    const existingNote = (await pg.query('select id from notes limit 1')).rows[0].id as string;
    await expect(act(markus, { action: 'addNote', args: [st, 'Überschreiben?', false], ids: [existingNote] })).rejects.toThrow(/Ungültige Kennung/);
    const legs = (await pg.query('select count(*)::int as n from ledger_legs')).rows[0].n;
    expect(legs).toBeGreaterThan(0);
  });
});

describe('Regression 28.10.: Serie verschieben mit stornierter Auslage (echte Fremdschlüssel)', () => {
  it('läuft durch und entfernt den alten Termin samt Auslage', async () => {
    const st = (await act(daniel, { action: 'setRsvp', args: ['x', 'y', 'yes'] }).catch(() => null));
    expect(st).toBeNull();
    const cur = (await pg.query("select id, date::text as d from events where status = 'planned' and date > current_date and id not in (select event_id from notes) order by date limit 1")).rows[0];
    const me = (await pg.query('select id from group_members where user_id = $1', [daniel.id])).rows[0].id as string;
    await act(daniel, { action: 'addExpense', args: [{ eventId: cur.id, payerId: me, amount: 1200, description: 'Brezn' }], ids: ['a9regress01'] });
    await act(daniel, { action: 'voidExpense', args: ['a9regress01'] });
    const series = (await pg.query('select series from groups')).rows[0].series as { startDate: string };
    const shifted = new Date(series.startDate + 'T00:00:00Z'); shifted.setUTCDate(shifted.getUTCDate() + 7);
    const r = await act(daniel, { action: 'updateSeries', args: [{ ...series, startDate: shifted.toISOString().slice(0, 10) }] });
    expect(r.state.events.some((e) => e.id === cur.id)).toBe(false);
    expect((await pg.query("select count(*)::int as n from expenses where id = 'a9regress01'")).rows[0].n).toBe(0);
  });
});

describe('Kalender-Abo', () => {
  it('Link erzeugen, abrufen, ersetzen, für Inaktive sperren', async () => {
    const { handleCalendar } = await import('./server.ts');
    const r1 = await act(markus, { action: 'calendarToken', args: [] });
    expect(r1.token).toMatch(/^[a-f0-9]{64}$/);
    const ics = await tx(() => handleCalendar(db, r1.token!, 'https://app/'));
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Stammtisch');
    // ungültig / zu kurz
    expect(await tx(() => handleCalendar(db, 'f'.repeat(64), 'https://app/'))).toBeNull();
    expect(await tx(() => handleCalendar(db, 'abc', 'https://app/'))).toBeNull();
    // neuer Link ersetzt den alten
    const r2 = await act(markus, { action: 'calendarToken', args: [] });
    expect(await tx(() => handleCalendar(db, r1.token!, 'https://app/'))).toBeNull();
    expect(await tx(() => handleCalendar(db, r2.token!, 'https://app/'))).toContain('BEGIN:VCALENDAR');
    // Mitglied deaktiviert → kein Kalender mehr
    const mk = (await pg.query('select id from group_members where user_id = $1', [markus.id])).rows[0].id as string;
    await act(daniel, { action: 'setMemberStatus', args: [mk, 'inactive'] });
    expect(await tx(() => handleCalendar(db, r2.token!, 'https://app/'))).toBeNull();
    await act(daniel, { action: 'setMemberStatus', args: [mk, 'active'] });
    // Fremde ohne Gruppe bekommen keinen Link
    await expect(act(stranger, { action: 'calendarToken', args: [] })).rejects.toThrow(/kein Mitglied/);
  });
});
