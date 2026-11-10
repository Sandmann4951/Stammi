// Statistik: Zeitraum wählen, Kennzahlen der Runde, Titelträger, Rangliste je Kategorie, Steckbrief je Person.
import { useMemo, useRef, useState } from 'react';
import type { MemberStats, Period } from '@engine/stats';
import { groupStats, memberStats, rank, statYears } from '@engine/stats';
import type { Member } from '@engine/types';
import { addDays, euro } from '@engine/util';
import { go, useStore } from '../store';
import { Avatar, Empty, fmtDate, Icon, Sheet } from '../ui';
import { calendarView } from './common';

type Key = 'stammtische' | 'rate' | 'bestStreak' | 'events' | 'reliability' | 'paid' | 'fromPot' | 'consumed' | 'photos' | 'likesReceived' | 'notes' | 'ideas' | 'comments';
interface Cat {
  key: Key; label: string; icon: string; award: string; hint: string;
  value: (r: MemberStats) => number | null;
  fmt: (n: number) => string;
  /** Mindestmenge, damit ein Titel vergeben wird (z. B. Quote erst ab 3 möglichen Terminen) */
  awardIf?: (r: MemberStats) => boolean;
}
const pct = (n: number) => `${Math.round(n * 100)} %`;
const times = (n: number) => `${n}×`;
const count = (n: number) => String(n);

const CATS: Cat[] = [
  { key: 'stammtische', label: 'Stammtische', icon: 'mug', award: 'Stammgast', hint: 'an abgerechneten Stammtischen dabei', value: (r) => r.stammtische, fmt: times },
  { key: 'rate', label: 'Quote', icon: 'check', award: 'Treue Seele', hint: 'Anteil der Stammtische seit Beitritt', value: (r) => r.rate, fmt: pct, awardIf: (r) => r.possible >= 3 },
  { key: 'bestStreak', label: 'Serie', icon: 'flame', award: 'Dauerbrenner', hint: 'meiste Stammtische am Stück', value: (r) => r.bestStreak, fmt: (n) => `${n} am Stück` },
  { key: 'events', label: 'Events', icon: 'star', award: 'Eventhopper', hint: 'bei Events dabei', value: (r) => r.events, fmt: times },
  { key: 'reliability', label: 'Wort gehalten', icon: 'users', award: 'Ein Mann, ein Wort', hint: 'zugesagt und auch gekommen', value: (r) => r.reliability, fmt: pct, awardIf: (r) => r.yesCount >= 3 },
  { key: 'paid', label: 'Ausgelegt', icon: 'receipt', award: 'Spendierhose', hint: 'Rechnungen übernommen', value: (r) => r.paid, fmt: euro },
  { key: 'fromPot', label: 'Aus der Kasse', icon: 'wallet', award: 'Topf-Abräumer', hint: 'aus dem Topf gutgeschrieben', value: (r) => r.fromPot, fmt: euro },
  { key: 'consumed', label: 'Verzehr', icon: 'mug', award: 'Genießer', hint: 'eigener Anteil an allen Auslagen', value: (r) => r.consumed, fmt: euro },
  { key: 'photos', label: 'Fotos', icon: 'camera', award: 'Paparazzo', hint: 'Fotos hochgeladen', value: (r) => r.photos, fmt: count },
  { key: 'likesReceived', label: 'Likes', icon: 'up', award: 'Bildgewaltig', hint: 'Daumen für eigene Fotos', value: (r) => r.likesReceived, fmt: count },
  { key: 'notes', label: 'Notizen', icon: 'note', award: 'Schriftführer', hint: 'Notizen und Beschlüsse', value: (r) => r.notes, fmt: count },
  { key: 'ideas', label: 'Ideen', icon: 'bulb', award: 'Ideengeber', hint: 'Ideen eingebracht', value: (r) => r.ideas, fmt: count },
  { key: 'comments', label: 'Kommentare', icon: 'chat', award: 'Plaudertasche', hint: 'Kommentare zu Ideen und Fotos', value: (r) => r.comments, fmt: count },
];
const catOf = (k: Key) => CATS.find((c) => c.key === k)!;

type PeriodKey = 'all' | '12m' | `y${number}`;

function periodOf(k: PeriodKey, today: string): Period {
  if (k === 'all') return {};
  if (k === '12m') return { from: addDays(today, -365), to: today };
  const y = k.slice(1);
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Titel: Wer führt in welcher Kategorie (gleichstand → alle). */
function awards(rows: MemberStats[]) {
  return CATS.map((c) => {
    const eligible = rows.filter((r) => (c.awardIf ? c.awardIf(r) : true));
    const ranked = rank(eligible, c.value).filter((x) => x.value > 0);
    const top = ranked.filter((x) => x.place === 1);
    return top.length && top.length < rows.length ? { cat: c, winners: top.map((x) => x.row.memberId), value: top[0].value } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
}

function Podium({ list, members, onPick, cat }: { list: ReturnType<typeof rank<MemberStats>>; members: Map<string, Member>; onPick: (id: string) => void; cat: Cat }) {
  const top = list.filter((x) => x.value > 0).slice(0, 3);
  if (top.length < 2) return null;
  const order = top.length === 3 ? [top[1], top[0], top[2]] : [top[1], top[0]];
  return (
    <div className="podium" aria-hidden="true">
      {order.map((x) => (
        <button key={x.row.memberId} type="button" className={`pd-step p${x.place}`} onClick={() => onPick(x.row.memberId)} tabIndex={-1}>
          <span className="pd-face">
            <Avatar member={members.get(x.row.memberId)} size={x.place === 1 ? 56 : 44} />
            {x.place === 1 && <span className="pd-crown"><Icon name="crown" size={18} stroke={2} /></span>}
          </span>
          <span className="pd-name">{members.get(x.row.memberId)?.name}</span>
          <span className="pd-val">{cat.fmt(x.value)}</span>
          <span className="pd-block">{x.place}</span>
        </button>
      ))}
    </div>
  );
}

function ProfileSheet({ id, rows, onClose }: { id: string | null; rows: MemberStats[]; onClose: () => void }) {
  const { state } = useStore();
  const r = rows.find((x) => x.memberId === id);
  const m = state.members.find((x) => x.id === id);
  const titles = useMemo(() => awards(rows).filter((a) => id && a.winners.includes(id)), [rows, id]);
  if (!r || !m) return null;
  const place = (k: Key) => rank(rows, catOf(k).value).find((x) => x.row.memberId === id && x.value > 0)?.place;
  const Row = ({ k, label, value, sub }: { k?: Key; label: string; value: string; sub?: string }) => {
    const p = k ? place(k) : undefined;
    return (
      <li>
        <span className="pf-label">{label}{sub && <small>{sub}</small>}</span>
        <span className="pf-val">{value}{p && p <= 3 && <span className={`medal m${p}`} title={`Platz ${p}`}>{p}</span>}</span>
      </li>
    );
  };
  return (
    <Sheet open onClose={onClose} title={m.name} wide>
      <div className="steckbrief">
        <div className="pf-head">
          <Avatar member={m} size={64} />
          <div>
            <strong>{m.name}</strong>
            <span>{r.stammtische} Stammtische · {r.events} Events{m.status === 'inactive' ? ' · ehemalig' : ''}</span>
          </div>
        </div>
        {titles.length > 0 && (
          <div className="pf-titles">{titles.map((t) => <span key={t.cat.key} className="pf-title"><Icon name="trophy" size={14} stroke={2} /> {t.cat.award}</span>)}</div>
        )}
        <h4>Dabei sein</h4>
        <ul className="pf-list">
          <Row k="stammtische" label="Stammtische" value={`${r.stammtische} von ${r.possible}`} />
          <Row k="rate" label="Teilnahmequote" value={r.rate === null ? '–' : pct(r.rate)} />
          <Row k="events" label="Events" value={String(r.events)} />
          <Row k="bestStreak" label="Längste Serie" value={`${r.bestStreak} am Stück`} sub={r.streak > 1 ? `aktuell ${r.streak} am Stück` : undefined} />
          <Row k="reliability" label="Wort gehalten" value={r.reliability === null ? '–' : pct(r.reliability)} sub={r.yesCount ? `${Math.round((r.reliability ?? 0) * r.yesCount)} von ${r.yesCount} Zusagen` : undefined} />
        </ul>
        <h4>Geld</h4>
        <ul className="pf-list">
          <Row k="paid" label="Ausgelegt" value={euro(r.paid)} sub={r.paidCount ? `${r.paidCount}× die Rechnung übernommen` : undefined} />
          <Row k="consumed" label="Eigener Anteil an Auslagen" value={euro(r.consumed)} />
          <Row k="fromPot" label="Aus der Kasse bekommen" value={euro(r.fromPot)} />
          <Row label="Beiträge eingezahlt" value={euro(r.contributed)} />
        </ul>
        <h4>Für die Runde</h4>
        <ul className="pf-list">
          <Row k="photos" label="Fotos" value={String(r.photos)} />
          <Row k="likesReceived" label="Daumen für eigene Fotos" value={String(r.likesReceived)} />
          <Row k="notes" label="Notizen" value={String(r.notes)} sub={r.decisions ? `davon ${r.decisions} Beschlüsse` : undefined} />
          <Row k="ideas" label="Ideen" value={String(r.ideas)} />
          <Row k="comments" label="Kommentare" value={String(r.comments)} />
        </ul>
      </div>
    </Sheet>
  );
}

export function Stats() {
  const { state, me, today } = useStore();
  const years = statYears(state);
  const [pk, setPk] = useState<PeriodKey>((calendarView.statPeriod as PeriodKey) ?? 'all');
  const [key, setKey] = useState<Key>((calendarView.statCat as Key) ?? 'stammtische');
  const [profile, setProfile] = useState<string | null>(null);
  calendarView.statPeriod = pk; calendarView.statCat = key;
  const rankRef = useRef<HTMLElement>(null);
  const period = periodOf(pk, today);
  const rows = useMemo(() => memberStats(state, period), [state, pk]); // eslint-disable-line
  const g = useMemo(() => groupStats(state, period), [state, pk]); // eslint-disable-line
  const members = new Map(state.members.map((m) => [m.id, m]));
  const cat = catOf(key);
  const list = rank(rows, cat.value);
  const max = Math.max(1, ...list.map((x) => x.value));
  const titles = awards(rows);
  const top = g.topEvent ? state.events.find((e) => e.id === g.topEvent!.id) : undefined;
  const pickCat = (k: Key) => { setKey(k); setTimeout(() => rankRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const periods: { k: PeriodKey; label: string }[] = [{ k: 'all', label: 'Gesamt' }, { k: '12m', label: '12 Monate' }, ...years.map((y) => ({ k: `y${y}` as PeriodKey, label: String(y) }))];

  return (
    <div className="stats">
      <div className="chips scroll" role="radiogroup" aria-label="Zeitraum">
        {periods.map((p) => <button key={p.k} type="button" role="radio" aria-checked={pk === p.k} className={`chip${pk === p.k ? ' on' : ''}`} onClick={() => setPk(p.k)}>{p.label}</button>)}
      </div>

      {g.stammtische + g.events === 0 ? (
        <Empty icon="star" title="Noch keine Zahlen">In diesem Zeitraum wurde noch nichts abgerechnet. Die Statistik zählt nur Termine, bei denen die Anwesenheit bestätigt ist.</Empty>
      ) : (<>
        <div className="kpis">
          <div><b>{g.stammtische}</b><span>Stammtische</span></div>
          <div><b>{g.events}</b><span>Events</span></div>
          <div><b>{g.avgPresent === null ? '–' : g.avgPresent.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</b><span>Ø dabei</span></div>
          <div><b>{euro(g.expenseTotal).replace(/,00\s?€/, ' €')}</b><span>Auslagen</span></div>
          <div><b>{euro(g.potPaidOut).replace(/,00\s?€/, ' €')}</b><span>aus dem Topf</span></div>
          <div><b>{g.photos}</b><span>Fotos</span></div>
        </div>
        {top && g.topEvent && (
          <button type="button" className="record" onClick={() => go('termin-' + top.id)}>
            <Icon name="trophy" size={18} /> <span><strong>Rekord:</strong> {g.topEvent.present} Leute bei „{top.title}“ am {fmtDate(top.date, 'day')}</span><Icon name="chev" size={16} />
          </button>
        )}

        {titles.length > 0 && (
          <section className="awards-sec">
            <h2 className="month-label">Titelträger</h2>
            <div className="awards scroll">
              {titles.map((a) => (
                <button key={a.cat.key} type="button" className={`award${a.winners.includes(me.id) ? ' mine' : ''}`} onClick={() => pickCat(a.cat.key)}>
                  <span className="aw-icon"><Icon name={a.cat.icon} size={20} /></span>
                  <span className="aw-title">{a.cat.award}</span>
                  <span className="aw-who">
                    <span className="aw-faces">{a.winners.slice(0, 3).map((id) => <Avatar key={id} member={members.get(id)} size={22} />)}</span>
                    {a.winners.length === 1 ? members.get(a.winners[0])?.name : `${a.winners.length} gleichauf`}
                  </span>
                  <span className="aw-val">{a.cat.fmt(a.value)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="rank-sec" ref={rankRef}>
          <h2 className="month-label">Rangliste</h2>
          <div className="chips scroll cats" role="radiogroup" aria-label="Kategorie">
            {CATS.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={key === c.key} className={`chip${key === c.key ? ' on' : ''}`} onClick={() => setKey(c.key)}>
                <Icon name={c.icon} size={15} /> {c.label}
              </button>
            ))}
          </div>
          <p className="rank-hint">{cat.hint}{cat.awardIf ? (cat.key === 'rate' ? ' · Titel ab 3 möglichen Terminen' : ' · Titel ab 3 Zusagen') : ''}</p>
          <Podium list={list} members={members} onPick={setProfile} cat={cat} />
          {list.length ? (
            <ol className="rank-list">
              {list.map((x) => {
                const m = members.get(x.row.memberId);
                return (
                  <li key={x.row.memberId}>
                    <button type="button" className={`rank-row${x.row.memberId === me.id ? ' me' : ''}${x.value <= 0 ? ' zero' : ''}`} onClick={() => setProfile(x.row.memberId)}>
                      <span className={`rk-place${x.value > 0 && x.place <= 3 ? ' m' + x.place : ''}`}>{x.place}</span>
                      <Avatar member={m} size={32} />
                      <span className="rk-main">
                        <span className="rk-name">{m?.name}{x.row.memberId === me.id && ' (ich)'}{m?.status === 'inactive' && <small> · ehemalig</small>}</span>
                        <span className="rk-bar"><i style={{ width: `${Math.max(0, (x.value / max) * 100)}%` }} /></span>
                      </span>
                      <span className="rk-val">{cat.fmt(x.value)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : <p className="muted-line">In dieser Kategorie gibt es für den Zeitraum noch keine Werte.</p>}
          <p className="fineprint">Antippen öffnet den Steckbrief mit allen Zahlen.</p>
        </section>
      </>)}
      {profile && <ProfileSheet id={profile} rows={rows} onClose={() => setProfile(null)} />}
    </div>
  );
}
