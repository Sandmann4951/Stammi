// Alle schreibenden Aktionen. Jede Aktion ist eine reine Funktion (State → neuer State) und
// prüft Berechtigungen und fachliche Regeln. In der Supabase-Version werden genau diese Aktionen
// zu RPC-Funktionen (Postgres, eine Transaktion je Aufruf) – das Frontend ruft sie nur noch auf.

import {
  DomainError, POT,
  type Attendance, type Cents, type EventType, type ISODate, type Idea, type IdeaComment, type IdeaStatus, type Leg,
  type LedgerEntry, type Member, type Rsvp, type SeriesRule, type State, type StEvent,
} from './types.ts';
import { activeEntries, activeMembers, cycleInfo, potBalance, CONTRIBUTION_PER_MEMBER, MEETINGS_PER_CYCLE, PAYOUT_PER_MEETING } from './finance.ts';
import { addDays, diffDays, endOf, euro, ID_RE, localToday, MAX_EVENT_DAYS, seedFrom, splitCents, uid } from './util.ts';

export interface Ctx {
  actor: string;
  now: Date;
}

const MAX_AMOUNT: Cents = 1_000_000; // 10.000 € Plausibilitätsgrenze
export const SERIES_HORIZON_DAYS = 120;
export const INVITE_DAYS = 7;

// ---------- Hilfen ----------
function iso(ctx: Ctx) { return ctx.now.toISOString(); }
function today(ctx: Ctx) { return localToday(ctx.now); }

export function memberOf(state: State, id: string): Member {
  const m = state.members.find((x) => x.id === id);
  if (!m) throw new DomainError('Mitglied nicht gefunden.');
  return m;
}
export function isAdmin(state: State, id: string): boolean {
  const m = state.members.find((x) => x.id === id);
  return !!m && m.role === 'admin' && m.status === 'active';
}
function requireMember(state: State, ctx: Ctx) {
  const m = state.members.find((x) => x.id === ctx.actor);
  if (!m || m.status !== 'active') throw new DomainError('Nur aktive Mitglieder dürfen das.');
  return m;
}
function requireAdmin(state: State, ctx: Ctx) {
  if (!isAdmin(state, ctx.actor)) throw new DomainError('Das darf nur der Admin.');
}
function getEvent(state: State, id: string): StEvent {
  const e = state.events.find((x) => x.id === id);
  if (!e) throw new DomainError('Termin nicht gefunden.');
  return e;
}
function checkAmount(amount: Cents) {
  if (!Number.isInteger(amount) || amount <= 0) throw new DomainError('Bitte einen Betrag größer 0 eingeben.');
  if (amount > MAX_AMOUNT) throw new DomainError(`Der Betrag ist unplausibel hoch (max. ${euro(MAX_AMOUNT)}).`);
}
function nameOf(state: State, id: string) { return state.members.find((m) => m.id === id)?.name ?? '?'; }
function byOrder(state: State, ids: string[]): string[] {
  const order = new Map(state.members.map((m) => [m.id, m.order]));
  return [...new Set(ids)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** Bucht atomar. Prüft Nullsumme und fachliche Eindeutigkeit (key). */
function post(state: State, ctx: Ctx, e: Omit<LedgerEntry, 'id' | 'seq' | 'createdAt' | 'createdBy'>): { state: State; entry: LedgerEntry } {
  const net = new Map<string, Cents>();
  for (const l of e.legs) net.set(l.account, (net.get(l.account) ?? 0) + l.amount);
  const legs: Leg[] = [...net].filter(([, a]) => a !== 0).map(([account, amount]) => ({ account, amount }));
  const sum = legs.reduce((a, l) => a + l.amount, 0);
  if (sum !== 0) throw new DomainError('Interner Fehler: Buchung geht nicht auf.');
  if (e.key && activeEntries(state.ledger).some((x) => x.key === e.key)) {
    throw new DomainError('Diese Buchung existiert bereits – doppelte Verbuchung verhindert.');
  }
  const seq = state.ledger.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
  const entry: LedgerEntry = { ...e, legs, id: uid('b'), seq, createdAt: iso(ctx), createdBy: ctx.actor };
  return { state: { ...state, ledger: [...state.ledger, entry] }, entry };
}

function reverse(state: State, ctx: Ctx, entryId: string, text: string): State {
  const orig = state.ledger.find((x) => x.id === entryId);
  if (!orig) throw new DomainError('Buchung nicht gefunden.');
  if (orig.kind === 'reversal') throw new DomainError('Eine Gegenbuchung kann nicht storniert werden.');
  if (state.ledger.some((x) => x.reversesId === entryId)) throw new DomainError('Diese Buchung ist bereits storniert.');
  return post(state, ctx, {
    kind: 'reversal', date: today(ctx), text, reversesId: orig.id, eventId: orig.eventId, refId: orig.refId,
    legs: orig.legs.map((l) => ({ account: l.account, amount: -l.amount })),
  }).state;
}

// ---------- Gruppe & Kasse ----------
export function createGroup(name: string, admin: { name: string; email: string; userId?: string }, now: Date): State {
  if (!admin.name.trim() || admin.name.trim().length > 30) throw new DomainError('Bitte einen Anzeigenamen mit höchstens 30 Zeichen wählen.');
  if (name.trim().length > 60) throw new DomainError('Der Gruppenname ist zu lang (max. 60 Zeichen).');
  const adminId = uid('m');
  return {
    schema: 2,
    group: { id: uid('g'), name: name.trim() || 'Stammtisch', createdAt: now.toISOString() },
    members: [{ id: adminId, name: admin.name.trim(), email: admin.email.trim(), role: 'admin', status: 'active', joinedAt: now.toISOString(), order: 0, userId: admin.userId }],
    invitations: [], series: null, events: [], attendance: [], expenses: [], notes: [], media: [], ideas: [], ideaComments: [], ideaVotes: [], ledger: [],
    currentUserId: adminId,
  };
}

function refill(state: State, ctx: Ctx, cycleNo: number, triggeredBy?: string): State {
  const members = activeMembers(state);
  if (members.length < 2) throw new DomainError('Für die Kasse braucht es mindestens zwei aktive Mitglieder.');
  const legs: Leg[] = members.map((m) => ({ account: m.id, amount: -CONTRIBUTION_PER_MEMBER }));
  legs.push({ account: POT, amount: CONTRIBUTION_PER_MEMBER * members.length });
  return post(state, ctx, {
    kind: 'refill', date: today(ctx), key: `refill:${cycleNo}`,
    text: `Auffüllung Zyklus ${cycleNo}: ${members.length} × ${euro(CONTRIBUTION_PER_MEMBER)}`,
    legs, meta: { cycleNo, triggeredBy },
  }).state;
}

export function startCashPool(state: State, ctx: Ctx): State {
  requireAdmin(state, ctx);
  if (cycleInfo(state).cycleNo > 0) throw new DomainError('Die Kasse läuft bereits.');
  return refill(state, ctx, 1);
}

// ---------- Serie ----------
export function seriesDates(rule: SeriesRule, until: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const step = Math.max(1, Math.round(rule.intervalWeeks)) * 7;
  for (let d = rule.startDate; diffDays(d, until) <= 0; d = addDays(d, step)) out.push(d);
  return out;
}

/** Legt fehlende Serientermine bis Horizont an. Bestehende (auch verschobene/abgesagte) bleiben unberührt. */
export function ensureSeries(state: State, now: Date): State {
  if (!state.series) return state;
  const until = addDays(localToday(now), SERIES_HORIZON_DAYS);
  const known = new Set(state.events.filter((e) => e.originalSeriesDate).map((e) => e.originalSeriesDate));
  const admin = state.members.find((m) => m.role === 'admin')?.id ?? state.currentUserId;
  const add: StEvent[] = [];
  for (const d of seriesDates(state.series, until)) {
    if (known.has(d)) continue;
    add.push({
      id: 't' + d.replace(/-/g, ''), type: 'stammtisch', title: state.series.title, date: d, time: state.series.time,
      location: '', description: '', status: 'planned', originalSeriesDate: d,
      createdAt: now.toISOString(), createdBy: admin,
    });
  }
  return add.length ? { ...state, events: [...state.events, ...add] } : state;
}

export function updateSeries(state: State, ctx: Ctx, rule: SeriesRule): State {
  requireAdmin(state, ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate)) throw new DomainError('Bitte ein gültiges Startdatum wählen.');
  if (!(rule.intervalWeeks >= 1 && rule.intervalWeeks <= 8)) throw new DomainError('Das Intervall muss zwischen 1 und 8 Wochen liegen.');
  if (!/^\d{2}:\d{2}$/.test(rule.time)) throw new DomainError('Bitte eine Uhrzeit angeben.');
  const t = today(ctx);
  // Zukünftige, unveränderte und unberührte Serientermine werden neu erzeugt.
  const touched = (id: string) =>
    state.notes.some((n) => n.eventId === id) || state.media.some((m) => m.eventId === id) ||
    state.expenses.some((x) => x.eventId === id && !x.voidedAt);
  const removeIds = new Set(state.events
    .filter((e) => e.originalSeriesDate && !e.detached && e.status === 'planned' && e.date > t && !touched(e.id))
    .map((e) => e.id));
  const s: State = {
    ...state,
    series: { startDate: rule.startDate, intervalWeeks: rule.intervalWeeks, time: rule.time, title: rule.title.trim() || 'Stammtisch' },
    events: state.events.filter((e) => !removeIds.has(e.id)),
    attendance: state.attendance.filter((a) => !removeIds.has(a.eventId)),
  };
  return ensureSeries(s, ctx.now);
}

// ---------- Termine ----------
export interface EventInput { type: EventType; title: string; date: ISODate; endDate?: ISODate; time: string; endTime?: string; allDay?: boolean; location: string; description: string; ideaId?: string }

/** Uhrzeiten normalisieren: ganztägig ohne Zeiten; Ende muss nach dem Beginn liegen. */
function normTimes(date: ISODate, endDate: ISODate | undefined, time: string, endTime: string | undefined, allDay: boolean | undefined) {
  if (allDay) return { time: '', endTime: undefined, allDay: true };
  if (!/^\d{2}:\d{2}$/.test(time)) throw new DomainError('Bitte eine Uhrzeit für den Beginn angeben.');
  const et = endTime && /^\d{2}:\d{2}$/.test(endTime) ? endTime : undefined;
  if (et && (!endDate || endDate === date) && et <= time) throw new DomainError('Das Ende liegt vor dem Beginn.');
  return { time, endTime: et, allDay: undefined };
}

/** Prüft das Enddatum. Mehrtägig dürfen nur zusätzliche Events sein. */
function normEnd(type: EventType, date: ISODate, endDate?: ISODate): ISODate | undefined {
  if (!endDate || endDate === date) return undefined;
  if (type === 'stammtisch') throw new DomainError('Ein Stammtisch ist immer eintägig. Für Ausflüge ein Event anlegen.');
  if (endDate < date) throw new DomainError('Das Ende liegt vor dem Beginn.');
  if (diffDays(endDate, date) + 1 > MAX_EVENT_DAYS) throw new DomainError(`Ein Event darf höchstens ${MAX_EVENT_DAYS} Tage dauern.`);
  return endDate;
}

export function createEvent(state: State, ctx: Ctx, input: EventInput): { state: State; id: string } {
  requireMember(state, ctx);
  if (input.type === 'stammtisch') requireAdmin(state, ctx);
  if (!input.title.trim()) throw new DomainError('Bitte einen Titel angeben.');
  if (!input.date) throw new DomainError('Bitte ein Datum wählen.');
  const id = uid('t');
  const endDate = normEnd(input.type, input.date, input.endDate);
  const t = normTimes(input.date, endDate, input.time || '19:00', input.endTime, input.allDay);
  const ev: StEvent = {
    id, type: input.type, title: input.title.trim(), date: input.date, endDate, ...t,
    location: input.location.trim(), description: input.description.trim(), status: 'planned', ideaId: input.ideaId,
    createdAt: iso(ctx), createdBy: ctx.actor,
  };
  return { state: { ...state, events: [...state.events, ev] }, id };
}

function canEditEvent(state: State, ctx: Ctx, ev: StEvent) {
  if (isAdmin(state, ctx.actor)) return true;
  return ev.type === 'event' && ev.createdBy === ctx.actor;
}

export function updateEvent(state: State, ctx: Ctx, id: string, patch: Partial<Pick<StEvent, 'title' | 'date' | 'endDate' | 'time' | 'endTime' | 'allDay' | 'location' | 'description'>>): State {
  const ev = getEvent(state, id);
  if (!canEditEvent(state, ctx, ev)) throw new DomainError('Termine der Serie ändert nur der Admin.');
  if (ev.status === 'closed') throw new DomainError('Abgeschlossene Termine können nicht verschoben werden. Zuerst wieder öffnen.');
  const next: StEvent = { ...ev, ...patch };
  next.endDate = normEnd(ev.type, next.date, 'endDate' in patch ? patch.endDate : ev.endDate);
  Object.assign(next, normTimes(next.date, next.endDate, next.time || '19:00', 'endTime' in patch ? patch.endTime : ev.endTime, 'allDay' in patch ? patch.allDay : ev.allDay));
  if (ev.originalSeriesDate && (next.date !== ev.date || next.time !== ev.time || next.title !== ev.title)) next.detached = true;
  return { ...state, events: state.events.map((e) => (e.id === id ? next : e)) };
}

/** Den Ort legt die Runde von Treffen zu Treffen fest – das darf jedes Mitglied, solange der Termin geplant ist. */
export function setEventLocation(state: State, ctx: Ctx, id: string, location: string): State {
  requireMember(state, ctx);
  const ev = getEvent(state, id);
  if (ev.status !== 'planned') throw new DomainError('Der Ort lässt sich nur bei geplanten Terminen ändern.');
  return { ...state, events: state.events.map((e) => (e.id === id ? { ...e, location: location.trim().slice(0, 80) } : e)) };
}

/** Zuletzt genutzte Orte (neueste zuerst) – für Schnellauswahl. */
export function recentLocations(state: State, limit = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...state.events].sort((a, b) => b.date.localeCompare(a.date))) {
    const l = e.location.trim();
    if (l && !seen.has(l.toLowerCase())) { seen.add(l.toLowerCase()); out.push(l); }
    if (out.length >= limit) break;
  }
  return out;
}

export function cancelEvent(state: State, ctx: Ctx, id: string, reason: string): State {
  const ev = getEvent(state, id);
  if (!canEditEvent(state, ctx, ev)) throw new DomainError('Absagen darf nur der Admin.');
  if (ev.status !== 'planned') throw new DomainError('Nur geplante Termine können abgesagt werden.');
  if (state.expenses.some((x) => x.eventId === id && !x.voidedAt)) throw new DomainError('Es sind noch Auslagen erfasst. Bitte erst löschen oder einem anderen Termin zuordnen.');
  return { ...state, events: state.events.map((e) => (e.id === id ? { ...e, status: 'cancelled', cancelReason: reason.trim(), detached: e.originalSeriesDate ? true : e.detached } : e)) };
}

export function restoreEvent(state: State, ctx: Ctx, id: string): State {
  const ev = getEvent(state, id);
  if (!canEditEvent(state, ctx, ev)) throw new DomainError('Das darf nur der Admin.');
  if (ev.status !== 'cancelled') return state;
  return { ...state, events: state.events.map((e) => (e.id === id ? { ...e, status: 'planned', cancelReason: undefined } : e)) };
}

export function deleteEvent(state: State, ctx: Ctx, id: string): State {
  const ev = getEvent(state, id);
  if (!canEditEvent(state, ctx, ev)) throw new DomainError('Das darf nur der Admin oder wer das Event angelegt hat.');
  if (ev.originalSeriesDate) throw new DomainError('Serientermine werden abgesagt, nicht gelöscht.');
  if (ev.status === 'closed' || state.ledger.some((l) => l.eventId === id)) throw new DomainError('Termine mit Buchungen können nicht gelöscht werden.');
  if (state.expenses.some((x) => x.eventId === id && !x.voidedAt)) throw new DomainError('Bitte zuerst die Auslagen löschen.');
  return {
    ...state,
    events: state.events.filter((e) => e.id !== id),
    attendance: state.attendance.filter((a) => a.eventId !== id),
    ideas: state.ideas.map((i) => (i.eventId === id ? { ...i, eventId: undefined, status: i.status === 'planned' ? 'open' : i.status } : i)),
  };
}

export function setRsvp(state: State, ctx: Ctx, eventId: string, memberId: string, rsvp: Rsvp): State {
  requireMember(state, ctx);
  if (memberId !== ctx.actor && !isAdmin(state, ctx.actor)) throw new DomainError('Du kannst nur deine eigene Teilnahme melden.');
  const ev = getEvent(state, eventId);
  if (ev.status !== 'planned') throw new DomainError(ev.status === 'cancelled' ? 'Der Termin ist abgesagt.' : 'Der Termin ist schon abgeschlossen.');
  const rest = state.attendance.filter((a) => !(a.eventId === eventId && a.memberId === memberId));
  const prev = state.attendance.find((a) => a.eventId === eventId && a.memberId === memberId);
  const rec: Attendance = { eventId, memberId, rsvp, present: prev?.present, updatedAt: iso(ctx) };
  return { ...state, attendance: [...rest, rec] };
}

export function rsvpOf(state: State, eventId: string, memberId: string): Rsvp {
  return state.attendance.find((a) => a.eventId === eventId && a.memberId === memberId)?.rsvp ?? 'open';
}
export function presentIds(state: State, eventId: string): string[] {
  return byOrder(state, state.attendance.filter((a) => a.eventId === eventId && a.present).map((a) => a.memberId));
}

// ---------- Abrechnung ----------
export interface ClosePreview {
  billable: boolean;
  reason?: string;
  payout: Map<string, Cents>;
  expenseShares: Map<string, Cents>; // Kostenanteil je Anwesendem (positiv)
  expenseTotal: Cents;
  triggersRefill: boolean;
  error?: string;
}

export function previewClose(state: State, eventId: string, present: string[]): ClosePreview {
  const ev = getEvent(state, eventId);
  const ids = byOrder(state, present);
  const pending = pendingExpenses(state, eventId);
  const expenseTotal = pending.reduce((a, x) => a + x.amount, 0);
  const expenseShares = new Map<string, Cents>();
  for (const x of pending) for (const [id, v] of splitCents(x.amount, ids, seedFrom(x.id))) expenseShares.set(id, (expenseShares.get(id) ?? 0) + v);
  const info = cycleInfo(state);
  let billable = ev.type === 'stammtisch' && ids.length >= 2;
  let reason: string | undefined;
  let error: string | undefined;
  if (ev.type !== 'stammtisch') reason = 'Zusätzliches Event: keine Topfausschüttung.';
  else if (ids.length < 2) reason = 'Weniger als zwei Anwesende: keine Topfausschüttung, der Zyklus zählt nicht weiter.';
  else if (info.cycleNo === 0) { billable = false; error = 'Die Kasse ist noch nicht gestartet (Admin: Kasse → Kasse starten).'; }
  else if (info.pot < PAYOUT_PER_MEETING) { billable = false; error = `Im Topf sind nur ${euro(info.pot)}. Für die Ausschüttung braucht es ${euro(PAYOUT_PER_MEETING)}.`; }
  if (pending.length && ids.length === 0) error = 'Es gibt Auslagen, aber niemand ist als anwesend markiert.';
  const payout = billable ? splitCents(PAYOUT_PER_MEETING, ids, seedFrom(eventId)) : new Map<string, Cents>();
  return { billable, reason, payout, expenseShares, expenseTotal, triggersRefill: billable && info.settledInCycle + 1 >= MEETINGS_PER_CYCLE, error };
}

export function closeEvent(state: State, ctx: Ctx, eventId: string, present: string[]): State {
  requireAdmin(state, ctx);
  const ev = getEvent(state, eventId);
  if (ev.status === 'closed') throw new DomainError('Dieser Termin ist bereits abgerechnet.');
  if (ev.status === 'cancelled') throw new DomainError('Abgesagte Termine werden nicht abgerechnet.');
  if (ev.date > today(ctx)) throw new DomainError('Der Termin liegt in der Zukunft und kann noch nicht abgeschlossen werden.');
  if (endOf(ev) > today(ctx)) throw new DomainError('Das Event läuft noch. Abgerechnet wird nach dem letzten Tag.');
  const ids = byOrder(state, present);
  for (const id of ids) if (!state.members.some((m) => m.id === id)) throw new DomainError('Unbekanntes Mitglied in der Anwesenheit.');
  const p = previewClose(state, eventId, ids);
  if (p.error) throw new DomainError(p.error);

  let s = state;
  // 1) Anwesenheit festschreiben
  const set = new Set(ids);
  const others = s.attendance.filter((a) => a.eventId !== eventId);
  const mine = activeMembers(s).map((m) => ({
    eventId, memberId: m.id, rsvp: rsvpOf(s, eventId, m.id), present: set.has(m.id), updatedAt: iso(ctx),
  }));
  s = { ...s, attendance: [...others, ...mine] };
  // 2) Auslagen nur auf tatsächlich Anwesende
  for (const x of pendingExpenses(s, eventId)) s = bookExpense(s, ctx, x.id);
  // 3) Topfausschüttung + ggf. Auffüllung
  if (p.billable) {
    const legs: Leg[] = [...p.payout].map(([account, amount]) => ({ account, amount }));
    legs.push({ account: POT, amount: -PAYOUT_PER_MEETING });
    s = post(s, ctx, { kind: 'payout', date: ev.date, eventId, key: `payout:${eventId}`, text: `Topfgutschrift ${ev.title} (${ids.length} Anwesende)`, legs }).state;
    const info = cycleInfo(s);
    if (info.settledInCycle >= MEETINGS_PER_CYCLE) s = refill(s, ctx, info.cycleNo + 1, eventId);
  }
  return { ...s, events: s.events.map((e) => (e.id === eventId ? { ...e, status: 'closed', closedAt: iso(ctx) } : e)) };
}

export function reopenEvent(state: State, ctx: Ctx, eventId: string): State {
  requireAdmin(state, ctx);
  const ev = getEvent(state, eventId);
  if (ev.status !== 'closed') throw new DomainError('Der Termin ist nicht abgeschlossen.');
  const active = activeEntries(state.ledger);
  const payout = active.find((e) => e.kind === 'payout' && e.eventId === eventId);
  let s = state;
  if (payout) {
    const later = active.filter((e) => e.kind === 'payout' && e.seq > payout.seq);
    if (later.length) throw new DomainError('Nur der zuletzt abgerechnete Stammtisch kann wieder geöffnet werden. Spätere Abrechnungen zuerst zurücknehmen.');
    const trig = active.find((e) => e.kind === 'refill' && e.meta?.triggeredBy === eventId);
    if (trig) s = reverse(s, ctx, trig.id, `Storno Auffüllung (Abrechnung ${ev.title} zurückgenommen)`);
    s = reverse(s, ctx, payout.id, `Storno Topfgutschrift ${ev.title}`);
  }
  for (const e of activeEntries(s.ledger).filter((x) => x.kind === 'expense' && x.eventId === eventId)) {
    s = reverse(s, ctx, e.id, `Storno Auslage (Abrechnung ${ev.title} zurückgenommen)`);
  }
  if (potBalance(s.ledger) < 0) throw new DomainError('Der Topf würde negativ. Bitte zuerst die Sonderausschüttung seit dieser Abrechnung stornieren.');
  return { ...s, events: s.events.map((e) => (e.id === eventId ? { ...e, status: 'planned', closedAt: undefined } : e)) };
}

// ---------- Auslagen ----------
export function expenseBooking(state: State, expenseId: string): LedgerEntry | undefined {
  return activeEntries(state.ledger).find((e) => e.kind === 'expense' && e.refId === expenseId);
}
export function pendingExpenses(state: State, eventId: string) {
  return state.expenses.filter((x) => x.eventId === eventId && !x.voidedAt && !expenseBooking(state, x.id));
}

function bookExpense(state: State, ctx: Ctx, expenseId: string): State {
  const x = state.expenses.find((e) => e.id === expenseId)!;
  const ev = getEvent(state, x.eventId);
  const ids = presentIds(state, x.eventId);
  if (!ids.length) throw new DomainError('Niemand war anwesend – die Auslage kann nicht verteilt werden.');
  const legs: Leg[] = [{ account: x.payerId, amount: x.amount }];
  for (const [id, v] of splitCents(x.amount, ids, seedFrom(x.id))) legs.push({ account: id, amount: -v });
  return post(state, ctx, {
    kind: 'expense', date: ev.date, eventId: ev.id, refId: x.id, key: `expense:${x.id}`,
    text: `${x.description} – bezahlt von ${nameOf(state, x.payerId)}`, legs,
  }).state;
}

export function addExpense(state: State, ctx: Ctx, input: { eventId: string; payerId: string; amount: Cents; description: string }): State {
  requireMember(state, ctx);
  checkAmount(input.amount);
  const ev = getEvent(state, input.eventId);
  if (ev.status === 'cancelled') throw new DomainError('Der Termin ist abgesagt – dort können keine Auslagen erfasst werden.');
  if (ev.status === 'closed' && !isAdmin(state, ctx.actor)) throw new DomainError('Der Termin ist schon abgerechnet. Nachträge macht nur der Admin.');
  memberOf(state, input.payerId);
  if (!input.description.trim()) throw new DomainError('Wofür war die Auslage? Bitte kurz beschreiben.');
  const x = { id: uid('a'), eventId: ev.id, payerId: input.payerId, amount: input.amount, description: input.description.trim(), createdBy: ctx.actor, createdAt: iso(ctx) };
  let s: State = { ...state, expenses: [...state.expenses, x] };
  if (ev.status === 'closed') s = bookExpense(s, ctx, x.id);
  return s;
}

export function voidExpense(state: State, ctx: Ctx, expenseId: string): State {
  requireMember(state, ctx);
  const x = state.expenses.find((e) => e.id === expenseId);
  if (!x || x.voidedAt) throw new DomainError('Auslage nicht gefunden.');
  if (x.createdBy !== ctx.actor && x.payerId !== ctx.actor && !isAdmin(state, ctx.actor)) throw new DomainError('Nur wer die Auslage erfasst hat oder der Admin darf sie löschen.');
  let s = state;
  const b = expenseBooking(s, x.id);
  if (b && !isAdmin(state, ctx.actor)) throw new DomainError('Die Auslage ist schon abgerechnet. Stornieren kann nur der Admin.');
  if (b) s = reverse(s, ctx, b.id, `Storno Auslage: ${x.description}`);
  return { ...s, expenses: s.expenses.map((e) => (e.id === expenseId ? { ...e, voidedAt: iso(ctx), voidedBy: ctx.actor } : e)) };
}

// ---------- Ausgleich, Anfangsbestand, Sonderbuchungen ----------
export function addSettlement(state: State, ctx: Ctx, input: { fromId: string; toId: string; amount: Cents; date: ISODate; note: string }): State {
  requireMember(state, ctx);
  checkAmount(input.amount);
  if (input.fromId === input.toId) throw new DomainError('Zahler und Empfänger müssen verschieden sein.');
  memberOf(state, input.fromId); memberOf(state, input.toId);
  return post(state, ctx, {
    kind: 'settlement', date: input.date || today(ctx),
    text: `${nameOf(state, input.fromId)} → ${nameOf(state, input.toId)}${input.note.trim() ? ': ' + input.note.trim() : ''}`,
    legs: [{ account: input.fromId, amount: input.amount }, { account: input.toId, amount: -input.amount }],
  }).state;
}

export function reverseEntry(state: State, ctx: Ctx, entryId: string, reason: string): State {
  const e = state.ledger.find((x) => x.id === entryId);
  if (!e) throw new DomainError('Buchung nicht gefunden.');
  const own = e.kind === 'settlement' && e.createdBy === ctx.actor;
  if (!own) requireAdmin(state, ctx);
  if (e.kind === 'refill' || e.kind === 'payout') throw new DomainError('Topfgutschriften und Auffüllungen werden über „Abrechnung zurücknehmen“ am Termin korrigiert.');
  if (e.kind === 'expense') throw new DomainError('Auslagen bitte direkt bei der Auslage löschen.');
  if (e.kind === 'special_in') {
    const after = potBalance(state.ledger) - e.legs.filter((l) => l.account === POT).reduce((a, l) => a + l.amount, 0);
    if (after < cycleInfo(state).reserve) throw new DomainError('Ohne diese Zuführung reicht der Topf nicht mehr für die anstehenden Stammtische.');
  }
  return reverse(state, ctx, entryId, `Storno: ${e.text}${reason.trim() ? ' – ' + reason.trim() : ''}`);
}

export interface OpeningClaim { debtorId: string; creditorId: string; amount: Cents }

export function openingImported(state: State) { return activeEntries(state.ledger).find((e) => e.kind === 'opening'); }

export function importOpening(state: State, ctx: Ctx, claims: OpeningClaim[], date: ISODate): State {
  requireAdmin(state, ctx);
  if (!claims.length) throw new DomainError('Es sind keine Forderungen erfasst.');
  const legs: Leg[] = [];
  for (const c of claims) {
    checkAmount(c.amount);
    if (c.debtorId === c.creditorId) throw new DomainError('Schuldner und Gläubiger müssen verschieden sein.');
    memberOf(state, c.debtorId); memberOf(state, c.creditorId);
    legs.push({ account: c.creditorId, amount: c.amount }, { account: c.debtorId, amount: -c.amount });
  }
  // Konten zusammenfassen
  const sum = new Map<string, Cents>();
  for (const l of legs) sum.set(l.account, (sum.get(l.account) ?? 0) + l.amount);
  return post(state, ctx, {
    kind: 'opening', date, key: 'opening',
    text: `Anfangsbestand aus Splitwise (${claims.length} Forderung${claims.length === 1 ? '' : 'en'})`,
    legs: [...sum].map(([account, amount]) => ({ account, amount })),
    meta: { claims: claims.map((c) => ({ ...c })) },
  }).state;
}

export type SpecialInMode = 'all' | 'selected' | 'external';

export function specialIn(state: State, ctx: Ctx, input: { amount: Cents; mode: SpecialInMode; memberIds: string[]; holderId?: string; reason: string; date: ISODate }): State {
  requireAdmin(state, ctx);
  checkAmount(input.amount);
  if (!input.reason.trim()) throw new DomainError('Bitte einen Grund angeben.');
  let payers: string[];
  if (input.mode === 'all') payers = activeMembers(state).map((m) => m.id);
  else if (input.mode === 'selected') payers = byOrder(state, input.memberIds);
  else { if (!input.holderId) throw new DomainError('Wer verwahrt die Spende? Bitte ein Mitglied wählen.'); payers = [input.holderId]; }
  if (!payers.length) throw new DomainError('Bitte mindestens ein Mitglied auswählen.');
  const legs: Leg[] = [{ account: POT, amount: input.amount }];
  for (const [id, v] of splitCents(input.amount, payers, seedFrom(input.reason))) legs.push({ account: id, amount: -v });
  const how = input.mode === 'external' ? `externe Spende, verwahrt von ${nameOf(state, payers[0])}` : input.mode === 'all' ? 'alle gleich' : payers.map((p) => nameOf(state, p)).join(', ');
  return post(state, ctx, { kind: 'special_in', date: input.date || today(ctx), text: `Sonderzuführung: ${input.reason.trim()} (${how})`, legs, meta: { mode: input.mode } }).state;
}

export function specialOut(state: State, ctx: Ctx, input: { amount: Cents; recipientIds: string[]; reason: string; date: ISODate }): State {
  requireAdmin(state, ctx);
  checkAmount(input.amount);
  if (!input.reason.trim()) throw new DomainError('Bitte einen Grund angeben.');
  const ids = byOrder(state, input.recipientIds);
  if (!ids.length) throw new DomainError('Bitte mindestens einen Empfänger auswählen.');
  const info = cycleInfo(state);
  if (input.amount > info.available) {
    throw new DomainError(`Frei verfügbar sind nur ${euro(info.available)} (Topf ${euro(info.pot)}, davon ${euro(info.reserve)} reserviert für die nächsten Stammtische).`);
  }
  const legs: Leg[] = [{ account: POT, amount: -input.amount }];
  for (const [id, v] of splitCents(input.amount, ids, seedFrom(input.reason))) legs.push({ account: id, amount: v });
  return post(state, ctx, { kind: 'special_out', date: input.date || today(ctx), text: `Sonderausschüttung: ${input.reason.trim()} (an ${ids.map((i) => nameOf(state, i)).join(', ')})`, legs }).state;
}

// ---------- Notizen & Medien ----------
export function addNote(state: State, ctx: Ctx, eventId: string, text: string, decision: boolean): State {
  requireMember(state, ctx);
  getEvent(state, eventId);
  if (!text.trim()) throw new DomainError('Die Notiz ist leer.');
  const n = { id: uid('n'), eventId, authorId: ctx.actor, text: text.trim(), decision, createdAt: iso(ctx), updatedAt: iso(ctx), updatedBy: ctx.actor };
  return { ...state, notes: [...state.notes, n] };
}
export function updateNote(state: State, ctx: Ctx, id: string, patch: { text?: string; decision?: boolean }): State {
  requireMember(state, ctx);
  if (patch.text !== undefined && !patch.text.trim()) throw new DomainError('Die Notiz ist leer.');
  return { ...state, notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch, text: (patch.text ?? n.text).trim(), updatedAt: iso(ctx), updatedBy: ctx.actor } : n)) };
}
export function deleteNote(state: State, ctx: Ctx, id: string): State {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return state;
  if (n.authorId !== ctx.actor && !isAdmin(state, ctx.actor)) throw new DomainError('Nur wer die Notiz geschrieben hat oder der Admin darf sie löschen.');
  return { ...state, notes: state.notes.filter((x) => x.id !== id) };
}
export function addMedia(state: State, ctx: Ctx, m: { id: string; eventId: string; width: number; height: number; bytes: number }): State {
  requireMember(state, ctx);
  getEvent(state, m.eventId);
  if (!ID_RE.test(m.id) || state.media.some((x) => x.id === m.id)) throw new DomainError('Ungültige Foto-Kennung.');
  if (!(m.bytes > 0 && m.bytes <= 5 * 1024 * 1024)) throw new DomainError('Das Foto ist zu groß (max. 5 MB nach Verkleinerung).');
  return { ...state, media: [...state.media, { id: m.id, eventId: m.eventId, width: Math.round(m.width), height: Math.round(m.height), bytes: Math.round(m.bytes), uploaderId: ctx.actor, createdAt: iso(ctx) }] };
}
export function deleteMedia(state: State, ctx: Ctx, id: string): State {
  const m = state.media.find((x) => x.id === id);
  if (!m) return state;
  if (m.uploaderId !== ctx.actor && !isAdmin(state, ctx.actor)) throw new DomainError('Nur wer das Foto hochgeladen hat oder der Admin darf es löschen.');
  return { ...state, media: state.media.filter((x) => x.id !== id) };
}

// ---------- Ideen ----------
export function addIdea(state: State, ctx: Ctx, input: { title: string; description: string }): { state: State; id: string } {
  requireMember(state, ctx);
  if (!input.title.trim()) throw new DomainError('Bitte einen Titel angeben.');
  const id = uid('i');
  const idea: Idea = { id, title: input.title.trim(), description: input.description.trim(), creatorId: ctx.actor, status: 'open', checklist: [], createdAt: iso(ctx), updatedAt: iso(ctx), updatedBy: ctx.actor };
  return { state: { ...state, ideas: [idea, ...state.ideas] }, id };
}
export function canEditIdea(state: State, actor: string, idea: Idea) {
  return idea.creatorId === actor && state.members.some((m) => m.id === actor && m.status === 'active');
}
export function updateIdea(state: State, ctx: Ctx, id: string, patch: Partial<Pick<Idea, 'title' | 'description' | 'status' | 'checklist' | 'eventId'>>): State {
  requireMember(state, ctx);
  const idea = state.ideas.find((i) => i.id === id);
  if (!idea) throw new DomainError('Idee nicht gefunden.');
  if (!canEditIdea(state, ctx.actor, idea)) throw new DomainError('Nur wer die Idee eingebracht hat, kann sie bearbeiten. Du kannst sie kommentieren oder bewerten.');
  if (patch.title !== undefined && !patch.title.trim()) throw new DomainError('Der Titel darf nicht leer sein.');
  return { ...state, ideas: state.ideas.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: iso(ctx), updatedBy: ctx.actor } : i)) };
}
export function setIdeaStatus(state: State, ctx: Ctx, id: string, status: IdeaStatus) { return updateIdea(state, ctx, id, { status }); }
export function deleteIdea(state: State, ctx: Ctx, id: string): State {
  const i = state.ideas.find((x) => x.id === id);
  if (!i) return state;
  if (i.creatorId !== ctx.actor && !isAdmin(state, ctx.actor)) throw new DomainError('Nur wer die Idee angelegt hat oder der Admin darf sie löschen.');
  return { ...state, ideas: state.ideas.filter((x) => x.id !== id), ideaComments: state.ideaComments.filter((c) => c.ideaId !== id), ideaVotes: state.ideaVotes.filter((v) => v.ideaId !== id) };
}

export function addIdeaComment(state: State, ctx: Ctx, ideaId: string, text: string): State {
  requireMember(state, ctx);
  if (!state.ideas.some((i) => i.id === ideaId)) throw new DomainError('Idee nicht gefunden.');
  if (!text.trim()) throw new DomainError('Der Kommentar ist leer.');
  const c: IdeaComment = { id: uid('k'), ideaId, authorId: ctx.actor, text: text.trim().slice(0, 1000), createdAt: iso(ctx), updatedAt: iso(ctx) };
  return { ...state, ideaComments: [...state.ideaComments, c] };
}
export function updateIdeaComment(state: State, ctx: Ctx, id: string, text: string): State {
  const c = state.ideaComments.find((x) => x.id === id);
  if (!c) throw new DomainError('Kommentar nicht gefunden.');
  if (c.authorId !== ctx.actor) throw new DomainError('Nur eigene Kommentare lassen sich bearbeiten.');
  if (!text.trim()) throw new DomainError('Der Kommentar ist leer.');
  return { ...state, ideaComments: state.ideaComments.map((x) => (x.id === id ? { ...x, text: text.trim().slice(0, 1000), updatedAt: iso(ctx) } : x)) };
}
export function deleteIdeaComment(state: State, ctx: Ctx, id: string): State {
  const c = state.ideaComments.find((x) => x.id === id);
  if (!c) return state;
  if (c.authorId !== ctx.actor && !isAdmin(state, ctx.actor)) throw new DomainError('Nur eigene Kommentare lassen sich löschen.');
  return { ...state, ideaComments: state.ideaComments.filter((x) => x.id !== id) };
}
/** Daumen hoch/runter. Gleicher Wert nochmal = zurücknehmen. Eine Stimme pro Person und Idee. */
export function voteIdea(state: State, ctx: Ctx, ideaId: string, value: 1 | -1): State {
  requireMember(state, ctx);
  if (!state.ideas.some((i) => i.id === ideaId)) throw new DomainError('Idee nicht gefunden.');
  const prev = state.ideaVotes.find((v) => v.ideaId === ideaId && v.memberId === ctx.actor);
  const rest = state.ideaVotes.filter((v) => !(v.ideaId === ideaId && v.memberId === ctx.actor));
  if (prev?.value === value) return { ...state, ideaVotes: rest };
  return { ...state, ideaVotes: [...rest, { ideaId, memberId: ctx.actor, value, updatedAt: iso(ctx) }] };
}
export function ideaScore(state: State, ideaId: string) {
  const v = state.ideaVotes.filter((x) => x.ideaId === ideaId);
  return { up: v.filter((x) => x.value === 1).length, down: v.filter((x) => x.value === -1).length };
}
export function planIdea(state: State, ctx: Ctx, ideaId: string, input: Omit<EventInput, 'type' | 'ideaId'>): { state: State; id: string } {
  const idea = state.ideas.find((i) => i.id === ideaId);
  if (!idea) throw new DomainError('Idee nicht gefunden.');
  const r = createEvent(state, ctx, { ...input, type: 'event', ideaId });
  return { state: updateIdea(r.state, ctx, ideaId, { eventId: r.id, status: 'planned' }), id: r.id };
}

// ---------- Mitglieder & Einladungen ----------
/** `token`: in der Supabase-Version der SHA-256-Hash des Links (der Server erzeugt den Link selbst). */
export function inviteMember(state: State, ctx: Ctx, email: string, token?: string): { state: State; token: string } {
  requireAdmin(state, ctx);
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new DomainError('Bitte eine gültige E-Mail-Adresse eingeben.');
  if (state.members.some((m) => m.email.toLowerCase() === e && m.status === 'active')) throw new DomainError('Diese Person ist schon Mitglied.');
  token = token ?? (uid() + uid()).replace(/[^a-z0-9]/g, '').slice(0, 24);
  const inv = { id: uid('e'), token, email: e, createdAt: iso(ctx), expiresAt: new Date(ctx.now.getTime() + INVITE_DAYS * 86400000).toISOString(), createdBy: ctx.actor };
  return { state: { ...state, invitations: [inv, ...state.invitations] }, token };
}
export function revokeInvite(state: State, ctx: Ctx, id: string): State {
  requireAdmin(state, ctx);
  return { ...state, invitations: state.invitations.map((i) => (i.id === id && !i.usedAt ? { ...i, revokedAt: iso(ctx) } : i)) };
}
export function inviteState(inv: { usedAt?: string; revokedAt?: string; expiresAt: string }, now: Date): 'open' | 'used' | 'revoked' | 'expired' {
  if (inv.usedAt) return 'used';
  if (inv.revokedAt) return 'revoked';
  if (new Date(inv.expiresAt) < now) return 'expired';
  return 'open';
}
export function acceptInvite(state: State, now: Date, token: string, input: { name: string; email: string; password: string; userId?: string }): { state: State; memberId: string } {
  const inv = state.invitations.find((i) => i.token === token);
  if (!inv) throw new DomainError('Diese Einladung gibt es nicht.');
  const st = inviteState(inv, now);
  if (st === 'used') throw new DomainError('Diese Einladung wurde schon verwendet.');
  if (st === 'revoked') throw new DomainError('Diese Einladung wurde zurückgezogen.');
  if (st === 'expired') throw new DomainError('Diese Einladung ist abgelaufen. Bitte den Admin um einen neuen Link.');
  if (!input.name.trim()) throw new DomainError('Bitte einen Anzeigenamen wählen.');
  if (input.password.length < 8) throw new DomainError('Das Passwort braucht mindestens 8 Zeichen.');
  if (state.members.some((m) => m.name.toLowerCase() === input.name.trim().toLowerCase())) throw new DomainError('Dieser Anzeigename ist schon vergeben.');
  const id = uid('m');
  const m: Member = { id, name: input.name.trim(), email: (input.email || inv.email).trim(), role: 'member', status: 'active', joinedAt: now.toISOString(), order: state.members.reduce((a, x) => Math.max(a, x.order), 0) + 1, userId: input.userId };
  return {
    state: { ...state, members: [...state.members, m], invitations: state.invitations.map((i) => (i.id === inv.id ? { ...i, usedAt: now.toISOString(), usedBy: id } : i)) },
    memberId: id,
  };
}
export function setMemberRole(state: State, ctx: Ctx, id: string, role: Member['role']): State {
  requireAdmin(state, ctx);
  if (role === 'member' && state.members.filter((m) => m.role === 'admin' && m.status === 'active' && m.id !== id).length === 0) throw new DomainError('Es muss mindestens einen Admin geben.');
  return { ...state, members: state.members.map((m) => (m.id === id ? { ...m, role } : m)) };
}
export function setMemberStatus(state: State, ctx: Ctx, id: string, status: Member['status']): State {
  requireAdmin(state, ctx);
  if (status === 'inactive' && state.members.filter((m) => m.role === 'admin' && m.status === 'active' && m.id !== id).length === 0 && isAdmin(state, id)) throw new DomainError('Der letzte Admin kann nicht deaktiviert werden.');
  return { ...state, members: state.members.map((m) => (m.id === id ? { ...m, status } : m)) };
}
export function renameMember(state: State, ctx: Ctx, id: string, name: string): State {
  if (id !== ctx.actor) requireAdmin(state, ctx);
  if (!name.trim()) throw new DomainError('Der Name darf nicht leer sein.');
  return { ...state, members: state.members.map((m) => (m.id === id ? { ...m, name: name.trim() } : m)) };
}
