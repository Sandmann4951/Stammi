import { useEffect, useState } from 'react';
import * as A from '../engine/actions';
import type { Idea, IdeaStatus } from '../engine/types';
import { endOf, uid } from '../engine/util';
import { EventFormSheet } from '../forms';
import { go, useStore } from '../store';
import { Avatar, Empty, Field, fmtDateTime, fmtRange, timeText, Icon, memberName, Pill, Section, Segmented, Sheet } from '../ui';
import { sortEvents } from './common';

const STATUS_LABEL: Record<IdeaStatus, string> = { open: 'Offen', planned: 'Geplant', done: 'Erledigt' };

function IdeaSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tryRun } = useStore();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setTitle(''); setDesc(''); setErr(null); } }, [open]);
  const submit = () => {
    const r = tryRun((s, c) => A.addIdea(s, c, { title, description: desc }), 'Idee gespeichert');
    if (r.ok) { onClose(); go('idee-' + r.value.id); } else setErr(r.error);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Neue Idee" action={{ label: 'Sichern', onClick: submit }}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Was schwebt dir vor?"><input id="idea-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Brauereiführung" maxLength={60} /></Field>
        <Field label="Details (optional)"><textarea id="idea-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} maxLength={800} placeholder="Wann, wo, was kostet es ungefähr?" /></Field>
        {err && <p className="form-error" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}

export function Ideas() {
  const { state } = useStore();
  const [tab, setTab] = useState<IdeaStatus>('open');
  const [add, setAdd] = useState(false);
  const [sort, setSort] = useState<'new' | 'top'>('new');
  const count = (s: IdeaStatus) => state.ideas.filter((i) => i.status === s).length;
  const score = (id: string) => { const x = A.ideaScore(state, id); return x.up - x.down; };
  const list = state.ideas.filter((i) => i.status === tab)
    .sort((a, b) => (sort === 'top' ? score(b.id) - score(a.id) : 0) || b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="page">
      <header className="page-head">
        <h1>Ideen</h1>
        <button className="btn primary small" type="button" onClick={() => setAdd(true)}><Icon name="plus" size={18} /> Idee</button>
      </header>
      <Segmented label="Status" value={tab} onChange={setTab} options={(['open', 'planned', 'done'] as IdeaStatus[]).map((s) => ({ value: s, label: <>{STATUS_LABEL[s]} <span className="count">{count(s)}</span></> }))} />
      {list.length > 1 && (
        <div className="sort-line">
          <span>Sortieren:</span>
          <button type="button" className={sort === 'new' ? 'on' : ''} aria-pressed={sort === 'new'} onClick={() => setSort('new')}>Neueste</button>
          <button type="button" className={sort === 'top' ? 'on' : ''} aria-pressed={sort === 'top'} onClick={() => setSort('top')}>Beliebteste</button>
        </div>
      )}
      {list.length === 0 ? (
        tab === 'open'
          ? <Empty icon="bulb" title="Keine offenen Ideen" action={<button className="btn primary" type="button" onClick={() => setAdd(true)}>Erste Idee einbringen</button>}>Ausflug, Turnier, Feier – sammelt hier, was ihr mal machen wollt.</Empty>
          : <Empty icon="bulb" title={`Nichts ${STATUS_LABEL[tab].toLowerCase()}`} />
      ) : (
        <div className="idea-grid">{list.map((i) => <IdeaCard key={i.id} idea={i} />)}</div>
      )}
      <IdeaSheet open={add} onClose={() => setAdd(false)} />
    </div>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  const { state } = useStore();
  const c = state.members.find((m) => m.id === idea.creatorId);
  const ev = state.events.find((e) => e.id === idea.eventId);
  const done = idea.checklist.filter((x) => x.done).length;
  const sc = A.ideaScore(state, idea.id);
  const comments = state.ideaComments.filter((k) => k.ideaId === idea.id).length;
  return (
    <a className="idea-card" href={`#idee-${idea.id}`}>
      <h3>{idea.title}</h3>
      {idea.description && <p>{idea.description}</p>}
      {idea.checklist.length > 0 && (
        <div className="progress" aria-label={`${done} von ${idea.checklist.length} erledigt`}>
          <span style={{ width: `${(done / idea.checklist.length) * 100}%` }} />
        </div>
      )}
      <footer>
        <span className="ic-by"><Avatar member={c} size={22} /> {c?.name}</span>
        <span className="ic-stats">
          {ev && <span><Icon name="cal" size={14} /> {fmtRange(ev, 'day')}</span>}
          {!ev && idea.checklist.length > 0 && <span>{done}/{idea.checklist.length}</span>}
          {sc.up > 0 && <span className="up"><Icon name="up" size={14} /> {sc.up}</span>}
          {sc.down > 0 && <span className="down"><Icon name="down" size={14} /> {sc.down}</span>}
          {comments > 0 && <span><Icon name="chat" size={14} /> {comments}</span>}
        </span>
      </footer>
    </a>
  );
}

function Votes({ idea }: { idea: Idea }) {
  const { state, me, run } = useStore();
  const sc = A.ideaScore(state, idea.id);
  const mine = state.ideaVotes.find((v) => v.ideaId === idea.id && v.memberId === me.id)?.value;
  const voters = (v: 1 | -1) => state.ideaVotes.filter((x) => x.ideaId === idea.id && x.value === v).map((x) => memberName(state, x.memberId)).join(', ');
  return (
    <div className="votes" role="group" aria-label="Bewerten">
      <button type="button" className={`vote up${mine === 1 ? ' on' : ''}`} aria-pressed={mine === 1} title={voters(1) || undefined}
        onClick={() => run((s, c) => A.voteIdea(s, c, idea.id, 1))}><Icon name="up" size={18} /> <b>{sc.up}</b> <span>Gefällt mir</span></button>
      <button type="button" className={`vote down${mine === -1 ? ' on' : ''}`} aria-pressed={mine === -1} title={voters(-1) || undefined}
        onClick={() => run((s, c) => A.voteIdea(s, c, idea.id, -1))}><Icon name="down" size={18} /> <b>{sc.down}</b> <span>Eher nicht</span></button>
    </div>
  );
}

function Comments({ idea }: { idea: Idea }) {
  const { state, me, admin, run, tryRun } = useStore();
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const list = state.ideaComments.filter((c) => c.ideaId === idea.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <Section title={`Kommentare${list.length ? ` · ${list.length}` : ''}`}>
      {list.length > 0 && (
        <ul className="notes">
          {list.map((c) => {
            const author = state.members.find((m) => m.id === c.authorId);
            return (
              <li key={c.id} className="note">
                <Avatar member={author} size={32} />
                <div className="note-body">
                  <div className="note-head"><strong>{author?.name}</strong>{c.authorId === idea.creatorId && <span className="decision-tag">Ideengeber</span>}<span className="note-time">{fmtDateTime(c.createdAt)}{c.updatedAt !== c.createdAt && ' · bearbeitet'}</span></div>
                  {edit?.id === c.id ? (
                    <form className="note-edit" onSubmit={(e) => { e.preventDefault(); if (run((s, ctx) => A.updateIdeaComment(s, ctx, c.id, edit.text))) setEdit(null); }}>
                      <textarea id={`kc-${c.id}`} value={edit.text} onChange={(e) => setEdit({ id: c.id, text: e.target.value })} rows={2} />
                      <div className="row-actions"><button className="btn small primary" type="submit">Speichern</button><button className="btn small ghost" type="button" onClick={() => setEdit(null)}>Abbrechen</button></div>
                    </form>
                  ) : <p>{c.text}</p>}
                  {edit?.id !== c.id && (c.authorId === me.id || admin) && (
                    <div className="note-actions">
                      {c.authorId === me.id && <button className="link" type="button" onClick={() => setEdit({ id: c.id, text: c.text })}>Bearbeiten</button>}
                      <button className="link danger" type="button" onClick={() => run((s, ctx) => A.deleteIdeaComment(s, ctx, c.id), 'Kommentar gelöscht')}>Löschen</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form className="note-compose" onSubmit={(e) => { e.preventDefault(); if (tryRun((s, c) => A.addIdeaComment(s, c, idea.id, text)).ok) setText(''); }}>
        <Avatar member={me} size={32} />
        <div>
          <textarea id={`kc-new-${idea.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000}
            placeholder={idea.creatorId === me.id ? 'Ergänzung oder Antwort …' : `Was hältst du davon? Vorschlag an ${memberName(state, idea.creatorId)} …`} />
          <div className="row-actions"><button className="btn small primary" type="submit" disabled={!text.trim()}>Kommentieren</button></div>
        </div>
      </form>
    </Section>
  );
}

export function IdeaDetail({ id }: { id: string }) {
  const { state, me, admin, run, today } = useStore();
  const idea = state.ideas.find((i) => i.id === id);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [item, setItem] = useState('');
  const [plan, setPlan] = useState(false);
  const [link, setLink] = useState(false);
  if (!idea) return <div className="page"><Empty icon="bulb" title="Idee nicht gefunden" action={<a className="btn" href="#ideen">Zu den Ideen</a>} /></div>;
  const owner = A.canEditIdea(state, me.id, idea);
  const creator = state.members.find((m) => m.id === idea.creatorId);
  const ev = state.events.find((e) => e.id === idea.eventId);
  const upd = (p: Parameters<typeof A.updateIdea>[3], msg?: string) => run((s, c) => A.updateIdea(s, c, idea.id, p), msg);
  const addItem = () => { if (!item.trim()) return; upd({ checklist: [...idea.checklist, { id: uid('c'), text: item.trim(), done: false }] }); setItem(''); };
  const upcoming = state.events.filter((e) => e.status === 'planned' && endOf(e) >= today).sort(sortEvents).slice(0, 10);
  const statusTone = { open: 'gold', planned: 'wine', done: 'neutral' } as const;

  return (
    <div className="page detail">
      <a className="back" href="#ideen"><Icon name="back" size={18} /> Ideen</a>
      <header className="detail-hero idea-hero">
        {editing ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); if (upd({ title, description: desc }, 'Gespeichert')) setEditing(false); }}>
            <Field label="Titel"><input id="ie-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} /></Field>
            <Field label="Beschreibung"><textarea id="ie-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} maxLength={800} /></Field>
            <div className="row-actions"><button className="btn primary small" type="submit">Speichern</button><button className="btn ghost small" type="button" onClick={() => setEditing(false)}>Abbrechen</button></div>
          </form>
        ) : (
          <>
            {!owner && <div className="dh-tags"><Pill tone={statusTone[idea.status]}>{STATUS_LABEL[idea.status]}</Pill></div>}
            <h1>{idea.title}</h1>
            {idea.description ? <p className="dh-desc">{idea.description}</p> : <p className="dh-desc muted">Noch keine Beschreibung.</p>}
            <p className="fineprint"><Avatar member={creator} size={20} /> {owner ? 'Deine Idee' : `Idee von ${creator?.name}`} · zuletzt geändert {fmtDateTime(idea.updatedAt)}</p>
            <Votes idea={idea} />
            {(owner || admin) && (
              <div className="dh-actions">
                {owner && <button className="btn small" type="button" onClick={() => { setTitle(idea.title); setDesc(idea.description); setEditing(true); }}><Icon name="edit" size={16} /> Bearbeiten</button>}
                <button className="btn small ghost danger" type="button" onClick={() => { if (run((s, c) => A.deleteIdea(s, c, idea.id), 'Idee gelöscht')) go('ideen'); }}><Icon name="trash" size={16} /> Löschen</button>
              </div>
            )}
            {!owner && <p className="fineprint"><Icon name="lock" size={14} /> Bearbeiten kann nur {creator?.name}. Du kannst bewerten und kommentieren.</p>}
          </>
        )}
      </header>

      {owner && (
        <Section title="Status">
          <Segmented label="Status" value={idea.status} onChange={(v) => upd({ status: v }, `Status: ${STATUS_LABEL[v]}`)} options={(['open', 'planned', 'done'] as IdeaStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        </Section>
      )}

      {(ev || owner) && (
        <Section title="Termin">
          {ev ? (
            <a className="linked-event" href={`#termin-${ev.id}`}>
              <Icon name="cal" />
              <span><strong>{ev.title}</strong><small>{fmtRange(ev)} · {timeText(ev)}{ev.location ? ` · ${ev.location}` : ''}</small></span>
              <Icon name="chev" size={18} />
            </a>
          ) : (
            <div className="row-actions wrap">
              <button className="btn primary" type="button" onClick={() => setPlan(true)}><Icon name="cal" size={18} /> Als Event planen</button>
              {upcoming.length > 0 && <button className="btn" type="button" onClick={() => setLink(true)}><Icon name="link" size={18} /> Mit Termin verknüpfen</button>}
            </div>
          )}
          {ev && owner && <button className="link" type="button" onClick={() => upd({ eventId: undefined }, 'Verknüpfung gelöst')}>Verknüpfung lösen</button>}
        </Section>
      )}

      {(owner || idea.checklist.length > 0) && (
        <Section title={`Checkliste${idea.checklist.length ? ` · ${idea.checklist.filter((x) => x.done).length}/${idea.checklist.length}` : ''}`}>
          <ul className="checklist">
            {idea.checklist.map((c) => (
              <li key={c.id} className={c.done ? 'done' : ''}>
                <label className="check big">
                  <input id={`cl-${c.id}`} type="checkbox" checked={c.done} disabled={!owner} onChange={() => upd({ checklist: idea.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                  <span>{c.text}</span>
                </label>
                {owner && <button className="icon-btn" type="button" aria-label={`„${c.text}“ entfernen`} onClick={() => upd({ checklist: idea.checklist.filter((x) => x.id !== c.id) })}><Icon name="x" size={16} /></button>}
              </li>
            ))}
          </ul>
          {owner && (
            <form className="add-line" onSubmit={(e) => { e.preventDefault(); addItem(); }}>
              <input id="cl-new" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Punkt hinzufügen …" maxLength={80} />
              <button className="btn small" type="submit" disabled={!item.trim()}>Hinzufügen</button>
            </form>
          )}
        </Section>
      )}

      <Comments idea={idea} />

      <EventFormSheet open={plan} onClose={() => setPlan(false)} type="event" defaults={{ title: idea.title, description: idea.description, ideaId: idea.id }}
        onCreated={(eid) => { run((s, c) => A.updateIdea(s, c, idea.id, { eventId: eid, status: 'planned' })); go('termin-' + eid); }} />
      <Sheet open={link} onClose={() => setLink(false)} title="Mit Termin verknüpfen">
        <ul className="pick-list">
          {upcoming.map((e) => (
            <li key={e.id}><button type="button" onClick={() => { upd({ eventId: e.id, status: 'planned' }, 'Verknüpft'); setLink(false); }}>
              <strong>{e.title}</strong><small>{fmtRange(e)} · {timeText(e)}</small>
            </button></li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
