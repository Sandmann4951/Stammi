import { describe, expect, it } from 'vitest';
import * as A from './engine/actions.ts';
import { buildIcs, esc, fold } from './ics.ts';

const NOW = new Date('2026-10-28T12:00:00Z');
const ctx = (actor: string) => ({ actor, now: NOW });
function group() {
  let s = A.createGroup('Stammtisch Kirchheim', { name: 'Daniel', email: 'd@x.de' }, NOW);
  const admin = s.members[0].id;
  s = A.updateSeries(s, ctx(admin), { startDate: '2026-11-02', intervalWeeks: 2, time: '19:00', title: 'Stammtisch' });
  return { s, admin };
}
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const vevents = (ics: string) => unfold(ics).split('BEGIN:VEVENT').slice(1);

describe('Kalender-Abo (ICS)', () => {
  it('gültiger Kalender mit Zeitzone, stabilen UIDs und CRLF', () => {
    const { s, admin } = group();
    const ics = buildIcs(s, admin, 'https://app/', NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('TZID:Europe/Berlin');
    expect(ics).toContain('X-WR-CALNAME:Stammtisch Kirchheim');
    const first = vevents(ics)[0];
    expect(first).toContain('DTSTART;TZID=Europe/Berlin:20261102T190000');
    expect(first).toContain('DTEND;TZID=Europe/Berlin:20261102T220000'); // 3 Std. Standarddauer
    expect(first).toContain(`UID:t20261102@${s.group.id}.stammi`);
    expect(first).toContain('Ort noch offen');
    expect(buildIcs(s, admin, 'https://app/', NOW)).toBe(ics); // reproduzierbar
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('Antwort, Absage, Ort und Endzeit', () => {
    let { s, admin } = group();
    const [a, b] = s.events;
    s = A.setRsvp(s, ctx(admin), a.id, admin, 'yes');
    s = A.setEventLocation(s, ctx(admin), a.id, 'Gasthof Post, Hauptstr. 1');
    s = A.updateEvent(s, ctx(admin), a.id, { endTime: '23:30' });
    s = A.cancelEvent(s, ctx(admin), b.id, 'Feiertag');
    const [ea, eb] = vevents(buildIcs(s, admin, 'https://app/', NOW));
    expect(ea).toContain('LOCATION:Gasthof Post\\, Hauptstr. 1');
    expect(ea).toContain('Du bist dabei · 1 Zusage');
    expect(ea).toContain('DTEND;TZID=Europe/Berlin:20261102T233000');
    expect(ea).toContain('STATUS:CONFIRMED');
    expect(eb).toContain('SUMMARY:Abgesagt: Stammtisch');
    expect(eb).toContain('STATUS:CANCELLED');
    expect(eb).toContain('Abgesagt: Feiertag');
  });

  it('mehrtägig und ganztägig', () => {
    let { s, admin } = group();
    s = A.createEvent(s, ctx(admin), { type: 'event', title: 'Hüttenwochenende', date: '2026-12-11', endDate: '2026-12-13', time: '16:00', endTime: '11:00', location: '', description: '' }).state;
    s = A.createEvent(s, ctx(admin), { type: 'event', title: 'Skitag', date: '2027-01-09', endDate: '2027-01-10', time: '', allDay: true, location: '', description: '' }).state;
    const ics = unfold(buildIcs(s, admin, 'https://app/', NOW));
    expect(ics).toContain('DTSTART;TZID=Europe/Berlin:20261211T160000');
    expect(ics).toContain('DTEND;TZID=Europe/Berlin:20261213T110000');
    expect(ics).toContain('DTSTART;VALUE=DATE:20270109');
    expect(ics).toContain('DTEND;VALUE=DATE:20270111'); // exklusiv: Tag nach dem letzten Tag
  });

  it('maskiert Sonderzeichen und faltet lange Zeilen UTF-8-sicher', () => {
    expect(esc('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = 'DESCRIPTION:' + 'Grüß Gott und Prost! '.repeat(10);
    const folded = fold(long);
    expect(folded.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });
});
