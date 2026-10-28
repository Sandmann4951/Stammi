import type { Cents, ISODate } from './types';

// ---------- IDs ----------
let counter = 0;
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1296;
  const rnd = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  return prefix + Date.now().toString(36).slice(-5) + rnd + counter.toString(36).padStart(2, '0');
}

// ---------- Geld ----------
/** Teilt einen Betrag centgenau auf. Rest-Cents gehen deterministisch reihum,
 *  beginnend bei `offset` (z. B. aus der Termin-ID abgeleitet), damit niemand dauerhaft bevorzugt wird. */
export function splitCents(total: Cents, ids: string[], offset = 0): Map<string, Cents> {
  const out = new Map<string, Cents>();
  const n = ids.length;
  if (n === 0) return out;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const rest = abs - base * n;
  ids.forEach((id) => out.set(id, base * sign));
  for (let i = 0; i < rest; i++) {
    const id = ids[(offset + i) % n];
    out.set(id, (out.get(id) ?? 0) + sign);
  }
  return out;
}

export function seedFrom(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** "12,5" | "12.50" | "1.234,56" | "€ 7" → Cent. Gibt null bei ungültiger Eingabe. */
export function parseEuro(input: string): Cents | null {
  let s = input.trim().replace(/€|eur/gi, '').replace(/\s/g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [eur, ct = ''] = s.split('.');
  const cents = parseInt(eur, 10) * 100 + parseInt((ct + '00').slice(0, 2), 10);
  return neg ? -cents : cents;
}

const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export function euro(c: Cents): string {
  return eurFmt.format(c / 100);
}
export function euroSigned(c: Cents): string {
  if (c === 0) return euro(0);
  return (c > 0 ? '+' : '−') + euro(Math.abs(c)).replace('-', '');
}
export function centsToInput(c: Cents): string {
  return (c / 100).toFixed(2).replace('.', ',');
}

// ---------- Datum (reine Kalendertage, zeitzonenfest) ----------
export function toDate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
export function fromDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: ISODate, days: number): ISODate {
  const x = toDate(d);
  x.setUTCDate(x.getUTCDate() + days);
  return fromDate(x);
}
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000);
}
/** 0 = Montag … 6 = Sonntag */
export function weekdayMon0(d: ISODate): number {
  return (toDate(d).getUTCDay() + 6) % 7;
}
export function localToday(now = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
/** Letzter Tag eines Termins (bei eintägigen = Startdatum). */
export function endOf(ev: { date: ISODate; endDate?: ISODate }): ISODate {
  return ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
}
export function dayCount(ev: { date: ISODate; endDate?: ISODate }): number {
  return diffDays(endOf(ev), ev.date) + 1;
}
/** Alle Tage eines Termins. */
export function daysOf(ev: { date: ISODate; endDate?: ISODate }): ISODate[] {
  const out: ISODate[] = [];
  for (let d = ev.date; d <= endOf(ev); d = addDays(d, 1)) out.push(d);
  return out;
}
export const MAX_EVENT_DAYS = 21;
export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
