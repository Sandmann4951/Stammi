import { useEffect, useRef, useState } from 'react';
import * as A from '../engine/actions';
import { activeEntries, activeMembers, cycleInfo, PAYOUT_PER_MEETING } from '../engine/finance';
import type { MediaAsset, Note, StEvent } from '../engine/types';
import { endOf, euro } from '../engine/util';
import { EventFormSheet, ExpenseSheet } from '../forms';
import { processPhoto, removeMediaBlobs, UploadError, useMediaUrl } from '../media';
import { go, useStore } from '../store';
import { Avatar, Empty, Field, fmtDateTime, fmtRange, Icon, memberName, MemberPicker, Money, Pill, Section, Sheet, timeText, whenText } from '../ui';
import { LocationEditor, PayerCard, RsvpButtons, StatusPill, TypeTag } from './common';

export function EventDetail({ id }: { id: string }) {
  const { state, me, admin, today, run } = useStore();
  const ev = state.events.find((e) => e.id === id);
  const [edit, setEdit] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [close, setClose] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [exp, setExp] = useState(false);
  if (!ev) return <div className="page"><Empty icon="cal" title="Termin nicht gefunden" action={<a className="btn" href="#kalender">Zum Kalender</a>}>Vielleicht wurde er gelöscht.</Empty></div>;

  const canEdit = admin || (ev.type === 'event' && ev.createdBy === me.id);
  const idea = state.ideas.find((i) => i.id === ev.ideaId || i.eventId === ev.id);
  const canClose = admin && ev.status === 'planned' && endOf(ev) <= today;

  return (
    <div className="page detail">
      <a className="back" href="#kalender"><Icon name="back" size={18} /> Kalender</a>

      <header className={`detail-hero${ev.status === 'cancelled' ? ' cancelled' : ''}`}>
        <div className="dh-tags"><TypeTag ev={ev} /><StatusPill ev={ev} today={today} />{ev.detached && ev.status !== 'cancelled' && <Pill tone="muted">einzeln verschoben</Pill>}</div>
        <h1>{ev.title}</h1>
        <p className="dh-date">{fmtRange(ev)} <span>· {whenText(ev, today)}</span></p>
        <div className="dh-meta">
          <span><Icon name="clock" size={16} /> {timeText(ev, true)}</span>
        </div>
        <LocationEditor ev={ev} />
        {ev.description && <p className="dh-desc">{ev.description}</p>}
        {ev.status === 'cancelled' && <p className="cancel-note"><strong>Abgesagt.</strong> {ev.cancelReason}</p>}
        {idea && <a className="linked-idea" href={`#idee-${idea.id}`}><Icon name="bulb" size={16} /> Aus der Idee „{idea.title}“</a>}
        {canEdit && (
          <div className="dh-actions">
            {ev.status === 'planned' && <button className="btn small" type="button" onClick={() => setEdit(true)}><Icon name="edit" size={16} /> {ev.originalSeriesDate ? 'Verschieben / ändern' : 'Bearbeiten'}</button>}
            {ev.status === 'planned' && <button className="btn small" type="button" onClick={() => setCancel(true)}><Icon name="x" size={16} /> Absagen</button>}
            {ev.status === 'cancelled' && <button className="btn small" type="button" onClick={() => run((s, c) => A.restoreEvent(s, c, ev.id), 'Termin findet wieder statt')}>Absage zurücknehmen</button>}
            {ev.status === 'closed' && admin && <button className="btn small" type="button" onClick={() => setReopen(true)}>Abrechnung zurücknehmen</button>}
            {!ev.originalSeriesDate && ev.status !== 'closed' && <button className="btn small ghost danger" type="button" onClick={() => { if (run((s, c) => A.deleteEvent(s, c, ev.id), 'Termin gelöscht')) go('kalender'); }}><Icon name="trash" size={16} /> Löschen</button>}
          </div>
        )}
      </header>

      {canClose && (
        <div className="close-cta">
          <div><strong>{endOf(ev) !== ev.date ? 'Das Event ist vorbei.' : 'Der Termin ist vorbei.'}</strong><span>Bestätige, wer wirklich da war. Danach wird abgerechnet.</span></div>
          <button className="btn primary" type="button" onClick={() => setClose(true)}>Anwesenheit bestätigen</button>
        </div>
      )}

      {ev.status === 'closed' ? <Settlement ev={ev} /> : ev.status === 'planned' && <Participation ev={ev} />}
      {ev.status === 'planned' && ev.type === 'stammtisch' && <PayerCard ev={ev} />}

      {ev.status !== 'cancelled' && <Expenses ev={ev} onAdd={() => setExp(true)} />}
      <Notes ev={ev} />
      <Photos ev={ev} />

      <EventFormSheet open={edit} onClose={() => setEdit(false)} event={ev} />
      <CancelSheet open={cancel} onClose={() => setCancel(false)} ev={ev} />
      <CloseSheet open={close} onClose={() => setClose(false)} ev={ev} />
      <ReopenSheet open={reopen} onClose={() => setReopen(false)} ev={ev} />
      <ExpenseSheet open={exp} onClose={() => setExp(false)} eventId={ev.id} />
    </div>
  );
}

function Participation({ ev }: { ev: StEvent }) {
  const { state, me, admin, run } = useStore();
  const members = activeMembers(state);
  const label = { yes: 'dabei', no: 'kann nicht', open: 'noch offen' };
  return (
    <Section title="Teilnahme">
      <RsvpButtons ev={ev} />
      <ul className="people">
        {members.map((m) => {
          const r = A.rsvpOf(state, ev.id, m.id);
          return (
            <li key={m.id} className={`rsvp-${r}`}>
              <Avatar member={m} size={32} ring={r} />
              <span className="p-name">{m.name}{m.id === me.id && ' (ich)'}</span>
              {admin && m.id !== me.id ? (
                <select aria-label={`Antwort von ${m.name}`} value={r} onChange={(e) => run((s, c) => A.setRsvp(s, c, ev.id, m.id, e.target.value as 'yes'))}>
                  <option value="yes">dabei</option><option value="no">kann nicht</option><option value="open">offen</option>
                </select>
              ) : <span className={`p-state s-${r}`}>{label[r]}</span>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Settlement({ ev }: { ev: StEvent }) {
  const { state, me } = useStore();
  const present = A.presentIds(state, ev.id);
  const entries = activeEntries(state.ledger).filter((e) => e.eventId === ev.id);
  const payout = entries.find((e) => e.kind === 'payout');
  const expEntries = entries.filter((e) => e.kind === 'expense');
  const expenses = state.expenses.filter((x) => x.eventId === ev.id && !x.voidedAt && A.expenseBooking(state, x.id));
  const total = expenses.reduce((a, x) => a + x.amount, 0);
  const rows = state.members.filter((m) => present.includes(m.id) || expenses.some((x) => x.payerId === m.id)).map((m) => {
    const pot = payout?.legs.find((l) => l.account === m.id)?.amount ?? 0;
    const net = expEntries.reduce((a, e) => a + (e.legs.find((l) => l.account === m.id)?.amount ?? 0), 0);
    const paid = expenses.filter((x) => x.payerId === m.id).reduce((a, x) => a + x.amount, 0);
    return { m, pot, share: paid - net, paid, effect: pot + net };
  });
  const absent = activeMembers(state).filter((m) => !present.includes(m.id));
  return (
    <Section title="Abrechnung">
      <p className="settle-summary">
        {present.length} anwesend{absent.length ? ` · gefehlt: ${absent.map((m) => m.name).join(', ')}` : ''}.{' '}
        {payout ? <>Topf: {euro(PAYOUT_PER_MEETING)} verteilt.</> : ev.type === 'stammtisch' ? <>Keine Topfausschüttung (weniger als zwei Anwesende).</> : <>Event ohne Topfausschüttung.</>}
        {total > 0 && <> Auslagen gesamt: {euro(total)}.</>}
      </p>
      <div className="table-wrap">
        <table className="settle-table">
          <thead><tr><th>Person</th><th>Topf</th><th>Auslagen</th><th>Summe</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m.id} className={r.m.id === me.id ? 'me' : ''}>
                <td><span className="cell-person"><Avatar member={r.m} size={24} />{r.m.name}</span></td>
                <td>{r.pot ? <Money cents={r.pot} signed /> : '–'}</td>
                <td>{r.share || r.paid ? <><Money cents={r.paid - r.share} signed />{r.paid > 0 && <small className="cell-sub">bezahlt {euro(r.paid)}</small>}</> : '–'}</td>
                <td><Money cents={r.effect} signed tone /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fineprint">Auslagen = selbst bezahlt minus eigener Kostenanteil. Summe = Wirkung dieses Abends auf den Stand.</p>
    </Section>
  );
}

function Expenses({ ev, onAdd }: { ev: StEvent; onAdd: () => void }) {
  const { state, me, admin, run } = useStore();
  const list = state.expenses.filter((x) => x.eventId === ev.id && !x.voidedAt);
  const [confirm, setConfirm] = useState<string | null>(null);
  const locked = ev.status === 'closed';
  const canAdd = !locked || admin;
  return (
    <Section title="Auslagen" action={canAdd ? <button className="btn small" type="button" onClick={onAdd}><Icon name="plus" size={16} /> {locked ? 'Nachtrag' : 'Auslage'}</button> : <span className="locked-tag"><Icon name="lock" size={14} /> abgerechnet</span>}>
      {locked && !admin && <p className="muted-line">Der Termin ist abgerechnet. Hast du etwas vergessen? Sag dem Admin Bescheid – nur er kann nachtragen oder korrigieren.</p>}
      {list.length === 0 ? (
        !locked && <p className="muted-line">Noch nichts erfasst. Wer die Rechnung zahlt, trägt sie hier ein – verteilt wird nur auf die Anwesenden.</p>
      ) : (
        <ul className="lines">
          {list.map((x) => {
            const booked = !!A.expenseBooking(state, x.id);
            const can = admin || (!booked && (x.createdBy === me.id || x.payerId === me.id));
            return (
              <li key={x.id}>
                <Avatar member={state.members.find((m) => m.id === x.payerId)} size={32} />
                <div className="l-main"><strong>{x.description}</strong><span>bezahlt von {memberName(state, x.payerId)} · {booked ? 'verteilt' : 'wird beim Abschluss verteilt'}</span></div>
                <Money cents={x.amount} className="l-amt" />
                {can && (confirm === x.id ? (
                  <span className="inline-confirm">
                    <button className="btn small danger" type="button" onClick={() => { run((s, c) => A.voidExpense(s, c, x.id), booked ? 'Auslage storniert (Gegenbuchung)' : 'Auslage gelöscht'); setConfirm(null); }}>Löschen</button>
                    <button className="btn small ghost" type="button" onClick={() => setConfirm(null)}>Nein</button>
                  </span>
                ) : <button className="icon-btn" type="button" aria-label="Auslage löschen" onClick={() => setConfirm(x.id)}><Icon name="trash" size={18} /></button>)}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function NoteItem({ n }: { n: Note }) {
  const { state, me, admin, run } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.text);
  const author = state.members.find((m) => m.id === n.authorId);
  const mine = admin || n.authorId === me.id;
  const edited = n.updatedAt !== n.createdAt;
  return (
    <li className={`note${n.decision ? ' decision' : ''}`}>
      <Avatar member={author} size={32} />
      <div className="note-body">
        <div className="note-head">
          <strong>{author?.name}</strong>
          {n.decision && <span className="decision-tag"><Icon name="gavel" size={14} /> Beschluss</span>}
          <span className="note-time">{fmtDateTime(n.createdAt)}{edited && ` · geändert ${fmtDateTime(n.updatedAt)} von ${memberName(state, n.updatedBy)}`}</span>
        </div>
        {editing ? (
          <div className="note-edit">
            <textarea id={`note-edit-${n.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
            <div className="row-actions">
              <button className="btn small primary" type="button" onClick={() => { if (run((s, c) => A.updateNote(s, c, n.id, { text }), 'Notiz gespeichert')) setEditing(false); }}>Speichern</button>
              <button className="btn small ghost" type="button" onClick={() => { setText(n.text); setEditing(false); }}>Abbrechen</button>
            </div>
          </div>
        ) : <p>{n.text}</p>}
        {!editing && (
          <div className="note-actions">
            <button className="link" type="button" onClick={() => run((s, c) => A.updateNote(s, c, n.id, { decision: !n.decision }))}>{n.decision ? 'Kein Beschluss' : 'Als Beschluss markieren'}</button>
            {mine && <button className="link" type="button" onClick={() => setEditing(true)}>Bearbeiten</button>}
            {mine && <button className="link danger" type="button" onClick={() => run((s, c) => A.deleteNote(s, c, n.id), 'Notiz gelöscht')}>Löschen</button>}
          </div>
        )}
      </div>
    </li>
  );
}

function Notes({ ev }: { ev: StEvent }) {
  const { state, me, tryRun } = useStore();
  const [text, setText] = useState('');
  const [decision, setDecision] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const notes = state.notes.filter((n) => n.eventId === ev.id).sort((a, b) => Number(b.decision) - Number(a.decision) || a.createdAt.localeCompare(b.createdAt));
  const add = () => {
    const r = tryRun((s, c) => A.addNote(s, c, ev.id, text, decision), decision ? 'Beschluss festgehalten' : 'Notiz gespeichert');
    if (r.ok) { setText(''); setDecision(false); setErr(null); } else setErr(r.error);
  };
  return (
    <Section title="Notizen & Beschlüsse">
      {notes.length > 0 && <ul className="notes">{notes.map((n) => <NoteItem key={n.id} n={n} />)}</ul>}
      <form className="note-compose" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Avatar member={me} size={32} />
        <div>
          <textarea id={`note-new-${ev.id}`} value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} rows={2} placeholder={notes.length ? 'Noch was festhalten …' : 'Was wurde besprochen oder beschlossen?'} maxLength={1000} />
          <div className="row-actions">
            <label className="check"><input id={`note-dec-${ev.id}`} type="checkbox" checked={decision} onChange={(e) => setDecision(e.target.checked)} /> Beschluss</label>
            <button className="btn small primary" type="submit" disabled={!text.trim()}>Speichern</button>
          </div>
          {err && <p className="form-error">{err}</p>}
        </div>
      </form>
    </Section>
  );
}

function PhotoTile({ m, onOpen }: { m: MediaAsset; onOpen: () => void }) {
  const url = useMediaUrl(m.id, 'thumb');
  return (
    <button type="button" className="photo" onClick={onOpen} aria-label="Foto vergrößern" style={url ? { backgroundImage: `url(${url})` } : undefined}>
      {url === null && <span className="photo-missing">Foto nur auf dem Gerät des Uploads</span>}
    </button>
  );
}

function Lightbox({ m, onClose }: { m: MediaAsset | null; onClose: () => void }) {
  const { state, me, admin, run } = useStore();
  const url = useMediaUrl(m?.id ?? 'none', 'full');
  if (!m) return null;
  return (
    <Sheet open onClose={onClose} title="Foto" wide
      footer={(admin || m.uploaderId === me.id) ? <button className="btn danger" type="button" onClick={() => { if (run((s, c) => A.deleteMedia(s, c, m.id), 'Foto gelöscht')) { removeMediaBlobs(m.id); onClose(); } }}><Icon name="trash" size={16} /> Foto löschen</button> : undefined}>
      {url ? <img className="lightbox-img" src={url} alt={`Foto von ${memberName(state, m.uploaderId)}`} /> : <p className="muted-line">Foto wird geladen …</p>}
      <p className="fineprint">Hochgeladen von {memberName(state, m.uploaderId)} am {fmtDateTime(m.createdAt)} · {Math.round(m.bytes / 1024)} KB</p>
    </Sheet>
  );
}

function Photos({ ev }: { ev: StEvent }) {
  const { state, run, toast } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [open, setOpen] = useState<MediaAsset | null>(null);
  const photos = state.media.filter((m) => m.eventId === ev.id);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, 20);
    setBusy(list.length);
    let ok = 0;
    for (const f of list) {
      try {
        const r = await processPhoto(f);
        if (run((s, c) => A.addMedia(s, c, { ...r, eventId: ev.id }))) ok++;
      } catch (e) {
        toast(e instanceof UploadError ? e.message : `„${f.name}“ konnte nicht verarbeitet werden.`, 'error');
      }
      setBusy((b) => b - 1);
    }
    if (ok) toast(ok === 1 ? 'Foto hochgeladen' : `${ok} Fotos hochgeladen`);
    if (input.current) input.current.value = '';
  };
  return (
    <Section title="Fotos" action={<button className="btn small" type="button" onClick={() => input.current?.click()} disabled={busy > 0}><Icon name="camera" size={16} /> {busy ? `Lädt … (${busy})` : 'Hochladen'}</button>}>
      <input ref={input} id={`photo-input-${ev.id}`} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {photos.length ? (
        <div className="photo-grid">{photos.map((m) => <PhotoTile key={m.id} m={m} onOpen={() => setOpen(m)} />)}</div>
      ) : (
        <button className="drop" type="button" onClick={() => input.current?.click()}>
          <Icon name="camera" size={22} />
          <span>Fotos vom Abend hinzufügen</span>
          <small>JPEG, PNG oder WebP bis 20 MB · werden automatisch verkleinert</small>
        </button>
      )}
      <Lightbox m={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

function CancelSheet({ open, onClose, ev }: { open: boolean; onClose: () => void; ev: StEvent }) {
  const { tryRun } = useStore();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(''); setErr(null); } }, [open]);
  const submit = () => {
    const r = tryRun((s, c) => A.cancelEvent(s, c, ev.id, reason), 'Termin abgesagt');
    if (r.ok) onClose(); else setErr(r.error);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Termin absagen" action={{ label: 'Absagen', onClick: submit, danger: true }}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p>{ev.title} {endOf(ev) !== ev.date ? 'vom' : 'am'} {fmtRange(ev)} fällt aus.{ev.originalSeriesDate && ' Die Serie läuft danach normal weiter.'} Abgesagte Treffen lösen keine Ausschüttung aus und zählen nicht für den Kassenzyklus.</p>
        <Field label="Grund (optional, sehen alle)"><input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Wirtshaus hat Ruhetag" maxLength={80} /></Field>
        {err && <p className="form-error" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}

function ReopenSheet({ open, onClose, ev }: { open: boolean; onClose: () => void; ev: StEvent }) {
  const { tryRun } = useStore();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setErr(null); }, [open]);
  const submit = () => {
    const r = tryRun((s, c) => A.reopenEvent(s, c, ev.id), 'Abrechnung zurückgenommen – per Gegenbuchung');
    if (r.ok) onClose(); else setErr(r.error);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Abrechnung zurücknehmen" action={{ label: 'Zurücknehmen', onClick: submit, danger: true }}>
      <p>Alle Buchungen dieses Termins (Topfgutschrift, verteilte Auslagen und ggf. die dadurch ausgelöste Auffüllung) werden durch Gegenbuchungen neutralisiert. Nichts wird gelöscht – im Journal bleibt alles nachvollziehbar.</p>
      <p>Danach kannst du die Anwesenheit korrigieren und neu abrechnen.</p>
      {err && <p className="form-error" role="alert">{err}</p>}
    </Sheet>
  );
}

function CloseSheet({ open, onClose, ev }: { open: boolean; onClose: () => void; ev: StEvent }) {
  const { state, tryRun } = useStore();
  const members = activeMembers(state);
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const pre = state.attendance.filter((a) => a.eventId === ev.id && (a.present ?? a.rsvp === 'yes')).map((a) => a.memberId);
    setSel(pre); setErr(null);
  }, [open]); // eslint-disable-line
  const p = A.previewClose(state, ev.id, sel);
  const info = cycleInfo(state);
  const pending = A.pendingExpenses(state, ev.id);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = () => {
    const r = tryRun((s, c) => A.closeEvent(s, c, ev.id, sel), p.billable ? `Abgerechnet: ${euro(PAYOUT_PER_MEETING)} an ${sel.length} verteilt` : 'Termin abgeschlossen');
    if (r.ok) onClose(); else setErr(r.error);
  };
  const ordered = members.filter((m) => sel.includes(m.id));
  return (
    <Sheet open={open} onClose={onClose} title="Wer war da?" wide
      footer={<button className="btn primary block" type="button" onClick={submit} disabled={!!p.error}>{p.billable ? `Verbindlich abrechnen` : 'Abschließen'}</button>}>
      <p className="sheet-lead">Vorausgewählt sind alle Zusagen. Zählt nur, wer tatsächlich da war.</p>
      <MemberPicker members={members} selected={sel} onToggle={toggle} label="Anwesende" />
      <div className="preview">
        <h4>Vorschau</h4>
        {p.reason && <p className="hint-box">{p.reason}</p>}
        {p.error && <p className="form-error">{p.error}</p>}
        {ordered.length > 0 && (p.billable || p.expenseTotal > 0) && (
          <div className="table-wrap">
            <table className="settle-table">
              <thead><tr><th>Person</th>{p.billable && <th>Topf</th>}{p.expenseTotal > 0 && <th>Kostenanteil</th>}</tr></thead>
              <tbody>{ordered.map((m) => (
                <tr key={m.id}><td><span className="cell-person"><Avatar member={m} size={24} />{m.name}</span></td>
                  {p.billable && <td><Money cents={p.payout.get(m.id) ?? 0} signed /></td>}
                  {p.expenseTotal > 0 && <td><Money cents={-(p.expenseShares.get(m.id) ?? 0)} signed /></td>}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <ul className="preview-facts">
          {pending.length > 0 && <li>{pending.length} Auslage{pending.length > 1 ? 'n' : ''} über {euro(p.expenseTotal)} werden auf {sel.length || 'niemanden'} verteilt.</li>}
          {pending.length === 0 && <li>Keine Auslagen erfasst. Du kannst sie auch später noch nachtragen.</li>}
          {p.billable && <li>Topf danach: {euro(info.pot - PAYOUT_PER_MEETING)}{p.triggersRefill ? ` → wird automatisch auf ${euro(info.pot - PAYOUT_PER_MEETING + members.length * 2000)} aufgefüllt (je 20 € Beitrag)` : ''}.</li>}
        </ul>
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
    </Sheet>
  );
}
