// Beispieldaten für die Vorschau. Alle Termine werden relativ zu „heute“ erzeugt,
// damit die Demo immer frisch aussieht. Gebucht wird ausschließlich über die echten Aktionen.
import * as A from '@engine/actions';
import type { State } from '@engine/types';
import { addDays, localToday, weekdayMon0 } from '@engine/util';

export function demoState(now = new Date()): State {
  const t = localToday(now);
  const lastMonday = addDays(t, -weekdayMon0(t));
  const start = addDays(lastMonday, -56);
  const at = (d: string) => new Date(d + 'T21:30:00');

  let s = A.createGroup('Stammtisch Kirchheim', { name: 'Daniel', email: 'daniel@example.de' }, at(addDays(start, -3)));
  const admin = s.members[0].id;
  const ctx = (actor = admin, d = addDays(start, -2)) => ({ actor, now: at(d) });

  const names = ['Markus', 'Stefan', 'Tobias', 'Florian'];
  for (const n of names) {
    const r = A.inviteMember(s, ctx(), `${n.toLowerCase()}@example.de`);
    s = A.acceptInvite(r.state, at(addDays(start, -2)), r.token, { name: n, email: `${n.toLowerCase()}@example.de`, password: 'demo-passwort' }).state;
  }
  const [D, M, S, T, F] = s.members.map((m) => m.id);
  s = A.updateSeries(s, ctx(), { startDate: start, intervalWeeks: 2, time: '19:00', title: 'Stammtisch' });
  s = A.ensureSeries(s, now);
  s = A.importOpening(s, ctx(), [
    { debtorId: M, creditorId: D, amount: 2350 },
    { debtorId: T, creditorId: S, amount: 1200 },
    { debtorId: F, creditorId: M, amount: 840 },
  ], addDays(start, -1));
  s = A.startCashPool(s, ctx(D, addDays(start, -1)));

  const ev = (d: string) => s.events.find((e) => e.originalSeriesDate === d)!.id;
  const e1 = ev(start), e2 = ev(addDays(start, 14)), e3 = ev(addDays(start, 28)), e4 = ev(addDays(start, 42)), e5 = ev(lastMonday);
  const e6 = ev(addDays(lastMonday, 14));

  // Der Ort wird von Treffen zu Treffen ausgemacht
  const places: [string, string][] = [[e1, 'Zum Goldenen Krug'], [e2, 'Gasthof Post'], [e3, 'Zum Goldenen Krug'], [e4, 'Brauhaus am Markt'], [e5, 'Gasthof Post']];
  for (const [id, loc] of places) s = A.setEventLocation(s, ctx(D, start), id, loc);

  const rsvpAll = (id: string, yes: string[], no: string[], d: string) => {
    for (const m of yes) s = A.setRsvp(s, ctx(m, d), id, m, 'yes');
    for (const m of no) s = A.setRsvp(s, ctx(m, d), id, m, 'no');
  };

  // Treffen 1: alle fünf
  rsvpAll(e1, [D, M, S, T, F], [], addDays(start, -3));
  s = A.addExpense(s, ctx(D, start), { eventId: e1, payerId: D, amount: 11200, description: 'Rechnung Getränke & Brotzeit' });
  s = A.closeEvent(s, ctx(D, start), e1, [D, M, S, T, F]);
  s = A.addNote(s, ctx(S, start), e1, 'Wir probieren ab jetzt die Reservierung am Ecktisch – hat super geklappt.', true);
  s = A.addNote(s, ctx(M, start), e1, 'Florian hat die Wette um das Fußballergebnis verloren, nächste Runde Obatzda geht auf ihn 😄', false);

  // Treffen 2: Tobias fehlt
  rsvpAll(e2, [D, M, S, F], [T], addDays(start, 10));
  s = A.addExpense(s, ctx(M, addDays(start, 14)), { eventId: e2, payerId: M, amount: 9640, description: 'Rechnung' });
  s = A.closeEvent(s, ctx(D, addDays(start, 14)), e2, [D, M, S, F]);

  // Treffen 3: abgesagt
  s = A.cancelEvent(s, ctx(D, addDays(start, 25)), e3, 'Wirtshaus hat Betriebsurlaub');

  // Treffen 4: zu dritt
  rsvpAll(e4, [D, S, F], [M], addDays(start, 40));
  s = A.addExpense(s, ctx(S, addDays(start, 42)), { eventId: e4, payerId: S, amount: 6150, description: 'Rechnung' });
  s = A.closeEvent(s, ctx(D, addDays(start, 42)), e4, [D, S, F]);
  s = A.addNote(s, ctx(D, addDays(start, 42)), e4, 'Beschlossen: Kegelabend im November, Florian fragt beim Kegelcenter an.', true);

  s = A.addSettlement(s, ctx(F, addDays(start, 44)), { fromId: F, toId: D, amount: 1500, date: addDays(start, 44), note: 'PayPal' });

  // Treffen 5 (letzter Montag): gelaufen, Abrechnung noch offen
  rsvpAll(e5, [D, M, S, T], [F], addDays(lastMonday, -4));
  s = A.addExpense(s, ctx(T, lastMonday), { eventId: e5, payerId: T, amount: 8420, description: 'Rechnung' });

  // Nächster Termin: teilweise Zusagen
  rsvpAll(e6, [M, S], [T], t);

  // Ideen
  let r = A.addIdea(s, ctx(F, addDays(start, 43)), { title: 'Kegelabend', description: 'Zwei Bahnen im Kegelcenter reservieren, danach Schnitzel.' });
  s = r.state;
  s = A.updateIdea(s, ctx(F, addDays(start, 43)), r.id, { checklist: [
    { id: 'c1', text: 'Bahnen anfragen', done: true }, { id: 'c2', text: 'Termin abstimmen', done: true }, { id: 'c3', text: 'Anzahlung klären', done: false },
  ] });
  s = A.planIdea(s, ctx(F, addDays(start, 44)), r.id, { title: 'Kegelabend', date: addDays(lastMonday, 25), time: '18:30', location: 'Kegelcenter am See', description: 'Zwei Bahnen reserviert.' }).state;
  r = A.addIdea(s, ctx(T, addDays(start, 20)), { title: 'Hüttenwochenende', description: 'Freitag bis Sonntag auf eine Selbstversorgerhütte, Wandern und Schafkopf.' });
  s = r.state;
  {
    const fri = addDays(lastMonday, 46);
    const p = A.planIdea(s, ctx(T, addDays(start, 21)), r.id, { title: 'Hüttenwochenende', date: fri, endDate: addDays(fri, 2), time: '16:00', location: 'Selbstversorgerhütte am Spitzingsee', description: 'Anreise Freitag ab 16 Uhr, Abreise Sonntag nach dem Frühstück. Unterkunft wird vor Ort aufgeteilt.' });
    s = p.state;
    for (const m of [T, D, S]) s = A.setRsvp(s, ctx(m, addDays(start, 22)), p.id, m, 'yes');
  }
  r = A.addIdea(s, ctx(S, addDays(start, 30)), { title: 'Brauereiführung', description: 'Führung mit Verkostung in einer kleinen Brauerei im Umland. Am besten an einem Samstag.' });
  s = A.updateIdea(r.state, ctx(S, addDays(start, 30)), r.id, { checklist: [
    { id: 'c1', text: 'Drei Brauereien raussuchen', done: true }, { id: 'c2', text: 'Preise vergleichen', done: false }, { id: 'c3', text: 'Fahrgemeinschaft planen', done: false },
  ] });
  s = A.addIdea(s, ctx(M, addDays(start, 50)), { title: 'Weihnachtsfeier mit Partnerinnen', description: 'Gemeinsames Essen Mitte Dezember, eventuell mit Wichteln.' }).state;
  r = A.addIdea(s, ctx(T, addDays(start, -1)), { title: 'Watt-Turnier', description: 'Einmal im Quartal Watten statt nur Ratschen.' });
  s = r.state;
  r = A.addIdea(s, ctx(D, addDays(start, 2)), { title: 'Sommerfest mit Grillen', description: 'War im August im Garten von Stefan.' });
  s = A.setIdeaStatus(r.state, ctx(D, addDays(start, 3)), r.id, 'done');

  // Kommentare & Bewertungen
  const idea = (title: string) => s.ideas.find((i) => i.title === title)!.id;
  const brau = idea('Brauereiführung'), watt = idea('Watt-Turnier'), xmas = idea('Weihnachtsfeier mit Partnerinnen');
  s = A.addIdeaComment(s, ctx(D, addDays(start, 31)), brau, 'Gute Idee! Die kleine Brauerei in Aying macht samstags Führungen.');
  s = A.addIdeaComment(s, ctx(F, addDays(start, 33)), brau, 'Dann aber mit Bahn hin, nicht mit dem Auto 😉');
  s = A.addIdeaComment(s, ctx(S, addDays(start, 51)), xmas, 'Wichteln bitte mit Preisgrenze, 15 €?');
  for (const [m, v] of [[D, 1], [M, 1], [F, 1], [T, -1]] as const) s = A.voteIdea(s, ctx(m, addDays(start, 34)), brau, v);
  for (const [m, v] of [[D, 1], [S, 1], [F, -1]] as const) s = A.voteIdea(s, ctx(m, addDays(start, 2)), watt, v);
  for (const [m, v] of [[D, 1], [S, 1], [T, 1], [F, 1]] as const) s = A.voteIdea(s, ctx(m, addDays(start, 52)), xmas, v);

  return { ...s, currentUserId: D };
}

export function emptyState(now = new Date()): State {
  let s = A.createGroup('Unser Stammtisch', { name: 'Ich', email: '' }, now);
  const t = localToday(now);
  const nextMonday = addDays(t, (7 - weekdayMon0(t)) % 7);
  s = A.updateSeries(s, { actor: s.members[0].id, now }, { startDate: nextMonday, intervalWeeks: 2, time: '19:00', title: 'Stammtisch' });
  return s;
}
