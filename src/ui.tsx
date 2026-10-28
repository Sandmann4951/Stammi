import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Member, State, StEvent } from './engine/types';
import { dayCount, diffDays, endOf, euro, parseEuro, toDate, WEEKDAYS_SHORT, weekdayMon0 } from './engine/util';
import { useStore } from './store';

// ---------- Icons (inline, 24px Raster) ----------
const paths: Record<string, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  cal: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
  mug: <><path d="M5 6h10v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 19z" /><path d="M15 9h2.5A2.5 2.5 0 0 1 20 11.5v3a2.5 2.5 0 0 1-2.5 2.5H15" /><path d="M8 10v7M11.5 10v7" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 5l7 7-7 7" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.5" /></>,
  note: <><path d="M6 3.5h9l3.5 3.5v13.5H6z" /><path d="M9 11h6M9 14.5h6M9 18h3.5" /></>,
  receipt: <><path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z" /><path d="M9 8h6M9 11.5h6M9 15h4" /></>,
  swap: <><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" /><circle cx="16.5" cy="9.5" r="2.5" /><path d="M16 14.6c2.3 0 4 1.4 4.6 3.9" /></>,
  more: <><circle cx="5.5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18.5" cy="12" r="1.4" /></>,
  edit: <path d="M14.5 5.5l4 4L8 20H4v-4zM12.5 7.5l4 4" />,
  trash: <><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="1.5" /><path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></>,
  gavel: <><path d="M13 4.5l6.5 6.5M10.5 7l6.5 6.5M12 5.5l-5 5 6.5 6.5 5-5M9.5 14.5 4 20" /></>,
  star: <path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z" />,
  up: <><path d="M7 10v10H4V10zM7 10l4-6.5c1.3 0 2.2 1 2 2.3L12.6 9H18a2 2 0 0 1 2 2.3l-1.2 6.8a2 2 0 0 1-2 1.7H7" /></>,
  down: <><path d="M7 14V4H4v10zM7 14l4 6.5c1.3 0 2.2-1 2-2.3L12.6 15H18a2 2 0 0 0 2-2.3l-1.2-6.8a2 2 0 0 0-2-1.7H7" /></>,
  chat: <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="8" width="16.5" height="11" rx="2" /><circle cx="16" cy="13.5" r="1.2" /></>,
  left: <path d="M14.5 6l-6 6 6 6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
  lock: <><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></>,
};
export function Icon({ name, size = 20, stroke = 1.8 }: { name: keyof typeof paths | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      {paths[name]}
    </svg>
  );
}

// ---------- Mitglieder ----------
const AVATAR_TONES = 6;
export function Avatar({ member, size = 32, ring }: { member?: Member; size?: number; ring?: 'yes' | 'no' | 'open' }) {
  const initials = (member?.name ?? '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className={`avatar tone-${(member?.order ?? 0) % AVATAR_TONES}${ring ? ' ring-' + ring : ''}${member?.status === 'inactive' ? ' inactive' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }} title={member?.name} aria-hidden="true">
      {initials}
    </span>
  );
}
export function useMember() {
  const { state } = useStore();
  return (id?: string) => state.members.find((m) => m.id === id);
}
export function memberName(state: State, id?: string) {
  return state.members.find((m) => m.id === id)?.name ?? 'Unbekannt';
}

// ---------- Geld ----------
export function Money({ cents, signed, tone, className = '' }: { cents: number; signed?: boolean; tone?: boolean; className?: string }) {
  const cls = tone ? (cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'zero') : '';
  const txt = signed && cents !== 0 ? (cents > 0 ? '+' : '−') + euro(Math.abs(cents)) : euro(cents);
  return <span className={`money ${cls} ${className}`}>{txt}</span>;
}

// ---------- Datum ----------
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export function fmtDate(d: string, style: 'long' | 'short' | 'day' = 'long') {
  const x = toDate(d);
  const wd = weekdayMon0(d);
  const day = x.getUTCDate(), m = x.getUTCMonth(), y = x.getUTCFullYear();
  if (style === 'day') return `${WEEKDAYS_SHORT[wd]}, ${day}. ${MONTHS_SHORT[m]}`;
  if (style === 'short') return `${day}.${String(m + 1).padStart(2, '0')}.${String(y).slice(2)}`;
  return `${WD_LONG[wd]}, ${day}. ${MONTHS[m]} ${y}`;
}
/** Zeitraum eines Termins: eintägig wie fmtDate, mehrtägig als „Fr, 20. – So, 22. Nov.“ */
export function fmtRange(ev: { date: string; endDate?: string }, style: 'long' | 'day' = 'long') {
  const end = endOf(ev);
  if (end === ev.date) return fmtDate(ev.date, style);
  const a = toDate(ev.date), b = toDate(end);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  if (style === 'day') {
    return sameMonth
      ? `${WEEKDAYS_SHORT[weekdayMon0(ev.date)]}, ${a.getUTCDate()}. – ${WEEKDAYS_SHORT[weekdayMon0(end)]}, ${b.getUTCDate()}. ${MONTHS_SHORT[b.getUTCMonth()]}`
      : `${fmtDate(ev.date, 'day')} – ${fmtDate(end, 'day')}`;
  }
  if (sameMonth) return `${WD_LONG[weekdayMon0(ev.date)]}, ${a.getUTCDate()}. – ${WD_LONG[weekdayMon0(end)]}, ${b.getUTCDate()}. ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  return `${WD_LONG[weekdayMon0(ev.date)]}, ${a.getUTCDate()}. ${MONTHS[a.getUTCMonth()]}${sameYear ? '' : ' ' + a.getUTCFullYear()} – ${WD_LONG[weekdayMon0(end)]}, ${b.getUTCDate()}. ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}
/** Uhrzeit-Text: „19:00 Uhr“, „18:30–23:00 Uhr“, „ganztägig“, mehrtägig „ab 13:00 Uhr“. */
export function timeText(ev: { date: string; endDate?: string; time: string; endTime?: string; allDay?: boolean }, long = false) {
  const multi = endOf(ev) !== ev.date;
  if (ev.allDay || !ev.time) return 'ganztägig';
  if (!multi) return ev.endTime ? `${ev.time}–${ev.endTime} Uhr` : `${ev.time} Uhr`;
  if (!long) return `ab ${ev.time} Uhr`;
  return `${fmtDate(ev.date, 'day')}, ${ev.time} Uhr – ${fmtDate(endOf(ev), 'day')}${ev.endTime ? `, ${ev.endTime} Uhr` : ''}`;
}
/** „in 3 Tagen“, „läuft gerade · Tag 2 von 3“, „vor 5 Tagen“ */
export function whenText(ev: { date: string; endDate?: string }, today: string) {
  const end = endOf(ev);
  if (end !== ev.date && ev.date <= today && today <= end) return `läuft gerade · Tag ${diffDays(today, ev.date) + 1} von ${dayCount(ev)}`;
  if (end < today) return relDays(diffDays(end, today));
  return relDays(diffDays(ev.date, today)) + (end !== ev.date ? ` · ${dayCount(ev)} Tage` : '');
}
export function monthLabel(d: string) {
  const x = toDate(d);
  return `${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
export function fmtDateTime(isoStr: string) {
  const d = new Date(isoStr);
  return d.toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function relDays(days: number) {
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  if (days === -1) return 'gestern';
  if (days > 0) return days < 14 ? `in ${days} Tagen` : `in ${Math.round(days / 7)} Wochen`;
  return `vor ${-days} Tagen`;
}

export function DateBlock({ ev, big }: { ev: StEvent; big?: boolean }) {
  const x = toDate(ev.date);
  const end = endOf(ev);
  if (end !== ev.date) {
    const y = toDate(end);
    const sameMonth = x.getUTCMonth() === y.getUTCMonth();
    return (
      <div className={`dateblock multi${big ? ' big' : ''}${ev.status === 'cancelled' ? ' muted' : ''}`} aria-hidden="true">
        <span className="db-wd">{WEEKDAYS_SHORT[weekdayMon0(ev.date)]}–{WEEKDAYS_SHORT[weekdayMon0(end)]}</span>
        <span className="db-day">{x.getUTCDate()}.–{y.getUTCDate()}.</span>
        <span className="db-mon">{sameMonth ? MONTHS_SHORT[x.getUTCMonth()] : `${MONTHS_SHORT[x.getUTCMonth()]}/${MONTHS_SHORT[y.getUTCMonth()]}`}</span>
      </div>
    );
  }
  return (
    <div className={`dateblock${big ? ' big' : ''}${ev.status === 'cancelled' ? ' muted' : ''}`} aria-hidden="true">
      <span className="db-wd">{WEEKDAYS_SHORT[weekdayMon0(ev.date)]}</span>
      <span className="db-day">{x.getUTCDate()}</span>
      <span className="db-mon">{MONTHS_SHORT[x.getUTCMonth()]}</span>
    </div>
  );
}

// ---------- Bausteine ----------
export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'gold' | 'wine' | 'pos' | 'neg' | 'muted'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Empty({ icon, title, children, action }: { icon: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Section({ title, action, children, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section-head"><h2>{title}</h2>{action}</header>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} type="button">{o.label}</button>
      ))}
    </div>
  );
}

// ---------- Sheet (Bottom-Sheet am Handy, Dialog am Desktop) ----------
export interface SheetAction { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }

/**
 * Bottom-Sheet am Handy, Dialog am Desktop.
 * Mit `action` wie im iPhone-Kalender: „Abbrechen“ links, Aktion rechts in der Kopfzeile –
 * so verdeckt die Bildschirmtastatur den Speichern-Knopf nie.
 */
export function Sheet({ open, onClose, title, children, footer, wide, action }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; action?: SheetAction }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', k);
    document.body.classList.add('noscroll');
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const t = setTimeout(() => {
      const f = touch ? null : ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=checkbox]):not([type=radio]):not([type=date]):not([type=time]), textarea, select');
      (f ?? ref.current)?.focus({ preventScroll: true });
    }, 60);
    // Sichtbaren Bereich bei eingeblendeter Tastatur nachführen
    const vv = window.visualViewport;
    const fit = () => {
      const el = backdrop.current;
      if (!el || !vv) return;
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
    };
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    fit();
    // Fokussiertes Feld in den sichtbaren Bereich holen
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches?.('input, textarea, select')) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
    };
    ref.current?.addEventListener('focusin', onFocus);
    const node = ref.current;
    return () => {
      document.removeEventListener('keydown', k); document.body.classList.remove('noscroll'); clearTimeout(t);
      vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit);
      node?.removeEventListener('focusin', onFocus);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" ref={backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet${wide ? ' wide' : ''}${action ? ' has-action' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        {action ? (
          <header className="sheet-head ios">
            <button className="head-btn" onClick={onClose} type="button">Abbrechen</button>
            <h3 id={titleId}>{title}</h3>
            <button className={`head-btn strong${action.danger ? ' danger' : ''}`} onClick={action.onClick} disabled={action.disabled} type="button">{action.label}</button>
          </header>
        ) : (
          <header className="sheet-head">
            <h3 id={titleId}>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Schließen" type="button"><Icon name="x" /></button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Betragseingabe mit deutschem Komma, großem Ziffernfeld am Handy. */
export function MoneyInput({ value, onChange, id, autoFocus }: { value: string; onChange: (v: string) => void; id: string; autoFocus?: boolean }) {
  return (
    <div className="money-input">
      <input id={id} inputMode="decimal" autoComplete="off" placeholder="0,00" value={value} data-autofocus={autoFocus ? '' : undefined}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.-]/g, ''))} />
      <span aria-hidden="true">€</span>
    </div>
  );
}
export function useMoneyField(initial = '') {
  const [raw, setRaw] = useState(initial);
  const cents = parseEuro(raw);
  return { raw, setRaw, cents, valid: cents !== null && cents > 0 };
}

export function MemberPicker({ members, selected, onToggle, label }: { members: Member[]; selected: string[]; onToggle: (id: string) => void; label?: string }) {
  return (
    <div className="member-picker" role="group" aria-label={label}>
      {members.map((m) => {
        const on = selected.includes(m.id);
        return (
          <button key={m.id} type="button" className={`mp-item${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onToggle(m.id)}>
            <Avatar member={m} size={28} />
            <span>{m.name}</span>
            <span className="mp-check"><Icon name="check" size={16} stroke={2.4} /></span>
          </button>
        );
      })}
    </div>
  );
}

export async function copyText(text: string, fallbackEl?: HTMLTextAreaElement | HTMLInputElement | null): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    if (fallbackEl) { fallbackEl.focus(); fallbackEl.select(); }
    return false;
  }
}
