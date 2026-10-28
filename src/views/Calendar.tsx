import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as A from '../engine/actions';
import type { SeriesRule, State, StEvent } from '../engine/types';
import { addDays, daysOf, endOf, toDate, weekdayMon0, WEEKDAYS, WEEKDAYS_SHORT } from '../engine/util';
import { EventFormSheet } from '../forms';
import { go, useStore } from '../store';
import { Empty, Field, fmtDate, fmtRange, Icon, monthLabel, Segmented, Sheet } from '../ui';
import { EventRow, sortEvents } from './common';

export function seriesText(r: SeriesRule) {
  const wd = WEEKDAYS[weekdayMon0(r.startDate)];
  const every = r.intervalWeeks === 1 ? `Jeden ${wd}` : r.intervalWeeks === 2 ? `Jeden zweiten ${wd}` : `Alle ${r.intervalWeeks} Wochen ${wd}s`;
  return `${every}, ${r.time} Uhr`;
}

export function SeriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, tryRun, today } = useStore();
  const [f, setF] = useState<SeriesRule>({ startDate: today, intervalWeeks: 2, time: '19:00', title: 'Stammtisch' });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setF(state.series ?? { startDate: today, intervalWeeks: 2, time: '19:00', title: 'Stammtisch' }); setErr(null); } }, [open]); // eslint-disable-line
  const preview = A.seriesDates(f, addDays(today, 7 * f.intervalWeeks * 4 + 7)).filter((d) => d >= today).slice(0, 4);
  const submit = () => {
    const r = tryRun((s, c) => A.updateSeries(s, c, { ...f, intervalWeeks: Number(f.intervalWeeks) }), 'Serie gespeichert');
    if (r.ok) onClose(); else setErr(r.error);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Terminserie" action={{ label: 'Sichern', onClick: submit }}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="row2">
          <Field label="Erster Termin" hint={`Wochentag: ${WEEKDAYS[weekdayMon0(f.startDate)]}`}>
            <input id="ser-start" type="date" value={f.startDate} onChange={(e) => e.target.value && setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Uhrzeit"><input id="ser-time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        </div>
        <Field label="Rhythmus">
          <select id="ser-int" value={f.intervalWeeks} onChange={(e) => setF({ ...f, intervalWeeks: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? 'Jede Woche' : `Alle ${n} Wochen`}</option>)}
          </select>
        </Field>
        <Field label="Titel"><input id="ser-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={40} /></Field>
        <div className="hint-box">
          <strong>Nächste Termine:</strong> {preview.map((d) => fmtDate(d, 'day')).join(' · ') || '–'}
          <br />Den Ort legt ihr bei jedem Treffen neu fest – das kann jedes Mitglied direkt am Termin.
          <br />Vergangene, verschobene und abgesagte Termine bleiben unverändert, ebenso künftige mit Auslagen, Notizen oder Fotos.
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}

// ---------- Suche ----------
interface Hit { ev: StEvent; snippet?: { label: string; text: string } }

function norm(s: string) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function searchEvents(state: State, q: string): Hit[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const ev of state.events) {
    const sources: { label: string; text: string }[] = [
      { label: 'Titel', text: ev.title },
      { label: 'Ort', text: ev.location },
      { label: 'Datum', text: `${fmtRange(ev)} ${monthLabel(ev.date)} ${monthLabel(endOf(ev))} ${fmtDate(ev.date, 'short')}${endOf(ev) !== ev.date ? ' mehrtägig' : ''}` },
      { label: 'Beschreibung', text: ev.description },
      { label: 'Absage', text: ev.cancelReason ?? '' },
      ...state.notes.filter((n) => n.eventId === ev.id).map((n) => ({ label: n.decision ? 'Beschluss' : 'Notiz', text: n.text })),
      ...state.expenses.filter((x) => x.eventId === ev.id && !x.voidedAt).map((x) => ({ label: 'Auslage', text: x.description })),
    ];
    const all = norm(sources.map((s) => s.text).join(' '));
    if (!words.every((w) => all.includes(w))) continue;
    const special = sources.find((s) => !['Titel', 'Datum', 'Ort'].includes(s.label) && words.some((w) => norm(s.text).includes(w)));
    hits.push({ ev, snippet: special });
  }
  return hits.sort((a, b) => sortEvents(b.ev, a.ev));
}

function Highlight({ text, q }: { text: string; q: string }) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const n = norm(text);
  const marks: [number, number][] = [];
  for (const w of words) { let i = n.indexOf(w); while (i >= 0) { marks.push([i, i + w.length]); i = n.indexOf(w, i + w.length); } }
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let pos = 0;
  marks.forEach(([a, b], k) => { if (a < pos) return; out.push(text.slice(pos, a), <mark key={k}>{text.slice(a, b)}</mark>); pos = b; });
  out.push(text.slice(pos));
  return <>{out}</>;
}

// ---------- Monats- und Jahresansicht ----------
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function ymOf(d: string) { return d.slice(0, 7); }
function shiftYm(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}
function monthCells(ym: string): (string | null)[] {
  const first = ym + '-01';
  const lead = weekdayMon0(first);
  const days = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
function dotClass(e: StEvent) {
  return `dot ${e.type}${e.status === 'cancelled' ? ' cancelled' : ''}${e.status === 'closed' ? ' closed' : ''}`;
}

function MonthGrid({ ym, byDate, today, onPick, mini }: { ym: string; byDate: Map<string, StEvent[]>; today: string; onPick?: (d: string) => void; mini?: boolean }) {
  return (
    <div className={`mgrid${mini ? ' mini' : ''}`} role="grid">
      {WEEKDAYS_SHORT.map((w) => <span key={w} className="mg-wd" role="columnheader">{mini ? w[0] : w}</span>)}
      {monthCells(ym).map((d, i) => {
        if (!d) return <span key={i} className="mg-cell empty" />;
        const evs = byDate.get(d) ?? [];
        const span = evs.find((e) => endOf(e) !== e.date && e.status !== 'cancelled');
        const spanCls = span ? ` span${d === span.date ? ' span-start' : ''}${d === endOf(span) ? ' span-end' : ''}` : '';
        const cls = `mg-cell${d === today ? ' today' : ''}${evs.length ? ' has' : ''}${evs.some((e) => e.status !== 'cancelled') ? ' live' : ''}${spanCls}`;
        const label = `${fmtDate(d)}${evs.length ? ': ' + evs.map((e) => e.title + (e.status === 'cancelled' ? ' (abgesagt)' : '')).join(', ') : ''}`;
        return evs.length && onPick ? (
          <button key={i} type="button" className={cls} aria-label={label} onClick={() => onPick(d)}>
            <span className="mg-num">{toDate(d).getUTCDate()}</span>
            <span className="mg-dots">{evs.slice(0, 3).map((e) => <i key={e.id} className={dotClass(e)} />)}</span>
          </button>
        ) : (
          <span key={i} className={cls} aria-label={label}>
            <span className="mg-num">{toDate(d).getUTCDate()}</span>
            {evs.length > 0 && <span className="mg-dots">{evs.slice(0, 3).map((e) => <i key={e.id} className={dotClass(e)} />)}</span>}
          </span>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="dot stammtisch closed" /> Stammtisch</span>
      <span><i className="dot event closed" /> Event</span>
      <span><i className="dot stammtisch" /> geplant</span>
      <span><i className="dot stammtisch cancelled" /> abgesagt</span>
      <span><i className="band-sample" /> mehrtägig</span>
    </div>
  );
}

function MonthView({ ym, setYm, byDate }: { ym: string; setYm: (v: string) => void; byDate: Map<string, StEvent[]> }) {
  const { state, today } = useStore();
  const evs = state.events.filter((e) => ymOf(e.date) <= ym && ymOf(endOf(e)) >= ym).sort(sortEvents);
  const pick = (d: string) => {
    const list = byDate.get(d) ?? [];
    if (list.length === 1) go('termin-' + list[0].id);
    else document.getElementById('d-' + d)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return (
    <div className="cal-view">
      <div className="period-nav">
        <button className="icon-btn" type="button" aria-label="Vorheriger Monat" onClick={() => setYm(shiftYm(ym, -1))}><Icon name="left" /></button>
        <strong>{MONTH_NAMES[+ym.slice(5) - 1]} {ym.slice(0, 4)}</strong>
        <button className="icon-btn" type="button" aria-label="Nächster Monat" onClick={() => setYm(shiftYm(ym, 1))}><Icon name="right" /></button>
      </div>
      <div className="mgrid-card">
        <MonthGrid ym={ym} byDate={byDate} today={today} onPick={pick} />
        <Legend />
      </div>
      {evs.length ? (
        <div className="event-list">{evs.map((e) => <div key={e.id} id={'d-' + e.date}><EventRow ev={e} /></div>)}</div>
      ) : <p className="muted-line">In diesem Monat ist nichts eingetragen.</p>}
      {ymOf(today) !== ym && <button className="link" type="button" onClick={() => setYm(ymOf(today))}>Zum aktuellen Monat</button>}
    </div>
  );
}

function YearView({ year, setYear, byDate, openMonth }: { year: number; setYear: (y: number) => void; byDate: Map<string, StEvent[]>; openMonth: (ym: string) => void }) {
  const { state, today } = useStore();
  const evs = state.events.filter((e) => e.date.slice(0, 4) <= String(year) && endOf(e).slice(0, 4) >= String(year));
  const closedSt = evs.filter((e) => e.type === 'stammtisch' && e.status === 'closed');
  const presence = closedSt.map((e) => A.presentIds(state, e.id).length);
  const avg = presence.length ? (presence.reduce((a, b) => a + b, 0) / presence.length) : 0;
  const decisions = state.notes.filter((n) => n.decision && evs.some((e) => e.id === n.eventId)).length;
  const stats = [
    { n: closedSt.length, l: 'Stammtische' },
    { n: evs.filter((e) => e.type === 'event' && e.status === 'closed').length, l: 'Events' },
    { n: evs.filter((e) => e.status === 'cancelled').length, l: 'abgesagt' },
    { n: avg ? avg.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–', l: 'Ø anwesend' },
    { n: decisions, l: 'Beschlüsse' },
  ];
  return (
    <div className="cal-view">
      <div className="period-nav">
        <button className="icon-btn" type="button" aria-label="Vorheriges Jahr" onClick={() => setYear(year - 1)}><Icon name="left" /></button>
        <strong>{year}</strong>
        <button className="icon-btn" type="button" aria-label="Nächstes Jahr" onClick={() => setYear(year + 1)}><Icon name="right" /></button>
      </div>
      <div className="year-stats">{stats.map((s) => <div key={s.l}><b>{s.n}</b><span>{s.l}</span></div>)}</div>
      <div className="year-grid">
        {MONTH_NAMES.map((name, i) => {
          const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
          const count = evs.filter((e) => ymOf(e.date) <= ym && ymOf(endOf(e)) >= ym && e.status !== 'cancelled').length;
          return (
            <button key={ym} type="button" className={`ym-card${ymOf(today) === ym ? ' current' : ''}`} onClick={() => openMonth(ym)} aria-label={`${name} ${year} öffnen, ${count} Termine`}>
              <span className="ym-head"><strong>{name}</strong>{count > 0 && <span className="count">{count}</span>}</span>
              <MonthGrid ym={ym} byDate={byDate} today={today} mini />
            </button>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

// ---------- Seite ----------
type Mode = 'list' | 'month' | 'year';

export function Calendar() {
  const { state, admin, today } = useStore();
  const [tab, setTab] = useState<'next' | 'past'>('next');
  const [mode, setMode] = useState<Mode>('list');
  const [q, setQ] = useState('');
  const [ym, setYm] = useState(ymOf(today));
  const [year, setYear] = useState(+today.slice(0, 4));
  const [newOpen, setNewOpen] = useState(false);
  const [serOpen, setSerOpen] = useState(false);

  const byDate = useMemo(() => {
    const m = new Map<string, StEvent[]>();
    for (const e of state.events) for (const d of daysOf(e)) m.set(d, [...(m.get(d) ?? []), e]);
    return m;
  }, [state.events]);
  const hits = useMemo(() => searchEvents(state, q), [state, q]);

  const list = state.events
    .filter((e) => (tab === 'next' ? endOf(e) >= today || e.status === 'planned' : endOf(e) < today && e.status !== 'planned'))
    .sort(sortEvents);
  if (tab === 'past') list.reverse();
  const groups: { label: string; items: typeof list }[] = [];
  for (const e of list) {
    const label = monthLabel(e.date);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(e);
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Kalender</h1>
        <button className="btn primary small" type="button" onClick={() => setNewOpen(true)}><Icon name="plus" size={18} /> Termin</button>
      </header>
      {state.series && tab === 'next' && (
        <div className="series-line">
          <Icon name="cal" size={18} />
          <div><strong>{seriesText(state.series)}</strong><span>Ort wird je Treffen festgelegt</span></div>
          {admin && <button className="btn small ghost" type="button" onClick={() => setSerOpen(true)}>Ändern</button>}
        </div>
      )}
      {!state.series && admin && (
        <div className="attention"><Icon name="cal" /><div><strong>Noch keine Terminserie</strong><span>Lege fest, wann ihr euch regelmäßig trefft.</span></div>
          <button className="btn small primary" type="button" onClick={() => setSerOpen(true)}>Einrichten</button></div>
      )}
      <Segmented label="Bereich" value={tab} onChange={setTab} options={[{ value: 'next', label: 'Kommend' }, { value: 'past', label: 'Chronik' }]} />

      {tab === 'past' && (
        <div className="chron-tools">
          <label className="search">
            <Icon name="search" size={18} />
            <input id="chron-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Ort, Notiz, Beschluss, Monat …" aria-label="Chronik durchsuchen" />
            {q && <button className="icon-btn" type="button" aria-label="Suche leeren" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}
          </label>
          {!q && <Segmented label="Ansicht" value={mode} onChange={setMode} options={[{ value: 'list', label: 'Liste' }, { value: 'month', label: 'Monat' }, { value: 'year', label: 'Jahr' }]} />}
        </div>
      )}

      {tab === 'past' && q ? (
        hits.length ? (
          <section className="month">
            <h2 className="month-label">{hits.length} Treffer</h2>
            <div className="event-list">
              {hits.map((h) => (
                <div key={h.ev.id} className="hit">
                  <EventRow ev={h.ev} />
                  {h.snippet && <p className="hit-snip"><span>{h.snippet.label}:</span> <Highlight text={h.snippet.text.length > 140 ? h.snippet.text.slice(0, 140) + ' …' : h.snippet.text} q={q} /></p>}
                </div>
              ))}
            </div>
          </section>
        ) : <Empty icon="search" title="Nichts gefunden">Versuch es mit einem anderen Wort – gesucht wird in Titel, Ort, Datum, Notizen, Beschlüssen und Auslagen.</Empty>
      ) : tab === 'past' && mode === 'month' ? (
        <MonthView ym={ym} setYm={setYm} byDate={byDate} />
      ) : tab === 'past' && mode === 'year' ? (
        <YearView year={year} setYear={setYear} byDate={byDate} openMonth={(m) => { setYm(m); setMode('month'); }} />
      ) : (
        <>
          {groups.length === 0 && (tab === 'next'
            ? <Empty icon="cal" title="Nichts geplant">Lege ein Event an oder richte die Serie ein.</Empty>
            : <Empty icon="note" title="Noch keine Chronik">Abgeschlossene und abgesagte Termine landen hier – mit Notizen und Fotos.</Empty>)}
          {groups.map((g) => (
            <section key={g.label} className="month">
              <h2 className="month-label">{g.label}</h2>
              <div className="event-list">{g.items.map((e) => <EventRow key={e.id} ev={e} />)}</div>
            </section>
          ))}
        </>
      )}
      <EventFormSheet open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => go('termin-' + id)} />
      <SeriesSheet open={serOpen} onClose={() => setSerOpen(false)} />
    </div>
  );
}
