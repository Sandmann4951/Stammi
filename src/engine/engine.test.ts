import { describe, expect, it } from 'vitest';
import * as A from './actions';
import * as finance from './finance';
import { breakdown, cycleInfo, ledgerCsv, potBalance, rawBalances, standings, suggestPayments } from './finance';
import { POT, type State } from './types';
import { dayCount, daysOf, parseEuro, splitCents } from './util';

const NOW = new Date('2026-10-27T18:00:00');
const ctxOf = (actor: string, now = NOW): A.Ctx => ({ actor, now });

function setup(n = 5) {
  let s = A.createGroup('Test', { name: 'Admin', email: 'a@x.de' }, NOW);
  const admin = s.members[0].id;
  for (let i = 1; i < n; i++) {
    const r = A.inviteMember(s, ctxOf(admin), `m${i}@x.de`);
    s = A.acceptInvite(r.state, NOW, r.token, { name: `M${i}`, email: `m${i}@x.de`, password: 'geheim123' }).state;
  }
  s = A.updateSeries(s, ctxOf(admin), { startDate: '2026-08-31', intervalWeeks: 2, time: '19:00', location: 'Wirtshaus', title: 'Stammtisch' });
  s = A.startCashPool(s, ctxOf(admin));
  const ids = s.members.map((m) => m.id);
  return { s, admin, ids };
}
const series = (s: State) => s.events.filter((e) => e.originalSeriesDate).sort((a, b) => a.date.localeCompare(b.date));
const sumStandings = (s: State) => [...standings(s).values()].reduce((a, b) => a + b, 0);

describe('Geld-Hilfen', () => {
  it('teilt centgenau mit deterministischem Rest', () => {
    const m = splitCents(5000, ['a', 'b', 'c']);
    expect([...m.values()].reduce((a, b) => a + b)).toBe(5000);
    expect([...m.values()].sort()).toEqual([1666, 1667, 1667]);
    expect(splitCents(5000, ['a', 'b', 'c'], 7)).toEqual(splitCents(5000, ['a', 'b', 'c'], 7));
  });
  it('parst deutsche Eingaben', () => {
    expect(parseEuro('12,50')).toBe(1250);
    expect(parseEuro('1.234,5')).toBe(123450);
    expect(parseEuro('40')).toBe(4000);
    expect(parseEuro('7.5')).toBe(750);
    expect(parseEuro('abc')).toBeNull();
    expect(parseEuro('1,234')).toBeNull();
  });
});

describe('Kalender (Abnahme 1)', () => {
  it('erzeugt jeden zweiten Montag', () => {
    const { s } = setup();
    const d = series(s).map((e) => e.date);
    expect(d.slice(0, 4)).toEqual(['2026-08-31', '2026-09-14', '2026-09-28', '2026-10-12']);
    expect(d.every((x) => new Date(x + 'T12:00:00Z').getUTCDay() === 1)).toBe(true);
  });
  it('Verschiebung/Absage eines Termins ändert die Serie nicht', () => {
    const { s, admin } = setup();
    const [, second, third, fourth] = series(s);
    let t = A.updateEvent(s, ctxOf(admin), second.id, { date: '2026-09-16' });
    t = A.cancelEvent(t, ctxOf(admin), third.id, 'Urlaub');
    t = A.ensureSeries(t, NOW);
    const ev = series(t);
    expect(ev.find((e) => e.id === second.id)!.date).toBe('2026-09-16');
    expect(ev.find((e) => e.id === third.id)!.status).toBe('cancelled');
    expect(ev.find((e) => e.id === fourth.id)!.date).toBe('2026-10-12');
    expect(ev.filter((e) => e.originalSeriesDate === '2026-09-14')).toHaveLength(1);
    // Regeländerung lässt verschobene Termine in Ruhe
    t = A.updateSeries(t, ctxOf(admin), { ...t.series!, time: '19:30' });
    expect(series(t).find((e) => e.id === second.id)!.date).toBe('2026-09-16');
  });
});

describe('Topfausschüttung (Abnahme 2)', () => {
  for (const [n, expected] of [[2, [2500, 2500]], [3, [1666, 1667, 1667]], [4, [1250, 1250, 1250, 1250]], [5, [1000, 1000, 1000, 1000, 1000]]] as const) {
    it(`${n} Anwesende → 50 € centgenau`, () => {
      const { s, admin, ids } = setup();
      const ev = series(s)[0];
      const t = A.closeEvent(s, ctxOf(admin), ev.id, ids.slice(0, n));
      const payout = t.ledger.find((e) => e.kind === 'payout')!;
      const shares = payout.legs.filter((l) => l.account !== POT).map((l) => l.amount).sort();
      expect(shares).toEqual([...expected].sort());
      expect(potBalance(t.ledger)).toBe(5000);
    });
  }
  it('0/1 Anwesende und Absage → keine Ausschüttung, Zähler bleibt', () => {
    const { s, admin, ids } = setup();
    const [a, b, c] = series(s);
    let t = A.closeEvent(s, ctxOf(admin), a.id, []);
    t = A.closeEvent(t, ctxOf(admin), b.id, [ids[0]]);
    t = A.cancelEvent(t, ctxOf(admin), c.id, 'Krank');
    expect(t.ledger.filter((e) => e.kind === 'payout')).toHaveLength(0);
    expect(cycleInfo(t).settledInCycle).toBe(0);
    expect(potBalance(t.ledger)).toBe(10000);
  });
  it('doppelte Abrechnung wird verhindert', () => {
    const { s, admin, ids } = setup();
    const ev = series(s)[0];
    const t = A.closeEvent(s, ctxOf(admin), ev.id, ids);
    expect(() => A.closeEvent(t, ctxOf(admin), ev.id, ids)).toThrow(/bereits/);
  });
});

describe('Auslagen (Abnahme 3)', () => {
  it('Beispiel: A zahlt 40 €, A+B anwesend → 20 € Forderung + je 25 € Topf', () => {
    const { s, admin, ids } = setup();
    const [A_, B] = ids;
    const ev = series(s)[0];
    let t = A.addExpense(s, ctxOf(B), { eventId: ev.id, payerId: A_, amount: 4000, description: 'Getränke' });
    t = A.closeEvent(t, ctxOf(admin), ev.id, [A_, B]);
    const exp = t.ledger.find((e) => e.kind === 'expense')!;
    expect(exp.legs.find((l) => l.account === A_)!.amount).toBe(2000); // 40 − 20
    expect(exp.legs.find((l) => l.account === B)!.amount).toBe(-2000);
    expect(exp.legs.filter((l) => ![A_, B].includes(l.account))).toHaveLength(0); // nur Anwesende
    expect(breakdown(t, A_).byCategory.expense).toBe(2000);
    expect(breakdown(t, B).byCategory.expense).toBe(-2000);
    expect(breakdown(t, A_).byCategory.pot).toBe(2500);
    expect(breakdown(t, B).byCategory.pot).toBe(2500);
  });
  it('nachträgliche Auslage (Admin) wird sofort auf Anwesende gebucht, Storno per Gegenbuchung', () => {
    const { s, admin, ids } = setup();
    const ev = series(s)[0];
    let t = A.closeEvent(s, ctxOf(admin), ev.id, ids.slice(0, 3));
    const rawBefore = rawBalances(t).get(ids[2]);
    t = A.addExpense(t, ctxOf(admin), { eventId: ev.id, payerId: ids[2], amount: 3000, description: 'Brezn' });
    const x = t.expenses[0];
    expect(A.expenseBooking(t, x.id)).toBeTruthy();
    const before = t.ledger.length;
    t = A.voidExpense(t, ctxOf(admin), x.id);
    expect(t.ledger.length).toBe(before + 1);
    expect(t.ledger.at(-1)!.kind).toBe('reversal');
    expect(rawBalances(t).get(ids[2])).toBe(rawBefore); // Auslage vollständig neutralisiert
  });
});

describe('Zyklus (Abnahme 4)', () => {
  it('nach zwei abgerechneten Treffen genau einmal +100 €, auch mit Absage dazwischen und mehreren Treffen im Monat', () => {
    const { s, admin, ids } = setup();
    const [a, b, c, d] = series(s);
    let t = A.closeEvent(s, ctxOf(admin), a.id, ids);
    expect(potBalance(t.ledger)).toBe(5000);
    t = A.cancelEvent(t, ctxOf(admin), b.id, 'Feiertag');
    t = A.closeEvent(t, ctxOf(admin), c.id, ids.slice(0, 2));
    expect(potBalance(t.ledger)).toBe(10000);
    expect(t.ledger.filter((e) => e.kind === 'refill')).toHaveLength(2);
    expect(cycleInfo(t)).toMatchObject({ cycleNo: 2, settledInCycle: 0 });
    // Zusätzlicher Stammtisch im selben Monat
    const extra = A.createEvent(t, ctxOf(admin), { type: 'stammtisch', title: 'Sonder-Stammtisch', date: '2026-10-05', time: '19:00', location: 'X', description: '' });
    t = A.closeEvent(extra.state, ctxOf(admin), extra.id, ids);
    t = A.closeEvent(t, ctxOf(admin), d.id, ids);
    expect(t.ledger.filter((e) => e.kind === 'refill')).toHaveLength(3);
    expect(potBalance(t.ledger)).toBe(10000);
    expect(sumStandings(t)).toBe(0);
  });
  it('Wieder-Öffnen nimmt Ausschüttung und ausgelöste Auffüllung zurück; erneutes Abschließen ist reproduzierbar', () => {
    const { s, admin, ids } = setup();
    const [a, b] = series(s);
    let t = A.closeEvent(s, ctxOf(admin), a.id, ids);
    t = A.closeEvent(t, ctxOf(admin), b.id, ids.slice(0, 3));
    const st1 = standings(t);
    expect(() => A.reopenEvent(t, ctxOf(admin), a.id)).toThrow(/zuletzt/);
    t = A.reopenEvent(t, ctxOf(admin), b.id);
    expect(potBalance(t.ledger)).toBe(5000);
    expect(cycleInfo(t)).toMatchObject({ cycleNo: 1, settledInCycle: 1 });
    t = A.closeEvent(t, ctxOf(admin), b.id, ids.slice(0, 3));
    expect(standings(t)).toEqual(st1);
  });
});

describe('Sonderbuchungen (Abnahme 5)', () => {
  it('Zuführung/Ausschüttung konsistent, Zähler unverändert, Reserve geschützt', () => {
    const { s, admin, ids } = setup();
    let t = A.specialIn(s, ctxOf(admin), { amount: 3000, mode: 'selected', memberIds: [ids[1], ids[2]], reason: 'Geburtstag', date: '2026-10-01' });
    expect(potBalance(t.ledger)).toBe(13000);
    expect(cycleInfo(t).settledInCycle).toBe(0);
    expect(() => A.specialOut(t, ctxOf(admin), { amount: 3100, recipientIds: ids, reason: 'x', date: '2026-10-02' })).toThrow(/Frei verfügbar/);
    t = A.specialOut(t, ctxOf(admin), { amount: 3000, recipientIds: [ids[0], ids[3], ids[4]], reason: 'Taxi', date: '2026-10-02' });
    expect(potBalance(t.ledger)).toBe(10000);
    expect(sumStandings(t)).toBe(0);
    expect(() => A.specialIn(t, ctxOf(ids[1]), { amount: 100, mode: 'all', memberIds: [], reason: 'x', date: '2026-10-01' })).toThrow(/Admin/);
    // externe Spende
    t = A.specialIn(t, ctxOf(admin), { amount: 5000, mode: 'external', memberIds: [], holderId: ids[0], reason: 'Wirt spendiert', date: '2026-10-03' });
    expect(rawBalances(t).get(ids[0])).toBe(-2000 + 1000 - 5000);
    expect(sumStandings(t)).toBe(0);
  });
});

describe('Splitwise & Ausgleich (Abnahme 6)', () => {
  it('Anfangsbestand einmalig, Ausgleichszahlung reduziert Forderung', () => {
    const { s, admin, ids } = setup();
    const [a, b, c] = ids;
    let t = A.importOpening(s, ctxOf(admin), [{ debtorId: b, creditorId: a, amount: 2350 }, { debtorId: c, creditorId: a, amount: 1000 }], '2026-08-30');
    expect(() => A.importOpening(t, ctxOf(admin), [{ debtorId: b, creditorId: a, amount: 100 }], '2026-08-30')).toThrow(/existiert bereits/);
    expect(breakdown(t, a).byCategory.opening).toBe(3350);
    t = A.addSettlement(t, ctxOf(b), { fromId: b, toId: a, amount: 2350, date: '2026-09-01', note: 'PayPal' });
    expect(breakdown(t, b).byCategory.opening + breakdown(t, b).byCategory.settlement).toBe(0);
    expect(breakdown(t, a).byCategory.opening + breakdown(t, a).byCategory.settlement).toBe(1000);
  });
  it('Zahlungsvorschläge gleichen alle Stände aus', () => {
    const { s, admin, ids } = setup();
    const [a, b] = series(s);
    let t = A.addExpense(s, ctxOf(ids[0]), { eventId: a.id, payerId: ids[0], amount: 11200, description: 'Rechnung' });
    t = A.closeEvent(t, ctxOf(admin), a.id, ids.slice(0, 4));
    t = A.addExpense(t, ctxOf(ids[1]), { eventId: b.id, payerId: ids[1], amount: 6150, description: 'Rechnung' });
    t = A.closeEvent(t, ctxOf(admin), b.id, ids.slice(1, 4));
    const st = standings(t);
    expect(sumStandings(t)).toBe(0);
    const pay = suggestPayments(st);
    const after = new Map(st);
    for (const p of pay) { after.set(p.from, after.get(p.from)! + p.amount); after.set(p.to, after.get(p.to)! - p.amount); }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
    expect(pay.length).toBeLessThanOrEqual(ids.length - 1);
    expect(ledgerCsv(t).split('\n')[0]).toContain('Betrag');
  });
});

describe('Berechtigungen (Abnahme 7, fachliche Ebene)', () => {
  it('Mitglieder können nicht abrechnen, keine fremden Zusagen, keine Fremden-Aktionen', () => {
    const { s, ids } = setup();
    const ev = series(s)[0];
    expect(() => A.closeEvent(s, ctxOf(ids[1]), ev.id, ids)).toThrow(/Admin/);
    expect(() => A.setRsvp(s, ctxOf(ids[1]), ev.id, ids[2], 'yes')).toThrow(/eigene/);
    expect(() => A.addExpense(s, ctxOf('fremd'), { eventId: ev.id, payerId: ids[0], amount: 100, description: 'x' })).toThrow(/aktive Mitglieder/);
    expect(() => A.reverseEntry(s, ctxOf(ids[1]), s.ledger[0].id, '')).toThrow(/Admin/);
  });
  it('Einladungen laufen ab und sind nur einmal nutzbar', () => {
    const { s, admin } = setup();
    const r = A.inviteMember(s, ctxOf(admin), 'neu@x.de');
    const later = new Date(NOW.getTime() + 8 * 86400000);
    expect(() => A.acceptInvite(r.state, later, r.token, { name: 'Neu', email: '', password: '12345678' })).toThrow(/abgelaufen/);
    const ok = A.acceptInvite(r.state, NOW, r.token, { name: 'Neu', email: '', password: '12345678' });
    expect(() => A.acceptInvite(ok.state, NOW, r.token, { name: 'Neu2', email: '', password: '12345678' })).toThrow(/schon verwendet/);
  });
});

describe('Änderungswünsche Runde 2', () => {
  it('nach der Abrechnung dürfen nur Admins Auslagen nachtragen oder stornieren', () => {
    const { s, admin, ids } = setup();
    const ev = series(s)[0];
    let t = A.addExpense(s, ctxOf(ids[1]), { eventId: ev.id, payerId: ids[1], amount: 5000, description: 'Rechnung' });
    t = A.closeEvent(t, ctxOf(admin), ev.id, ids);
    expect(() => A.addExpense(t, ctxOf(ids[1]), { eventId: ev.id, payerId: ids[1], amount: 100, description: 'x' })).toThrow(/nur der Admin/);
    expect(() => A.voidExpense(t, ctxOf(ids[1]), t.expenses[0].id)).toThrow(/nur der Admin/);
    t = A.addExpense(t, ctxOf(admin), { eventId: ev.id, payerId: ids[2], amount: 1000, description: 'Nachtrag' });
    expect(t.expenses).toHaveLength(2);
  });
  it('Serie hat keinen festen Ort; Ort je Termin setzt jedes Mitglied, ohne den Termin aus der Serie zu lösen', () => {
    const { s, ids } = setup();
    const ev = series(s).at(-1)!;
    expect(ev.location).toBe('');
    const t = A.setEventLocation(s, ctxOf(ids[3]), ev.id, 'Gasthof Post');
    const e2 = t.events.find((e) => e.id === ev.id)!;
    expect(e2.location).toBe('Gasthof Post');
    expect(e2.detached).toBeFalsy();
    expect(A.recentLocations(t)).toEqual(['Gasthof Post']);
  });
  it('Zahler-Regel: wer am weitesten im Minus ist, sofern anwesend', () => {
    const { s, admin, ids } = setup();
    const [a] = series(s);
    let t = A.addExpense(s, ctxOf(ids[0]), { eventId: a.id, payerId: ids[0], amount: 10000, description: 'Rechnung' });
    t = A.closeEvent(t, ctxOf(admin), a.id, ids.slice(0, 4)); // ids[4] fehlt
    const all = finance.payerRanking(t);
    expect(all[0].standing).toBeLessThan(0);
    expect(all.every((x, i) => i === 0 || all[i - 1].standing <= x.standing)).toBe(true);
    const among = finance.payerRanking(t, [ids[1], ids[2]]);
    expect(among.every((x) => [ids[1], ids[2]].includes(x.id))).toBe(true);
  });
  it('Ideen: nur Ersteller bearbeitet; andere kommentieren und bewerten', () => {
    const { s, admin, ids } = setup();
    const r = A.addIdea(s, ctxOf(ids[1]), { title: 'Kegeln', description: '' });
    expect(() => A.updateIdea(r.state, ctxOf(ids[2]), r.id, { title: 'Bowling' })).toThrow(/eingebracht/);
    expect(() => A.updateIdea(r.state, ctxOf(admin), r.id, { status: 'done' })).toThrow(/eingebracht/);
    let t = A.updateIdea(r.state, ctxOf(ids[1]), r.id, { title: 'Kegelabend' });
    t = A.addIdeaComment(t, ctxOf(ids[2]), r.id, 'Bin dabei!');
    expect(() => A.updateIdeaComment(t, ctxOf(ids[3]), t.ideaComments[0].id, 'x')).toThrow(/eigene/);
    t = A.voteIdea(t, ctxOf(ids[2]), r.id, 1);
    t = A.voteIdea(t, ctxOf(ids[3]), r.id, -1);
    t = A.voteIdea(t, ctxOf(ids[3]), r.id, 1); // umentschieden
    expect(A.ideaScore(t, r.id)).toEqual({ up: 2, down: 0 });
    t = A.voteIdea(t, ctxOf(ids[3]), r.id, 1); // zurückgenommen
    expect(A.ideaScore(t, r.id)).toEqual({ up: 1, down: 0 });
  });
});

describe('Mehrtägige Events', () => {
  it('Zeitraum wird geprüft, Stammtische bleiben eintägig', () => {
    const { s, admin, ids } = setup();
    const r = A.createEvent(s, ctxOf(ids[1]), { type: 'event', title: 'Hüttenwochenende', date: '2026-10-23', endDate: '2026-10-25', time: '16:00', location: 'Hütte', description: '' });
    const ev = r.state.events.find((e) => e.id === r.id)!;
    expect(ev.endDate).toBe('2026-10-25');
    expect(dayCount(ev)).toBe(3);
    expect(daysOf(ev)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
    expect(() => A.createEvent(s, ctxOf(admin), { type: 'stammtisch', title: 'X', date: '2026-10-23', endDate: '2026-10-24', time: '19:00', location: '', description: '' })).toThrow(/eintägig/);
    expect(() => A.createEvent(s, ctxOf(ids[1]), { type: 'event', title: 'X', date: '2026-10-23', endDate: '2026-10-20', time: '19:00', location: '', description: '' })).toThrow(/vor dem Beginn/);
    // gleiches Datum = eintägig
    const r2 = A.createEvent(s, ctxOf(ids[1]), { type: 'event', title: 'Y', date: '2026-10-23', endDate: '2026-10-23', time: '19:00', location: '', description: '' });
    expect(r2.state.events.find((e) => e.id === r2.id)!.endDate).toBeUndefined();
  });
  it('Abrechnung erst nach dem letzten Tag, Auslagen nur auf Anwesende, kein Topf', () => {
    const { s, admin, ids } = setup();
    const r = A.createEvent(s, ctxOf(ids[1]), { type: 'event', title: 'Ausflug', date: '2026-10-26', endDate: '2026-10-28', time: '10:00', location: '', description: '' });
    let t = A.addExpense(r.state, ctxOf(ids[1]), { eventId: r.id, payerId: ids[1], amount: 30000, description: 'Unterkunft' });
    expect(() => A.closeEvent(t, ctxOf(admin), r.id, ids.slice(0, 3))).toThrow(/läuft noch/);
    const later = new Date('2026-10-28T20:00:00');
    t = A.closeEvent(t, ctxOf(admin, later), r.id, ids.slice(0, 3));
    expect(t.ledger.filter((e) => e.kind === 'payout')).toHaveLength(0);
    const exp = t.ledger.find((e) => e.kind === 'expense')!;
    expect(exp.legs).toHaveLength(3);
  });
});

describe('Endzeit & ganztägig', () => {
  it('Endzeit wird geprüft, ganztägig hat keine Zeiten', () => {
    const { s, ids } = setup();
    const base = { type: 'event' as const, title: 'X', date: '2026-11-20', location: '', description: '' };
    const r = A.createEvent(s, ctxOf(ids[1]), { ...base, time: '18:30', endTime: '23:00' });
    expect(r.state.events.find((e) => e.id === r.id)!.endTime).toBe('23:00');
    expect(() => A.createEvent(s, ctxOf(ids[1]), { ...base, time: '18:30', endTime: '17:00' })).toThrow(/vor dem Beginn/);
    const multi = A.createEvent(s, ctxOf(ids[1]), { ...base, endDate: '2026-11-22', time: '18:30', endTime: '12:00' });
    expect(multi.state.events.find((e) => e.id === multi.id)!.endTime).toBe('12:00');
    const all = A.createEvent(s, ctxOf(ids[1]), { ...base, endDate: '2026-11-22', time: '18:30', endTime: '12:00', allDay: true });
    const ev = all.state.events.find((e) => e.id === all.id)!;
    expect([ev.time, ev.endTime, ev.allDay]).toEqual(['', undefined, true]);
  });
});
