import { useState } from 'react';
import * as A from '@engine/actions';
import { call } from '@engine/registry';
import { activeMembers, cycleInfo, MEETINGS_PER_CYCLE, payerRanking } from '@engine/finance';
import type { Rsvp, State, StEvent } from '@engine/types';
import { dayCount, diffDays, endOf, euro } from '@engine/util';
import { go, useStore } from '../store';
import { Avatar, DateBlock, Icon, Money, Pill, timeText } from '../ui';

export function sortEvents(a: StEvent, b: StEvent) {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
}
export function nextEvent(state: State, today: string) {
  return state.events.filter((e) => e.status === 'planned' && endOf(e) >= today).sort(sortEvents)[0];
}
export function openClosings(state: State, today: string) {
  return state.events.filter((e) => e.status === 'planned' && endOf(e) < today).sort(sortEvents);
}

export function StatusPill({ ev, today }: { ev: StEvent; today: string }) {
  if (ev.status === 'cancelled') return <Pill tone="muted">Abgesagt</Pill>;
  if (ev.status === 'closed') return <Pill tone="neutral">Abgeschlossen</Pill>;
  if (endOf(ev) < today) return <Pill tone="gold">Abschluss offen</Pill>;
  if (ev.date < today) return <Pill tone="wine">Läuft gerade</Pill>;
  if (ev.date === today) return <Pill tone="wine">Heute</Pill>;
  return null;
}
export function TypeTag({ ev }: { ev: StEvent }) {
  return ev.type === 'event' ? <span className="type-tag event">Event</span> : <span className="type-tag">Stammtisch</span>;
}

export function RsvpButtons({ ev, compact }: { ev: StEvent; compact?: boolean }) {
  const { state, me, run } = useStore();
  const cur = A.rsvpOf(state, ev.id, me.id);
  const set = (r: Rsvp) => run(call('setRsvp', ev.id, me.id, cur === r ? 'open' : r), r === cur ? 'Antwort zurückgenommen' : r === 'yes' ? 'Prima, du bist dabei' : 'Abgesagt – schade!');
  return (
    <div className={`rsvp${compact ? ' compact' : ''}`} role="group" aria-label="Deine Teilnahme">
      <button type="button" className={`rsvp-yes${cur === 'yes' ? ' on' : ''}`} aria-pressed={cur === 'yes'} onClick={(e) => { e.stopPropagation(); set('yes'); }}>
        <Icon name="check" size={18} stroke={2.4} /> Bin dabei
      </button>
      <button type="button" className={`rsvp-no${cur === 'no' ? ' on' : ''}`} aria-pressed={cur === 'no'} onClick={(e) => { e.stopPropagation(); set('no'); }}>
        <Icon name="x" size={18} stroke={2.4} /> Kann nicht
      </button>
    </div>
  );
}

export function AttendeeStrip({ ev }: { ev: StEvent }) {
  const { state } = useStore();
  const members = activeMembers(state);
  const r = (id: string) => A.rsvpOf(state, ev.id, id);
  const yes = members.filter((m) => r(m.id) === 'yes'), no = members.filter((m) => r(m.id) === 'no'), open = members.filter((m) => r(m.id) === 'open');
  return (
    <div className="attendee-strip">
      <div className="avatars">
        {[...yes, ...open, ...no].map((m) => <Avatar key={m.id} member={m} size={28} ring={r(m.id)} />)}
      </div>
      <span className="att-count">
        <b>{yes.length} dabei</b>{no.length ? ` · ${no.length} nicht` : ''}{open.length ? ` · ${open.length} offen` : ''}
      </span>
    </div>
  );
}

export function EventRow({ ev }: { ev: StEvent }) {
  const { state, me, today } = useStore();
  const my = A.rsvpOf(state, ev.id, me.id);
  const present = ev.status === 'closed' ? A.presentIds(state, ev.id).length : null;
  const photos = state.media.filter((m) => m.eventId === ev.id).length;
  const notes = state.notes.filter((n) => n.eventId === ev.id).length;
  return (
    <a className={`event-row${ev.status === 'cancelled' ? ' cancelled' : ''}`} href={`#termin-${ev.id}`}>
      <DateBlock ev={ev} />
      <div className="er-main">
        <div className="er-title"><span>{ev.title}</span>{(ev.type === 'event' || ev.title !== 'Stammtisch') && <TypeTag ev={ev} />}</div>
        <div className="er-meta">
          {ev.status === 'cancelled'
            ? <span>{ev.cancelReason || 'Abgesagt'}</span>
            : <>{endOf(ev) !== ev.date && <span className="nowrap multi-tag">{dayCount(ev)} Tage</span>}<span className="nowrap">{timeText(ev)}</span>{ev.location ? <span className="trunc">{ev.location}</span> : ev.status === 'planned' && <span className="loc-missing">Ort offen</span>}</>}
        </div>
        <div className="er-tags">
          <StatusPill ev={ev} today={today} />
          {ev.detached && ev.status !== 'cancelled' && <Pill tone="muted">verschoben</Pill>}
          {ev.status === 'planned' && endOf(ev) >= today && (my !== 'open' || diffDays(ev.date, today) <= 21) && (my === 'yes' ? <Pill tone="pos">Du bist dabei</Pill> : my === 'no' ? <Pill tone="muted">Du fehlst</Pill> : <Pill tone="gold">Antwort offen</Pill>)}
          {present !== null && <span className="er-small"><Icon name="users" size={14} /> {present}</span>}
          {notes > 0 && <span className="er-small"><Icon name="note" size={14} /> {notes}</span>}
          {photos > 0 && <span className="er-small"><Icon name="camera" size={14} /> {photos}</span>}
        </div>
      </div>
      <Icon name="chev" size={18} />
    </a>
  );
}

/** Maßkrug als Füllstandsanzeige des Topfs. */
export function PotMug({ cents, max = 10000, size = 76 }: { cents: number; max?: number; size?: number }) {
  const level = Math.max(0, Math.min(1, cents / max));
  const top = 14, bottom = 86, h = (bottom - top) * level;
  return (
    <svg viewBox="0 0 96 100" width={size} height={size * 100 / 96} className="potmug" role="img" aria-label={`Topf: ${euro(cents)}`}>
      <defs><clipPath id="mugclip"><rect x="12" y="12" width="56" height="76" rx="6" /></clipPath></defs>
      <rect x="12" y="12" width="56" height="76" rx="6" className="mug-glass" />
      <g clipPath="url(#mugclip)">
        <rect x="12" y={bottom - h + 2} width="56" height={h + 2} className="mug-beer" />
        {level > 0.02 && <rect x="12" y={bottom - h - 5} width="56" height="9" rx="4" className="mug-foam" />}
      </g>
      {[30, 48, 66].map((y) => <line key={y} x1="24" x2="24" y1={y} y2={y + 12} className="mug-facet" />)}
      {[30, 48, 66].map((y) => <line key={'b' + y} x1="56" x2="56" y1={y} y2={y + 12} className="mug-facet" />)}
      <path d="M68 30h8a10 10 0 0 1 10 10v16a10 10 0 0 1-10 10h-8" className="mug-handle" />
      <rect x="12" y="12" width="56" height="76" rx="6" className="mug-outline" />
    </svg>
  );
}

export function CycleDots() {
  const { state } = useStore();
  const info = cycleInfo(state);
  return (
    <span className="cycle-dots" aria-label={`${info.settledInCycle} von ${MEETINGS_PER_CYCLE} Treffen im Zyklus abgerechnet`}>
      {Array.from({ length: MEETINGS_PER_CYCLE }, (_, i) => <i key={i} className={i < info.settledInCycle ? 'on' : ''} />)}
    </span>
  );
}

export function goEvent(id: string) { go('termin-' + id); }

/** Ort je Termin: anzeigen, und solange geplant von jedem Mitglied festlegbar – mit Schnellauswahl der letzten Orte. */
export function LocationEditor({ ev, compact }: { ev: StEvent; compact?: boolean }) {
  const { state, run } = useStore();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(ev.location);
  const recent = A.recentLocations(state).filter((l) => l !== ev.location);
  const save = (loc: string) => { if (run(call('setEventLocation', ev.id, loc), loc.trim() ? `Ort: ${loc.trim()}` : 'Ort entfernt')) setEditing(false); };
  if (ev.status !== 'planned') return ev.location ? <p className="nc-meta"><Icon name="pin" size={16} /> {ev.location}</p> : null;
  if (!editing) {
    return ev.location ? (
      <p className="nc-meta loc-line"><Icon name="pin" size={16} /> <span>{ev.location}</span>
        <button className="link small-link" type="button" onClick={(e) => { e.stopPropagation(); setVal(ev.location); setEditing(true); }}>ändern</button></p>
    ) : (
      <button className={`loc-open${compact ? ' compact' : ''}`} type="button" onClick={(e) => { e.stopPropagation(); setVal(''); setEditing(true); }}>
        <Icon name="pin" size={16} /> <span>Ort noch offen</span> <b>Festlegen</b>
      </button>
    );
  }
  return (
    <form className="loc-edit" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(val); }}>
      <div className="loc-row">
        <input id={`loc-${ev.id}`} value={val} onChange={(e) => setVal(e.target.value)} placeholder="Wo treffen wir uns?" maxLength={80} autoFocus />
        <button className="btn small primary" type="submit" disabled={!val.trim()}>OK</button>
        <button className="icon-btn" type="button" aria-label="Abbrechen" onClick={() => setEditing(false)}><Icon name="x" size={18} /></button>
      </div>
      {recent.length > 0 && (
        <div className="chips" aria-label="Zuletzt">
          {recent.map((l) => <button key={l} type="button" className="chip" onClick={() => save(l)}>{l}</button>)}
        </div>
      )}
    </form>
  );
}

/** Hausregel „Wer am weitesten im Minus ist, zahlt“ – für einen Termin (Zusagen bzw. Anwesende) oder allgemein. */
export function usePayerFor(ev?: StEvent) {
  const { state } = useStore();
  if (!ev) return payerRanking(state);
  const pool = ev.status === 'closed'
    ? A.presentIds(state, ev.id)
    : activeMembers(state).filter((m) => A.rsvpOf(state, ev.id, m.id) !== 'no').map((m) => m.id);
  return payerRanking(state, pool);
}

export function PayerCard({ ev }: { ev?: StEvent }) {
  const { state, me } = useStore();
  const ranking = usePayerFor(ev);
  const all = payerRanking(state);
  const first = ranking[0];
  const m = (id: string) => state.members.find((x) => x.id === id);
  const skipped = first ? all.filter((x) => x.standing < first.standing) : [];
  return (
    <a className="payer-card" href="#kasse">
      <div className="pc-head">
        <span className="eyebrow">{ev ? 'Zahlt beim nächsten Stammtisch' : 'Zahlt als Nächstes'}</span>
        <Icon name="wallet" size={18} />
      </div>
      {first ? (
        <>
          <div className="pc-main">
            <Avatar member={m(first.id)} size={44} />
            <div>
              <strong>{first.id === me.id ? 'Du' : m(first.id)?.name}</strong>
              <Money cents={first.standing} signed tone />
            </div>
          </div>
          <p className="pc-sub">
            {skipped.length > 0 && <>{skipped.map((x) => m(x.id)?.name).join(', ')} steht tiefer, hat aber abgesagt. </>}
            {ranking[1] ? <>Falls nicht da: {m(ranking[1].id)?.name} ({euro(ranking[1].standing)}).</> : ev ? 'Am weitesten im Minus unter allen, die nicht abgesagt haben.' : ''}
          </p>
        </>
      ) : <p className="pc-sub">Alle sind ausgeglichen – wer mag, zahlt.</p>}
    </a>
  );
}
