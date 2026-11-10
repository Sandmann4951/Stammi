// Statistiken je Mitglied über einen Zeitraum. Reine Funktionen, Integer-Cent.
// Grundlage sind nur abgeschlossene Termine (Anwesenheit bestätigt) und gültige Buchungen.
import { activeEntries } from './finance.ts';
import type { Cents, ISODate, Member, State, StEvent } from './types.ts';

export interface Period { from?: ISODate; to?: ISODate } // inklusive; leer = offen

export interface MemberStats {
  memberId: string;
  /** an abgeschlossenen Stammtischen anwesend */
  stammtische: number;
  /** an abgeschlossenen Events anwesend */
  events: number;
  /** Stammtische, an denen die Person hätte teilnehmen können (ab Beitritt oder anwesend) */
  possible: number;
  /** Teilnahmequote 0..1 (null ohne mögliche Termine) */
  rate: number | null;
  /** längste Serie aufeinanderfolgender Stammtische */
  bestStreak: number;
  /** aktuelle Serie (bis zum letzten Stammtisch im Zeitraum) */
  streak: number;
  /** Zusagen, die eingehalten wurden (bei abgeschlossenen Terminen) 0..1 */
  reliability: number | null;
  yesCount: number;
  /** selbst ausgelegt (gebuchte Auslagen) */
  paid: Cents;
  /** wie oft die Rechnung übernommen */
  paidCount: number;
  /** eigener Anteil an allen Auslagen (konsumiert) */
  consumed: Cents;
  /** aus dem Topf gutgeschrieben */
  fromPot: Cents;
  /** Beiträge bei Auffüllungen */
  contributed: Cents;
  photos: number;
  likesReceived: number;
  notes: number;
  decisions: number;
  ideas: number;
  comments: number;
}

export interface GroupStats {
  stammtische: number;
  events: number;
  cancelled: number;
  avgPresent: number | null;
  maxPresent: number;
  expenseTotal: Cents;
  potPaidOut: Cents;
  photos: number;
  /** Termin mit den meisten Anwesenden */
  topEvent?: { id: string; present: number };
}

export const inPeriod = (d: string, p: Period) => (!p.from || d >= p.from) && (!p.to || d <= p.to);

/** Jahre, in denen etwas stattgefunden hat (absteigend) – für die Zeitraum-Auswahl. */
export function statYears(state: State): number[] {
  const ys = new Set(state.events.filter((e) => e.status === 'closed').map((e) => +e.date.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
}

function closedIn(state: State, p: Period, type?: StEvent['type']) {
  return state.events
    .filter((e) => e.status === 'closed' && inPeriod(e.date, p) && (!type || e.type === type))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

export function memberStats(state: State, p: Period = {}): MemberStats[] {
  const st = closedIn(state, p, 'stammtisch');
  const ev = closedIn(state, p, 'event');
  const closedIds = new Set([...st, ...ev].map((e) => e.id));
  const present = new Map<string, Set<string>>(); // eventId → Anwesende
  for (const a of state.attendance) {
    if (!a.present || !closedIds.has(a.eventId)) continue;
    if (!present.has(a.eventId)) present.set(a.eventId, new Set());
    present.get(a.eventId)!.add(a.memberId);
  }
  const was = (eid: string, mid: string) => present.get(eid)?.has(mid) ?? false;
  const entries = activeEntries(state.ledger).filter((e) => inPeriod(e.date, p));
  const expenseById = new Map(state.expenses.map((x) => [x.id, x]));
  const evDate = new Map(state.events.map((e) => [e.id, e.date]));
  const mediaIn = state.media.filter((m) => inPeriod(evDate.get(m.eventId) ?? '', p));
  const day = (iso: string) => iso.slice(0, 10);

  // Wer kommt vor? Aktive Mitglieder immer, ehemalige nur mit Daten im Zeitraum
  const rows = state.members.map((m): MemberStats => {
    const joined = day(m.joinedAt);
    const attended = st.filter((e) => was(e.id, m.id));
    const possible = st.filter((e) => e.date >= joined || was(e.id, m.id)).length;
    let best = 0, run = 0;
    for (const e of st) {
      if (was(e.id, m.id)) { run++; best = Math.max(best, run); }
      else if (e.date >= joined) run = 0;
    }
    const yes = state.attendance.filter((a) => a.memberId === m.id && closedIds.has(a.eventId) && a.rsvp === 'yes');
    const kept = yes.filter((a) => a.present).length;
    let paid = 0, paidCount = 0, consumed = 0, fromPot = 0, contributed = 0;
    for (const e of entries) {
      const leg = e.legs.find((l) => l.account === m.id)?.amount ?? 0;
      if (e.kind === 'expense') {
        const x = e.refId ? expenseById.get(e.refId) : undefined;
        const mine = x?.payerId === m.id ? x.amount : 0;
        if (mine) { paid += mine; paidCount++; }
        consumed += mine - leg; // Leg = bezahlt − eigener Anteil
      } else if (e.kind === 'payout' && leg > 0) fromPot += leg;
      else if (e.kind === 'refill' && leg < 0) contributed -= leg;
    }
    const myMedia = mediaIn.filter((x) => x.uploaderId === m.id);
    const mediaIds = new Set(myMedia.map((x) => x.id));
    const notes = state.notes.filter((n) => n.authorId === m.id && inPeriod(evDate.get(n.eventId) ?? '', p));
    return {
      memberId: m.id,
      stammtische: attended.length,
      events: ev.filter((e) => was(e.id, m.id)).length,
      possible,
      rate: possible ? attended.length / possible : null,
      bestStreak: best,
      streak: run,
      reliability: yes.length ? kept / yes.length : null,
      yesCount: yes.length,
      paid, paidCount, consumed, fromPot, contributed,
      photos: myMedia.length,
      likesReceived: state.mediaVotes.filter((v) => mediaIds.has(v.mediaId) && v.value === 1 && v.memberId !== m.id).length,
      notes: notes.length,
      decisions: notes.filter((n) => n.decision).length,
      ideas: state.ideas.filter((i) => i.creatorId === m.id && inPeriod(day(i.createdAt), p)).length,
      comments: state.ideaComments.filter((c) => c.authorId === m.id && inPeriod(day(c.createdAt), p)).length
        + state.mediaComments.filter((c) => c.authorId === m.id && inPeriod(day(c.createdAt), p)).length,
    };
  });
  const isActive = (m: Member) => m.status === 'active';
  return rows.filter((r) => {
    const m = state.members.find((x) => x.id === r.memberId)!;
    return isActive(m) || r.stammtische + r.events + r.paidCount + r.photos + r.notes + r.ideas > 0;
  });
}

export function groupStats(state: State, p: Period = {}): GroupStats {
  const closed = closedIn(state, p);
  const st = closed.filter((e) => e.type === 'stammtisch');
  const counts = closed.map((e) => ({ id: e.id, present: state.attendance.filter((a) => a.eventId === e.id && a.present).length }));
  const stCounts = counts.filter((c) => st.some((e) => e.id === c.id)).map((c) => c.present);
  const entries = activeEntries(state.ledger).filter((e) => inPeriod(e.date, p));
  const expenseIds = new Set(entries.filter((e) => e.kind === 'expense').map((e) => e.refId));
  const top = [...counts].sort((a, b) => b.present - a.present)[0];
  const evDate = new Map(state.events.map((e) => [e.id, e.date]));
  return {
    stammtische: st.length,
    events: closed.length - st.length,
    cancelled: state.events.filter((e) => e.status === 'cancelled' && inPeriod(e.date, p)).length,
    avgPresent: stCounts.length ? stCounts.reduce((a, b) => a + b, 0) / stCounts.length : null,
    maxPresent: top?.present ?? 0,
    expenseTotal: state.expenses.filter((x) => expenseIds.has(x.id)).reduce((a, x) => a + x.amount, 0),
    potPaidOut: entries.filter((e) => e.kind === 'payout').reduce((a, e) => a + e.legs.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0), 0),
    photos: state.media.filter((m) => inPeriod(evDate.get(m.eventId) ?? '', p)).length,
    topEvent: top && top.present > 0 ? top : undefined,
  };
}

/** Rangliste: absteigend nach Wert, gleiche Werte teilen sich den Platz (1, 1, 3 …). */
export function rank<T extends { memberId: string }>(rows: T[], value: (r: T) => number | null): { row: T; value: number; place: number }[] {
  const list = rows.map((row) => ({ row, value: value(row) })).filter((x): x is { row: T; value: number } => x.value !== null)
    .sort((a, b) => b.value - a.value);
  let place = 0, prev: number | undefined;
  return list.map((x, i) => {
    if (x.value !== prev) { place = i + 1; prev = x.value; }
    return { ...x, place };
  });
}
