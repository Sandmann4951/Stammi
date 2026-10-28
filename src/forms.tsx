import { useEffect, useState } from 'react';
import * as A from '@engine/actions';
import { call } from '@engine/registry';
import { activeMembers, payerRanking } from '@engine/finance';
import type { EventType, StEvent } from '@engine/types';
import { addDays, centsToInput, diffDays, euro } from '@engine/util';
import { useStore } from './store';
import { Avatar, Field, fmtRange, Icon, memberName, MoneyInput, Sheet, useMoneyField } from './ui';

// ---------- Auslage ----------
export function ExpenseSheet({ open, onClose, eventId }: { open: boolean; onClose: () => void; eventId?: string }) {
  const { state, me, admin, tryRun, today } = useStore();
  const amount = useMoneyField();
  const [desc, setDesc] = useState('');
  const [payer, setPayer] = useState(me.id);
  const candidates = state.events
    .filter((e) => (admin ? e.status !== 'cancelled' : e.status === 'planned') && e.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const [ev, setEv] = useState(eventId ?? candidates[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { amount.setRaw(''); setDesc(''); setPayer(me.id); setEv(eventId ?? candidates[0]?.id ?? ''); setErr(null); setTouched(false); } }, [open]); // eslint-disable-line

  const event = state.events.find((e) => e.id === ev);
  const suggested = event && event.status === 'planned'
    ? payerRanking(state, activeMembers(state).filter((m) => A.rsvpOf(state, event.id, m.id) === 'yes').map((m) => m.id))[0]
    : undefined;
  const present = event?.status === 'closed' ? A.presentIds(state, ev) : [];
  const submit = () => {
    setTouched(true);
    if (!amount.valid || !desc.trim() || !ev) return;
    const r = tryRun(call('addExpense', { eventId: ev, payerId: payer, amount: amount.cents!, description: desc }), 'Auslage gespeichert');
    if (r.ok) onClose(); else setErr(r.error);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Auslage erfassen"
      action={{ label: 'Sichern', onClick: submit }}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Betrag" error={touched && !amount.valid ? 'Bitte einen Betrag eingeben, z. B. 42,80' : null}>
          <MoneyInput id="exp-amount" value={amount.raw} onChange={amount.setRaw} autoFocus />
        </Field>
        <Field label="Wofür?" error={touched && !desc.trim() ? 'Kurze Beschreibung, z. B. „Rechnung“ oder „Brezn“' : null}>
          <input id="exp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Rechnung Getränke" maxLength={80} />
        </Field>
        {suggested && suggested.id !== payer && (
          <button type="button" className="chip suggest" onClick={() => setPayer(suggested.id)}>
            <Icon name="wallet" size={15} /> Laut Regel zahlt {memberName(state, suggested.id)} ({euro(suggested.standing)}) – übernehmen
          </button>
        )}
        <Field label="Bezahlt von">
          <select id="exp-payer" value={payer} onChange={(e) => setPayer(e.target.value)}>
            {activeMembers(state).map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (ich)` : m.name}</option>)}
          </select>
        </Field>
        {!eventId && candidates.length === 0 && <p className="form-error">Es gibt gerade keinen offenen Termin. Abgerechnete Termine kann nur der Admin nachtragen.</p>}
        {!eventId && candidates.length > 0 && (
          <Field label="Termin">
            <select id="exp-event" value={ev} onChange={(e) => setEv(e.target.value)}>
              {candidates.map((e) => <option key={e.id} value={e.id}>{fmtRange(e, 'day')} · {e.title}</option>)}
            </select>
          </Field>
        )}
        <p className="hint-box">
          {event?.status === 'closed'
            ? <>Der Termin ist abgerechnet. Die Auslage wird sofort auf die {present.length} Anwesenden verteilt{amount.valid && present.length ? <> (je ca. {euro(Math.round(amount.cents! / present.length))})</> : null}.</>
            : <>Verteilt wird beim Abschluss des Termins – nur auf die, die wirklich da waren.</>}
        </p>
        {err && <p className="form-error" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}

// ---------- Ausgleichszahlung ----------
export function SettlementSheet({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: { from: string; to: string; amount: number } }) {
  const { state, me, tryRun, today } = useStore();
  const amount = useMoneyField();
  const [from, setFrom] = useState(me.id);
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const members = activeMembers(state);
  useEffect(() => {
    if (!open) return;
    setFrom(preset?.from ?? me.id);
    setTo(preset?.to ?? members.find((m) => m.id !== (preset?.from ?? me.id))?.id ?? '');
    amount.setRaw(preset ? centsToInput(preset.amount) : '');
    setDate(today); setNote(''); setErr(null); setTouched(false);
  }, [open]); // eslint-disable-line
  const submit = () => {
    setTouched(true);
    if (!amount.valid || from === to) return;
    const r = tryRun(call('addSettlement', { fromId: from, toId: to, amount: amount.cents!, date, note }), 'Zahlung eingetragen');
    if (r.ok) onClose(); else setErr(r.error);
  };
  const fromM = members.find((m) => m.id === from), toM = members.find((m) => m.id === to);
  return (
    <Sheet open={open} onClose={onClose} title="Ausgleich eintragen"
      action={{ label: 'Eintragen', onClick: submit }}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="transfer-visual" aria-hidden="true">
          <span><Avatar member={fromM} size={40} /><small>{fromM?.name}</small></span>
          <span className="arrow">→ {amount.valid ? euro(amount.cents!) : '…'} →</span>
          <span><Avatar member={toM} size={40} /><small>{toM?.name}</small></span>
        </div>
        <div className="row2">
          <Field label="Wer hat gezahlt?">
            <select id="set-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="An wen?" error={touched && from === to ? 'Zahler und Empfänger müssen verschieden sein.' : null}>
            <select id="set-to" value={to} onChange={(e) => setTo(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Betrag" error={touched && !amount.valid ? 'Bitte einen Betrag eingeben.' : null}>
          <MoneyInput id="set-amount" value={amount.raw} onChange={amount.setRaw} autoFocus={!preset} />
        </Field>
        <div className="row2">
          <Field label="Datum"><input id="set-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Notiz (optional)"><input id="set-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="PayPal, bar …" maxLength={60} /></Field>
        </div>
        <p className="hint-box">Echtes Geld fließt außerhalb der App (bar, PayPal, Überweisung). Hier wird nur festgehalten, dass bezahlt wurde.</p>
        {err && <p className="form-error" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}

// ---------- Termin anlegen / bearbeiten (Aufbau wie im iPhone-Kalender) ----------
function toMin(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fromMin(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
/** Verschiebt Datum+Uhrzeit um `delta` Minuten (für „Ende wandert mit“). */
function shiftDT(date: string, time: string, delta: number): { date: string; time: string } {
  let total = toMin(time) + delta;
  let d = date;
  while (total >= 1440) { total -= 1440; d = addDays(d, 1); }
  while (total < 0) { total += 1440; d = addDays(d, -1); }
  return { date: d, time: fromMin(total) };
}
function durationText(sd: string, st: string, ed: string, et: string, allDay: boolean) {
  const days = diffDays(ed, sd);
  if (allDay) return days === 0 ? 'ganztägig' : `${days + 1} Tage`;
  if (!et) return days > 0 ? `${days + 1} Tage` : 'Ende offen';
  const mins = days * 1440 + toMin(et) - toMin(st);
  if (mins <= 0) return '';
  if (days >= 1) return `${days + 1} Tage`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} Std.${m ? ` ${m} Min.` : ''}` : `${m} Min.`;
}

export function EventFormSheet({ open, onClose, event, defaults, onCreated, type: fixedType }: {
  open: boolean; onClose: () => void; event?: StEvent; defaults?: Partial<StEvent>; onCreated?: (id: string) => void; type?: EventType;
}) {
  const { admin, tryRun, today } = useStore();
  const empty = { title: '', location: '', description: '', type: 'event' as EventType, allDay: false, sd: today, st: '19:00', ed: today, et: '22:00' };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const src = event ?? defaults ?? {};
    const sd = src.date ?? today;
    const st = src.time || '19:00';
    setF({
      title: src.title ?? '', location: src.location ?? '', description: src.description ?? '',
      type: event?.type ?? fixedType ?? 'event', allDay: !!src.allDay,
      sd, st, ed: src.endDate ?? sd,
      et: event ? (src.endTime ?? '') : src.endTime ?? shiftDT(sd, st, 180).time,
    });
    setErr(null);
  }, [open]); // eslint-disable-line

  const isEvent = f.type === 'event';
  const ed = isEvent ? f.ed : f.sd; // Stammtisch immer eintägig
  const endBeforeStart = ed < f.sd || (!f.allDay && !!f.et && ed === f.sd && f.et <= f.st);
  const valid = !!f.title.trim() && !endBeforeStart;

  const setStart = (sd: string, st: string) => {
    // Wie am iPhone: Ende wandert mit, die Dauer bleibt
    if (!sd) return;
    const dayShift = diffDays(sd, f.sd);
    const minShift = toMin(st) - toMin(f.st);
    let next = { ...f, sd, st };
    if (isEvent) {
      if (f.et) { const e = shiftDT(addDays(f.ed, dayShift), f.et, minShift); next = { ...next, ed: e.date, et: e.time }; }
      else next = { ...next, ed: addDays(f.ed, dayShift) };
    } else if (f.et) {
      next = { ...next, et: fromMin(Math.min(1439, Math.max(0, toMin(f.et) + minShift))) };
    }
    setF(next); setErr(null);
  };

  const submit = () => {
    if (!valid) { setErr(!f.title.trim() ? 'Bitte einen Titel eingeben.' : 'Das Ende liegt vor dem Beginn.'); return; }
    const payload = {
      title: f.title, date: f.sd, endDate: isEvent && ed > f.sd ? ed : undefined, time: f.allDay ? '' : f.st,
      endTime: f.allDay ? undefined : f.et || undefined, allDay: isEvent && f.allDay ? true : undefined, location: f.location, description: f.description,
    };
    if (event) {
      const r = tryRun(call('updateEvent', event.id, payload), 'Termin aktualisiert');
      if (r.ok) onClose(); else setErr(r.error);
    } else {
      const r = tryRun(call('createEvent', { ...payload, type: f.type, ideaId: defaults?.ideaId }), 'Termin angelegt');
      if (r.ok) { onClose(); onCreated?.(r.value.id); } else setErr(r.error);
    }
  };
  const seriesMoved = event?.originalSeriesDate && f.sd !== event.originalSeriesDate;
  const dur = durationText(f.sd, f.st, ed, f.et, f.allDay);

  return (
    <Sheet open={open} onClose={onClose} title={event ? 'Termin bearbeiten' : 'Neuer Termin'}
      action={{ label: event ? 'Fertig' : 'Hinzufügen', onClick: submit, disabled: !valid }}>
      <form className="form ios-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {!event && admin && !fixedType && (
          <div className="segmented" role="tablist" aria-label="Art">
            <button type="button" className={isEvent ? 'on' : ''} aria-selected={isEvent} onClick={() => setF({ ...f, type: 'event' })}>Event</button>
            <button type="button" className={!isEvent ? 'on' : ''} aria-selected={!isEvent} onClick={() => setF({ ...f, type: 'stammtisch', allDay: false, ed: f.sd, title: f.title || 'Stammtisch' })}>Extra-Stammtisch</button>
          </div>
        )}

        <div className="ios-group">
          <input id="ev-title" className="ios-input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Titel" maxLength={60} aria-label="Titel" />
          <input id="ev-loc" className="ios-input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Ort" maxLength={80} aria-label="Ort" />
        </div>

        <div className="ios-group">
          {isEvent && (
            <label className="ios-row">
              <span>Ganztägig</span>
              <span className="switch-wrap">
                <input id="ev-allday" type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} />
                <span className="switch" aria-hidden="true" />
              </span>
            </label>
          )}
          <div className="ios-row">
            <span>Beginn</span>
            <span className="dt">
              <input id="ev-sd" type="date" className="dt-chip" value={f.sd} onChange={(e) => setStart(e.target.value, f.st)} aria-label="Beginn Datum" />
              {!f.allDay && <input id="ev-st" type="time" className="dt-chip" value={f.st} onChange={(e) => e.target.value && setStart(f.sd, e.target.value)} aria-label="Beginn Uhrzeit" />}
            </span>
          </div>
          <div className="ios-row">
            <span>Ende</span>
            <span className={`dt${endBeforeStart ? ' invalid' : ''}`}>
              {isEvent
                ? <input id="ev-ed" type="date" className="dt-chip" min={f.sd} value={f.ed} onChange={(e) => e.target.value && setF({ ...f, ed: e.target.value })} aria-label="Ende Datum" />
                : <span className="dt-fixed">gleicher Tag</span>}
              {!f.allDay && <input id="ev-et" type="time" className="dt-chip" value={f.et} onChange={(e) => setF({ ...f, et: e.target.value })} aria-label="Ende Uhrzeit" />}
            </span>
          </div>
          {(dur || endBeforeStart) && <div className={`ios-foot${endBeforeStart ? ' bad' : ''}`}>{endBeforeStart ? 'Das Ende liegt vor dem Beginn.' : dur}</div>}
        </div>

        <div className="ios-group">
          <textarea id="ev-desc" className="ios-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} maxLength={600} placeholder="Notizen" aria-label="Notizen" />
        </div>

        {seriesMoved && <p className="hint-box">Nur dieser Termin wird verschoben. Die Serie und alle anderen Termine bleiben, wie sie sind.</p>}
        {err && <p className="form-error" role="alert">{err}</p>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
