// Kalender-Abo (iCalendar, RFC 5545) aus dem Gruppenzustand.
// Ein Abo pro Mitglied: enthält alle Termine der Gruppe, dazu die eigene Antwort.
import type { State, StEvent } from './engine/types.ts';
import { addDays, endOf } from './engine/util.ts';

const TZ = 'Europe/Berlin';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

/** Text nach RFC 5545 maskieren. */
export function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Zeilen auf max. 75 Byte falten (UTF-8-sicher, Fortsetzung mit Leerzeichen). */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let limit = 75;
  for (const ch of line) {
    if (enc.encode(cur + ch).length > limit) { parts.push(cur); cur = ''; limit = 74; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const d8 = (date: string) => date.replace(/-/g, '');
const t6 = (time: string) => time.replace(':', '') + '00';
function plusMinutes(date: string, time: string, minutes: number) {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m + minutes;
  let d = date;
  while (total >= 1440) { total -= 1440; d = addDays(d, 1); }
  return { date: d, time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` };
}

const RSVP_TEXT = { yes: 'Du bist dabei', no: 'Du hast abgesagt', open: 'Du hast noch nicht geantwortet' } as const;

function eventLines(s: State, ev: StEvent, memberId: string, appUrl: string, stamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${ev.id}@${s.group.id}.stammi`, `DTSTAMP:${stamp}`];
  const last = endOf(ev);
  if (ev.allDay || !ev.time) {
    lines.push(`DTSTART;VALUE=DATE:${d8(ev.date)}`, `DTEND;VALUE=DATE:${d8(addDays(last, 1))}`);
  } else {
    // Ohne Endzeit: Stammtisch 3 Std., Event 2 Std.; mehrtägig ohne Endzeit bis 23:59 des letzten Tages
    const end = ev.endTime
      ? { date: last, time: ev.endTime }
      : last !== ev.date ? { date: last, time: '23:59' } : plusMinutes(ev.date, ev.time, ev.type === 'stammtisch' ? 180 : 120);
    lines.push(`DTSTART;TZID=${TZ}:${d8(ev.date)}T${t6(ev.time)}`, `DTEND;TZID=${TZ}:${d8(end.date)}T${t6(end.time)}`);
  }
  const cancelled = ev.status === 'cancelled';
  lines.push(`SUMMARY:${esc((cancelled ? 'Abgesagt: ' : '') + ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  const rsvp = s.attendance.find((a) => a.eventId === ev.id && a.memberId === memberId)?.rsvp ?? 'open';
  const yes = s.attendance.filter((a) => a.eventId === ev.id && a.rsvp === 'yes').length;
  const desc = [
    cancelled ? `Abgesagt${ev.cancelReason ? `: ${ev.cancelReason}` : ''}` : ev.status === 'closed' ? 'Abgeschlossen' : `${RSVP_TEXT[rsvp]} · ${yes} Zusage${yes === 1 ? '' : 'n'}`,
    !ev.location && ev.status === 'planned' ? 'Ort noch offen' : '',
    ev.description,
    `In der App: ${appUrl}#termin-${ev.id}`,
  ].filter(Boolean).join('\n');
  lines.push(`DESCRIPTION:${esc(desc)}`, `URL:${appUrl}#termin-${ev.id}`);
  lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  if (rsvp === 'no' || cancelled) lines.push('TRANSP:TRANSPARENT');
  lines.push('END:VEVENT');
  return lines;
}

/** Ganzer Kalender. Termine ab 6 Monaten in der Vergangenheit. */
export function buildIcs(s: State, memberId: string, appUrl: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const from = addDays(now.toISOString().slice(0, 10), -183);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stammi//Stammtisch-App//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    // X-Eigenschaft: Kalender-Apps maskieren hier nicht zurück → nur Zeilenumbrüche entfernen
    `X-WR-CALNAME:${s.group.name.replace(/[\r\n]+/g, ' ')}`, `X-WR-TIMEZONE:${TZ}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (const ev of [...s.events].sort((a, b) => a.date.localeCompare(b.date))) {
    if (endOf(ev) < from) continue;
    lines.push(...eventLines(s, ev, memberId, appUrl, stamp));
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
