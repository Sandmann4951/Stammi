// Integrationstest: Server-Schreiblogik + App-Lesefunktion gegen echtes Postgres (PGlite).
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error – JS-Hilfsmodul ohne Typen
import { actAs, makeDb } from '../../../tests/pg-env.mjs';
import * as A from '../engine/actions.ts';
import type { State } from '../engine/types.ts';
import { localToday } from '../engine/util.ts';
import { canonical, fromRows, toRows, type Tables } from './mapping.ts';
import { loadTables, writeDiff, type Db } from './writer.ts';
import { demoState } from '../../../../src/seed.ts';

type PG = { query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (t: string) => Promise<unknown> };
let pg: PG;
let db: Db;
const UID = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const OUTSIDER = '99999999-9999-4999-8999-999999999999';
let state: State;

async function tx<T>(fn: () => Promise<T>) {
  await pg.exec('begin');
  try { const r = await fn(); await pg.exec('commit'); return r; } catch (e) { await pg.exec('rollback'); throw e; }
}
const empty = () => Object.fromEntries(Object.keys(toRows(state)).map((k) => [k, []])) as unknown as Tables;
const strip = (s: State) => ({ ...canonical(s), invitations: [], currentUserId: '' });

beforeAll(async () => {
  pg = (await makeDb()) as unknown as PG;
  db = { query: async (t, p) => (await pg.query(t, p)).rows };
  state = demoState(new Date());
  state = { ...state, members: state.members.map((m, i) => ({ ...m, userId: UID[i] })) };
  for (const u of [...UID, OUTSIDER]) await pg.query('insert into auth.users (id) values ($1)', [u]);
});

describe('Datenbank-Abbildung', () => {
  it('Zustand → Zeilen → Zustand ist verlustfrei', () => {
    expect(fromRows(toRows(state))).toEqual({ ...canonical(state), currentUserId: state.members[0].id });
  });

  it('Server schreibt den kompletten Beispiel-Zustand, Lesen ergibt denselben Zustand', async () => {
    const stats = await tx(() => writeDiff(db, empty(), toRows(state)));
    expect(stats.inserted).toBeGreaterThan(50);
    const back = fromRows(await loadTables(db, state.group.id));
    expect({ ...back, currentUserId: '' }).toEqual({ ...canonical(state), currentUserId: '' });
  });

  it('Mitglied liest über group_state alles außer Einladungs-Token; Fremder sieht nichts', async () => {
    await actAs(pg, UID[1]);
    const res = await pg.query('select public.group_state($1) as s', [state.group.id]);
    const asMember = fromRows(res.rows[0].s as Tables, UID[1]);
    expect(asMember.currentUserId).toBe(state.members[1].id);
    expect(strip(asMember)).toEqual(strip(state));
    expect(asMember.invitations).toHaveLength(0); // kein Admin
    await actAs(pg, UID[0]);
    const asAdmin = (await pg.query('select public.group_state($1) as s', [state.group.id])).rows[0].s as Tables;
    expect(asAdmin.invitations.length).toBe(state.invitations.length);
    expect(asAdmin.invitations.every((r) => !('token_hash' in r))).toBe(true);
    await actAs(pg, OUTSIDER);
    const outsider = (await pg.query('select public.group_state($1) as s', [state.group.id])).rows[0].s as Tables;
    expect(outsider.groups).toHaveLength(0);
    expect(outsider.ledger_entries).toHaveLength(0);
    await actAs(pg, undefined);
  });

  it('Aktion (Abrechnung) wird als Unterschied geschrieben und ist danach identisch', async () => {
    const before = fromRows(await loadTables(db, state.group.id));
    const pending = before.events.find((e) => e.status === 'planned' && e.date < localToday())!;
    const admin = before.members[0].id;
    const after = A.closeEvent(before, { actor: admin, now: new Date() }, pending.id, before.members.slice(0, 4).map((m) => m.id));
    const stats = await tx(() => writeDiff(db, toRows(before), toRows(after)));
    expect(stats.deleted).toBe(0);
    expect(stats.inserted).toBeGreaterThanOrEqual(2);
    const back = fromRows(await loadTables(db, state.group.id));
    expect({ ...back, currentUserId: '' }).toEqual({ ...canonical(after), currentUserId: '' });
  });

  it('Buchungen lassen sich auch über die Schreiblogik nicht ändern oder löschen', async () => {
    const cur = toRows(fromRows(await loadTables(db, state.group.id)));
    const changed = { ...cur, ledger_entries: cur.ledger_entries.map((r, i) => (i === 0 ? { ...r, text: 'manipuliert' } : r)) };
    await expect(tx(() => writeDiff(db, cur, changed))).rejects.toThrow(/nicht geändert/);
    const removed = { ...cur, ledger_legs: cur.ledger_legs.slice(1) };
    await expect(tx(() => writeDiff(db, cur, removed))).rejects.toThrow(/nicht gelöscht/);
  });

  it('Löschen (Notiz) und Ändern (Ort) landen korrekt in der Datenbank', async () => {
    const before = fromRows(await loadTables(db, state.group.id));
    const ctx = { actor: before.members[1].id, now: new Date() };
    const next = before.events.find((e) => e.status === 'planned' && e.date >= localToday() && e.type === 'stammtisch')!;
    let after = A.setEventLocation(before, ctx, next.id, 'Gasthof Post');
    const note = after.notes[0];
    after = A.deleteNote(after, { actor: note.authorId, now: new Date() }, note.id);
    const stats = await tx(() => writeDiff(db, toRows(before), toRows(after)));
    expect(stats).toEqual({ inserted: 0, updated: 1, deleted: 1 });
    const back = fromRows(await loadTables(db, state.group.id));
    expect(back.events.find((e) => e.id === next.id)!.location).toBe('Gasthof Post');
    expect(back.notes.some((x) => x.id === note.id)).toBe(false);
  });
});
