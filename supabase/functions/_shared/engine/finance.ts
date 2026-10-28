import { POT, type Cents, type EntryKind, type LedgerEntry, type Member, type State } from './types.ts';
import { splitCents } from './util.ts';

/*
 * Bilanzlogik (eindeutig definiert, siehe auch „So wird gerechnet“ in der App)
 * ---------------------------------------------------------------------------
 * Jede Buchung besteht aus Beinen (legs) auf Konten: dem virtuellen Topf und je Mitglied.
 *  - refill:      Topf + n×20 €, jedes aktive Mitglied −20 € (Beitragsschuld)
 *  - payout:      Topf −50 €, Anwesende je +Anteil (Topfgutschrift)
 *  - expense:     Zahler +Betrag, Anwesende je −Anteil
 *  - settlement:  Zahler +Betrag, Empfänger −Betrag
 *  - opening:     Gläubiger +, Schuldner −
 *  - special_in:  Topf +X; Belastung: ausgewählte Mitglieder je −Anteil (bei Spende: verwahrendes Mitglied −X)
 *  - special_out: Topf −X; Empfänger je +Anteil
 *  - reversal:    exakte Gegenbuchung einer früheren Buchung
 * Invariante: Summe aller Beine jeder Buchung = 0. Damit gilt immer: Σ Mitgliedssalden = −Topfstand.
 *
 * Der Topf ist virtuell – niemand verwahrt sein Geld. Sein Bestand gehört anteilig allen aktiven
 * Mitgliedern. Für den „Stand“ einer Person (= was sie bei sofortigem Ausgleich zahlen/bekommen würde)
 * wird der Topfbestand deshalb gleichmäßig auf die aktiven Mitglieder zurückgerechnet. Dadurch ist die
 * Summe aller Stände exakt 0 und Zahlungsvorschläge gehen glatt auf.
 */

export function reversedIds(ledger: LedgerEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of ledger) if (e.kind === 'reversal' && e.reversesId) s.add(e.reversesId);
  return s;
}

/** Aktive (nicht stornierte) Originalbuchungen, ohne Gegenbuchungen. */
export function activeEntries(ledger: LedgerEntry[]): LedgerEntry[] {
  const rev = reversedIds(ledger);
  return ledger.filter((e) => e.kind !== 'reversal' && !rev.has(e.id));
}

export function accountBalance(ledger: LedgerEntry[], account: string): Cents {
  let sum = 0;
  for (const e of ledger) for (const l of e.legs) if (l.account === account) sum += l.amount;
  return sum;
}

export function potBalance(ledger: LedgerEntry[]): Cents {
  return accountBalance(ledger, POT);
}

export function rawBalances(state: State): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const mem of state.members) m.set(mem.id, 0);
  for (const e of state.ledger) for (const l of e.legs) if (l.account !== POT) m.set(l.account, (m.get(l.account) ?? 0) + l.amount);
  return m;
}

export function activeMembers(state: State): Member[] {
  return state.members.filter((m) => m.status === 'active').sort((a, b) => a.order - b.order);
}

/** Anteil jedes aktiven Mitglieds am aktuellen Topfbestand (deterministisch, centgenau). */
export function potShares(state: State): Map<string, Cents> {
  return splitCents(potBalance(state.ledger), activeMembers(state).map((m) => m.id), 0);
}

/** Stand je Mitglied = Buchungssaldo + Anteil am Topfbestand. Summe = 0. */
export function standings(state: State): Map<string, Cents> {
  const raw = rawBalances(state);
  const shares = potShares(state);
  const out = new Map<string, Cents>();
  for (const [id, v] of raw) out.set(id, v + (shares.get(id) ?? 0));
  return out;
}

export type Category = 'expense' | 'pot' | 'contribution' | 'settlement' | 'opening' | 'special';
export const CATEGORY_LABEL: Record<Category, string> = {
  expense: 'Auslagen',
  pot: 'Topfgutschriften',
  contribution: 'Beiträge',
  settlement: 'Ausgleichszahlungen',
  opening: 'Anfangsbestand',
  special: 'Sonderbuchungen',
};

function categoryOf(kind: EntryKind): Category {
  switch (kind) {
    case 'expense': return 'expense';
    case 'payout': return 'pot';
    case 'refill': return 'contribution';
    case 'settlement': return 'settlement';
    case 'opening': return 'opening';
    default: return 'special';
  }
}

export interface Breakdown {
  byCategory: Record<Category, Cents>;
  potShare: Cents;
  raw: Cents;
  standing: Cents;
}

export function breakdown(state: State, memberId: string): Breakdown {
  const byId = new Map(state.ledger.map((e) => [e.id, e]));
  const byCategory: Record<Category, Cents> = { expense: 0, pot: 0, contribution: 0, settlement: 0, opening: 0, special: 0 };
  for (const e of state.ledger) {
    const origin = e.kind === 'reversal' && e.reversesId ? byId.get(e.reversesId) : e;
    const cat = categoryOf(origin?.kind ?? e.kind);
    for (const l of e.legs) if (l.account === memberId) byCategory[cat] += l.amount;
  }
  const raw = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const potShare = potShares(state).get(memberId) ?? 0;
  return { byCategory, potShare, raw, standing: raw + potShare };
}

export interface CycleInfo {
  cycleNo: number; // laufender Zyklus (1-basiert), 0 = noch keine Auffüllung
  settledInCycle: number; // abgerechnete Stammtische im laufenden Zyklus (0..1)
  totalSettled: number;
  reserve: Cents; // für offene reguläre Ausschüttungen reserviert
  available: Cents; // frei für Sonderausschüttungen
  pot: Cents;
}

export const PAYOUT_PER_MEETING: Cents = 5000;
export const CONTRIBUTION_PER_MEMBER: Cents = 2000;
export const MEETINGS_PER_CYCLE = 2;

export function cycleInfo(state: State): CycleInfo {
  let cycleNo = 0;
  let settled = 0;
  let total = 0;
  for (const e of activeEntries(state.ledger).sort((a, b) => a.seq - b.seq)) {
    if (e.kind === 'refill') { cycleNo = (e.meta?.cycleNo as number) ?? cycleNo + 1; settled = 0; }
    if (e.kind === 'payout') { settled++; total++; }
  }
  const pot = potBalance(state.ledger);
  const reserve = cycleNo > 0 ? Math.max(0, MEETINGS_PER_CYCLE - settled) * PAYOUT_PER_MEETING : 0;
  return { cycleNo, settledInCycle: settled, totalSettled: total, reserve, available: Math.max(0, pot - reserve), pot };
}

export interface Payment { from: string; to: string; amount: Cents }

/**
 * Hausregel: Wer am weitesten im Minus ist, zahlt die Rechnung – sofern anwesend.
 * Liefert die Kandidaten (nur Stand < 0) aufsteigend sortiert; optional eingeschränkt auf Anwesende/Zusagen.
 */
export function payerRanking(state: State, among?: string[]): { id: string; standing: Cents }[] {
  const st = standings(state);
  const pool = among ?? activeMembers(state).map((m) => m.id);
  const order = new Map(state.members.map((m) => [m.id, m.order]));
  return pool.map((id) => ({ id, standing: st.get(id) ?? 0 }))
    .filter((x) => x.standing < 0)
    .sort((a, b) => a.standing - b.standing || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Vereinfachte Zahlungsvorschläge: größter Schuldner zahlt an größten Gläubiger. */
export function suggestPayments(stand: Map<string, Cents>, order: string[] = []): Payment[] {
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
  const debtors = [...stand].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = [...stand].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const sort = (arr: { id: string; v: number }[]) => arr.sort((a, b) => b.v - a.v || rank(a.id) - rank(b.id));
  const out: Payment[] = [];
  sort(debtors); sort(creditors);
  while (debtors.length && creditors.length) {
    const d = debtors[0], c = creditors[0];
    const amt = Math.min(d.v, c.v);
    if (amt > 0) out.push({ from: d.id, to: c.id, amount: amt });
    d.v -= amt; c.v -= amt;
    if (d.v === 0) debtors.shift();
    if (c.v === 0) creditors.shift();
    sort(debtors); sort(creditors);
  }
  return out;
}

/** Alle Buchungen als CSV (Semikolon, deutsches Dezimalkomma). */
export function ledgerCsv(state: State): string {
  const name = (id: string) => (id === POT ? 'Topf' : state.members.find((m) => m.id === id)?.name ?? id);
  const rows = [['Nr', 'Datum', 'Art', 'Text', 'Konto', 'Betrag', 'Storno von', 'Erfasst am', 'Erfasst von']];
  for (const e of [...state.ledger].sort((a, b) => a.seq - b.seq)) {
    for (const l of e.legs) {
      rows.push([String(e.seq), e.date, e.kind, e.text, name(l.account), (l.amount / 100).toFixed(2).replace('.', ','),
        e.reversesId ? String(state.ledger.find((x) => x.id === e.reversesId)?.seq ?? '') : '', e.createdAt, name(e.createdBy)]);
    }
  }
  return rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');
}
