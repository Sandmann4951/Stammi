// Schreibt den Unterschied zwischen altem und neuem Zustand in die Datenbank.
// Läuft in der Edge Function innerhalb einer Transaktion (Gruppe per FOR UPDATE gesperrt)
// und im Test gegen PGlite. Buchungen dürfen nur angefügt werden.
import { APPEND_ONLY, TABLE_ORDER, TABLES, type ColType, type Row, type TableName, type Tables } from './mapping.ts';

export interface Db {
  query(text: string, params?: unknown[]): Promise<Row[]>;
}

const CAST: Record<ColType, string> = { text: 'text', int: 'integer', smallint: 'smallint', bool: 'boolean', date: 'date', ts: 'timestamptz', json: 'jsonb', uuid: 'uuid' };

function keyOf(t: TableName, r: Row) {
  return TABLES[t].pk.map((c) => String(r[c])).join('\u0001');
}
function param(type: ColType, v: unknown) {
  if (v === undefined || v === null) return null;
  if (type === 'json') return JSON.stringify(v);
  return v;
}
/** Vergleichbare Form einer Zeile (nur bekannte Spalten, Zeitstempel normalisiert). */
function sig(t: TableName, r: Row) {
  const cols = TABLES[t].cols as Record<string, ColType>;
  return JSON.stringify(Object.keys(cols).map((c) => {
    const v = r[c];
    if (v === undefined || v === null) return null;
    if (cols[c] === 'ts') return new Date(v as string).toISOString();
    if (cols[c] === 'date') return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    return v;
  }));
}

export interface DiffStats { inserted: number; updated: number; deleted: number }

export async function writeDiff(db: Db, before: Tables, after: Tables): Promise<DiffStats> {
  const stats: DiffStats = { inserted: 0, updated: 0, deleted: 0 };
  // 1) Einfügen/Ändern: Eltern vor Kindern
  for (const t of TABLE_ORDER) {
    const cols = TABLES[t].cols as Record<string, ColType>;
    const names = Object.keys(cols);
    const old = new Map(before[t].map((r) => [keyOf(t, r), r]));
    for (const r of after[t]) {
      const prev = old.get(keyOf(t, r));
      if (prev && sig(t, prev) === sig(t, r)) continue;
      if (prev && APPEND_ONLY.has(t)) throw new Error(`Buchung ${keyOf(t, r)} darf nicht geändert werden.`);
      const values = names.map((c, i) => `$${i + 1}::${CAST[cols[c]]}`).join(', ');
      const pk = TABLES[t].pk as readonly string[];
      const upd = names.filter((c) => !pk.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
      const sql = `insert into public.${t} (${names.join(', ')}) values (${values})`
        + (APPEND_ONLY.has(t) ? '' : ` on conflict (${pk.join(', ')}) do ${upd ? `update set ${upd}` : 'nothing'}`);
      await db.query(sql, names.map((c) => param(cols[c], r[c])));
      if (prev) stats.updated++; else stats.inserted++;
    }
  }
  // 2) Löschen: Kinder vor Eltern
  for (const t of [...TABLE_ORDER].reverse()) {
    const now = new Set(after[t].map((r) => keyOf(t, r)));
    for (const r of before[t]) {
      if (now.has(keyOf(t, r))) continue;
      if (APPEND_ONLY.has(t)) throw new Error('Buchungen dürfen nicht gelöscht werden.');
      const pk = TABLES[t].pk as readonly string[];
      const cols = TABLES[t].cols as Record<string, ColType>;
      await db.query(`delete from public.${t} where ${pk.map((c, i) => `${c} = $${i + 1}::${CAST[cols[c]]}`).join(' and ')}`, pk.map((c) => r[c]));
      stats.deleted++;
    }
  }
  return stats;
}

/** Lädt alle Zeilen einer Gruppe (als Server, inkl. Token-Hashes). */
export async function loadTables(db: Db, groupId: string): Promise<Tables> {
  const out = {} as Tables;
  for (const t of TABLE_ORDER) {
    const where = t === 'groups' ? 'id = $1' : 'group_id = $1';
    out[t] = await db.query(`select ${Object.keys(TABLES[t].cols).join(', ')} from public.${t} where ${where}`, [groupId]);
  }
  return out;
}
