import { useState } from 'react';
import * as A from '../engine/actions';
import { breakdown, cycleInfo, PAYOUT_PER_MEETING } from '../engine/finance';
import { euro } from '../engine/util';
import { ExpenseSheet } from '../forms';
import { useMediaUrl } from '../media';
import { go, useStore } from '../store';
import { Avatar, DateBlock, Empty, fmtDate, fmtRange, Icon, Money, Section, timeText, whenText } from '../ui';
import { AttendeeStrip, CycleDots, LocationEditor, nextEvent, openClosings, PayerCard, PotMug, RsvpButtons, TypeTag } from './common';

function Thumb({ id, eventId }: { id: string; eventId: string }) {
  const url = useMediaUrl(id, 'thumb');
  return <a className="thumb" href={`#termin-${eventId}`} style={url ? { backgroundImage: `url(${url})` } : undefined} aria-label="Foto ansehen" />;
}

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Servus' : 'Guten Abend';
}

export function Dashboard() {
  const { state, me, admin, today, run } = useStore();
  const [expOpen, setExpOpen] = useState(false);
  const next = nextEvent(state, today);
  const nextSt = state.events.filter((e) => e.type === 'stammtisch' && e.status === 'planned' && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const pending = openClosings(state, today);
  const info = cycleInfo(state);
  const bd = breakdown(state, me.id);
  const photos = [...state.media].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  const ideas = state.ideas.filter((i) => i.status === 'open').slice(0, 3);
  const lastClosed = state.events.filter((e) => e.status === 'closed').sort((a, b) => b.date.localeCompare(a.date))[0];
  const mineToClose = pending.filter((e) => A.pendingExpenses(state, e.id).length || e.type === 'stammtisch');

  return (
    <div className="page dashboard">
      <header className="hello">
        <h1>{greeting()}, {me.name}</h1>
        <p>{fmtDate(today)}</p>
      </header>

      {admin && info.cycleNo === 0 && (
        <div className="attention">
          <Icon name="mug" />
          <div><strong>Kasse noch nicht gestartet</strong><span>Mit dem Start kommen {euro(state.members.filter((m) => m.status === 'active').length * 2000)} in den Topf.</span></div>
          <button className="btn small primary" type="button" onClick={() => run(A.startCashPool, 'Kasse gestartet – der Topf ist gefüllt')}>Starten</button>
        </div>
      )}
      {admin && mineToClose.map((e) => (
        <a key={e.id} className="attention" href={`#termin-${e.id}`}>
          <Icon name="check" />
          <div><strong>Abschluss offen: {e.title} vom {fmtRange(e, 'day')}</strong><span>Wer war da? Bestätigen und abrechnen.</span></div>
          <Icon name="chev" size={18} />
        </a>
      ))}

      {next ? (
        <article className="next-card" onClick={() => go('termin-' + next.id)}>
          <div className="nc-top">
            <span className="eyebrow">{next.date < today ? 'Gerade unterwegs' : 'Nächster Termin'} · {whenText(next, today)}</span>
            <TypeTag ev={next} />
          </div>
          <div className="nc-main">
            <DateBlock ev={next} big />
            <div>
              <h2><a href={`#termin-${next.id}`} onClick={(e) => e.stopPropagation()}>{next.title}</a></h2>
              <p className="nc-meta"><Icon name="clock" size={16} /> {timeText(next)}</p>
            </div>
          </div>
          <LocationEditor ev={next} />
          <AttendeeStrip ev={next} />
          <RsvpButtons ev={next} />
        </article>
      ) : (
        <Empty icon="cal" title="Kein Termin geplant" action={<a className="btn" href="#kalender">Zum Kalender</a>}>Sobald eine Serie eingerichtet ist, erscheinen die Stammtische hier.</Empty>
      )}

      <PayerCard ev={nextSt} />

      <div className="tiles">
        <a className="tile" href="#kasse">
          <span className="eyebrow">Dein Stand</span>
          <Money cents={bd.standing} signed tone className="big-num" />
          <span className="tile-sub">{bd.standing > 0 ? 'bekommst du von der Runde' : bd.standing < 0 ? 'schuldest du der Runde' : 'alles ausgeglichen'}</span>
        </a>
        <a className="tile pot-tile" href="#kasse">
          <div>
            <span className="eyebrow">Topf</span>
            <span className="big-num">{euro(info.pot)}</span>
            <span className="tile-sub">{info.cycleNo ? <><CycleDots /> {info.settledInCycle} von 2 Treffen</> : 'noch nicht gestartet'}</span>
          </div>
          <PotMug cents={info.pot} size={58} />
        </a>
      </div>
      {info.cycleNo > 0 && (
        <p className="pot-explainer">Jeder abgerechnete Stammtisch verteilt {euro(PAYOUT_PER_MEETING)} aus dem Topf auf die Anwesenden. Nach zwei Treffen wird wieder aufgefüllt.</p>
      )}
      <div className="quick">
        <button className="btn" type="button" onClick={() => setExpOpen(true)}><Icon name="receipt" size={18} /> Auslage erfassen</button>
        <a className="btn" href="#ideen"><Icon name="bulb" size={18} /> Idee einbringen</a>
      </div>

      <Section title="Letzte Fotos" action={photos.length ? undefined : null}>
        {photos.length ? (
          <div className="thumb-strip">{photos.map((p) => <Thumb key={p.id} id={p.id} eventId={p.eventId} />)}</div>
        ) : (
          <Empty icon="camera" title="Noch keine Fotos">
            {lastClosed ? <>Hast du welche vom {fmtDate(lastClosed.date, 'day')}? <a href={`#termin-${lastClosed.id}`}>Hier hochladen</a>.</> : 'Fotos lädst du direkt beim Termin hoch.'}
          </Empty>
        )}
      </Section>

      <Section title="Offene Ideen" action={<a className="link" href="#ideen">Alle</a>}>
        {ideas.length ? (
          <ul className="idea-mini">
            {ideas.map((i) => {
              const c = state.members.find((m) => m.id === i.creatorId);
              const done = i.checklist.filter((x) => x.done).length;
              return (
                <li key={i.id}><a href={`#idee-${i.id}`}>
                  <Avatar member={c} size={28} />
                  <span className="im-title">{i.title}</span>
                  {i.checklist.length > 0 && <span className="im-prog">{done}/{i.checklist.length}</span>}
                  <Icon name="chev" size={16} />
                </a></li>
              );
            })}
          </ul>
        ) : <Empty icon="bulb" title="Keine offenen Ideen" action={<a className="btn" href="#ideen">Idee einbringen</a>} />}
      </Section>

      <ExpenseSheet open={expOpen} onClose={() => setExpOpen(false)} />
    </div>
  );
}
