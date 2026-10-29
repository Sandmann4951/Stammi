import { useEffect, useMemo, useRef, useState } from 'react';
import * as A from '@engine/actions';
import { call } from '@engine/registry';
import {
  activeMembers, breakdown, CATEGORY_LABEL, cycleInfo, PAYOUT_PER_MEETING, ledgerCsv, reversedIds, standings, suggestPayments,
  type Category, type Payment,
} from '@engine/finance';
import { POT, type LedgerEntry, type State } from '@engine/types';
import { euro, euroSigned, parseEuro } from '@engine/util';
import { ExpenseSheet, SettlementSheet } from '../forms';
import { useStore } from '../store';
import { Avatar, copyText, Empty, Field, fmtDate, Icon, memberName, MemberPicker, Money, MoneyInput, Pill, Section, Segmented, Sheet, useMoneyField } from '../ui';
import { CycleDots, PotMug } from './common';

const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  refill: 'Auffüllung', payout: 'Topfgutschrift', expense: 'Auslage', settlement: 'Ausgleich', opening: 'Anfangsbestand',
  special_in: 'Sonderzuführung', special_out: 'Sonderausschüttung', reversal: 'Storno',
};

export function Cash() {
  const { state, me, admin } = useStore();
  const [exp, setExp] = useState(false);
  const [settle, setSettle] = useState<{ open: boolean; preset?: Payment }>({ open: false });
  const [special, setSpecial] = useState(false);
  const [opening, setOpening] = useState(false);
  const [balances, setBalances] = useState(false);
  const [explain, setExplain] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const info = cycleInfo(state);
  const st = standings(state);
  const bd = breakdown(state, me.id);
  const members = state.members.filter((m) => m.status === 'active' || (st.get(m.id) ?? 0) !== 0).sort((a, b) => a.order - b.order);
  const maxAbs = Math.max(1, ...members.map((m) => Math.abs(st.get(m.id) ?? 0)));
  const payments = suggestPayments(st, state.members.map((m) => m.id));
  const myPayments = payments.filter((p) => p.from === me.id || p.to === me.id);
  const otherPayments = payments.filter((p) => p.from !== me.id && p.to !== me.id);

  return (
    <div className="page cash">
      <header className="page-head">
        <h1>Kasse</h1>
        <button className="btn small ghost" type="button" onClick={() => setExplain(true)}><Icon name="info" size={16} /> So wird gerechnet</button>
      </header>

      <div className="cash-hero">
        <div className="ch-me">
          <span className="eyebrow">Dein Stand</span>
          <Money cents={bd.standing} signed tone className="hero-num" />
          <p>{bd.standing > 0 ? `Die Runde schuldet dir ${euro(bd.standing)}.` : bd.standing < 0 ? `Du schuldest der Runde ${euro(-bd.standing)}.` : 'Du bist komplett ausgeglichen.'}</p>
          <button className="link" type="button" aria-expanded={showBreakdown} onClick={() => setShowBreakdown(!showBreakdown)}>{showBreakdown ? 'Aufschlüsselung ausblenden' : 'Wie setzt sich das zusammen?'}</button>
          {showBreakdown && (
            <dl className="breakdown">
              {(Object.keys(CATEGORY_LABEL) as Category[]).filter((k) => bd.byCategory[k] !== 0).map((k) => (
                <div key={k}><dt>{CATEGORY_LABEL[k]}</dt><dd><Money cents={bd.byCategory[k]} signed /></dd></div>
              ))}
              <div><dt>Dein Anteil am Topf</dt><dd><Money cents={bd.potShare} signed /></dd></div>
              <div className="sum"><dt>Stand</dt><dd><Money cents={bd.standing} signed tone /></dd></div>
            </dl>
          )}
        </div>
        <div className="ch-pot">
          <PotMug cents={info.pot} size={70} />
          <div>
            <span className="eyebrow">Topf</span>
            <strong className="pot-num">{euro(info.pot)}</strong>
            {info.cycleNo > 0 ? (
              <>
                <span className="ch-sub"><CycleDots /> Zyklus {info.cycleNo}: {info.settledInCycle} von 2 Treffen</span>
                {info.available > 0 && <span className="ch-sub">{euro(info.available)} frei für Sonderausschüttungen</span>}
              </>
            ) : <span className="ch-sub">Kasse noch nicht gestartet</span>}
          </div>
        </div>
      </div>

      <div className="quick">
        <button className="btn" type="button" onClick={() => setExp(true)}><Icon name="receipt" size={18} /> Auslage</button>
        <button className="btn" type="button" onClick={() => setSettle({ open: true })}><Icon name="swap" size={18} /> Ausgleich</button>
      </div>

      <Section title="Zahlungsvorschläge">
        {payments.length === 0 ? <p className="muted-line">Alles ausgeglichen. Niemand muss jemandem etwas zahlen.</p> : (
          <>
            <ul className="payments">
              {[...myPayments, ...otherPayments].map((p, i) => {
                const mine = p.from === me.id || p.to === me.id;
                const from = state.members.find((m) => m.id === p.from), to = state.members.find((m) => m.id === p.to);
                return (
                  <li key={i} className={mine ? 'mine' : ''}>
                    <span className="pay-who">
                      <Avatar member={from} size={30} />
                      <span className="pay-names"><b>{from?.name}</b> <span className="pay-arrow">zahlt an</span> <b>{to?.name}</b></span>
                    </span>
                    <Money cents={p.amount} className="pay-amt" />
                    <button className="btn small" type="button" aria-label={`${from?.name} an ${to?.name} als bezahlt eintragen`} onClick={() => setSettle({ open: true, preset: p })}><Icon name="check" size={16} /> Bezahlt</button>
                  </li>
                );
              })}
            </ul>
            <p className="fineprint">Mit {payments.length} Zahlung{payments.length > 1 ? 'en' : ''} wäre alles ausgeglichen. „Bezahlt“ trägt die Zahlung vorausgefüllt ein.</p>
          </>
        )}
      </Section>

      <Section title="Wer steht wie">
        <ul className="standings">
          {members.map((m) => {
            const v = st.get(m.id) ?? 0;
            return (
              <li key={m.id} className={m.id === me.id ? 'me' : ''}>
                <span className="s-name"><Avatar member={m} size={26} />{m.name}</span>
                <span className="s-bar" aria-hidden="true">
                  <span className={`s-fill ${v >= 0 ? 'pos' : 'neg'}`} style={{ width: `${(Math.abs(v) / maxAbs) * 50}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
                </span>
                <Money cents={v} signed tone className="s-val" />
              </li>
            );
          })}
        </ul>
      </Section>

      {admin && (
        <Section title="Verwaltung">
          <div className="admin-actions">
            {info.cycleNo === 0 && <AdminStart />}
            <button className="admin-card" type="button" onClick={() => setSpecial(true)}>
              <Icon name="star" /><span><strong>Sonderbuchung</strong><small>Zuführung oder Ausschüttung, außerhalb des Zyklus</small></span>
            </button>
            <button className="admin-card" type="button" onClick={() => setBalances(true)} disabled={!!A.openingImported(state)}>
              <Icon name="swap" /><span><strong>Stand aus Splitwise übernehmen</strong><small>{A.openingImported(state) ? `Übernommen am ${fmtDate(A.openingImported(state)!.date)}` : 'Gruppenbilanz inkl. Vereinskasse – einmalig'}</small></span>
            </button>
          </div>
        </Section>
      )}

      <Journal />

      <ExpenseSheet open={exp} onClose={() => setExp(false)} />
      <SettlementSheet open={settle.open} preset={settle.preset} onClose={() => setSettle({ open: false })} />
      <SpecialSheet open={special} onClose={() => setSpecial(false)} />
      <OpeningSheet open={opening} onClose={() => setOpening(false)} />
      <BalancesSheet open={balances} onClose={() => setBalances(false)} onPairs={() => { setBalances(false); setOpening(true); }} />
      <ExplainSheet open={explain} onClose={() => setExplain(false)} />
    </div>
  );
}

function AdminStart() {
  const { state, run } = useStore();
  const n = activeMembers(state).length;
  return (
    <button className="admin-card hot" type="button" onClick={() => run(call('startCashPool'), 'Kasse gestartet')}>
      <Icon name="mug" /><span><strong>Kasse starten</strong><small>{n} × 20 € = {euro(n * 2000)} in den Topf, je 20 € Beitrag</small></span>
    </button>
  );
}

function Journal() {
  const { state, me, admin, tryRun, toast } = useStore();
  const [filter, setFilter] = useState<'mine' | 'all'>('mine');
  const [openId, setOpenId] = useState<string | null>(null);
  const [storno, setStorno] = useState<LedgerEntry | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [csv, setCsv] = useState(false);
  const csvRef = useRef<HTMLTextAreaElement>(null);
  const rev = reversedIds(state.ledger);
  const list = useMemo(() => [...state.ledger].sort((a, b) => b.seq - a.seq)
    .filter((e) => filter === 'all' || e.legs.some((l) => l.account === me.id)), [state.ledger, filter, me.id]);
  const [limit, setLimit] = useState(25);
  const csvText = csv ? ledgerCsv(state) : '';
  const name = (id: string) => (id === POT ? 'Topf' : memberName(state, id));
  useEffect(() => { setErr(null); setReason(''); }, [storno]);

  return (
    <Section title="Buchungen" action={<button className="btn small ghost" type="button" onClick={() => setCsv(true)}>CSV-Export</button>}>
      <Segmented label="Filter" value={filter} onChange={(v) => { setFilter(v); setLimit(25); }} options={[{ value: 'mine', label: 'Meine' }, { value: 'all', label: 'Alle' }]} />
      {list.length === 0 ? <Empty icon="receipt" title="Noch keine Buchungen" /> : (
        <ul className="journal">
          {list.slice(0, limit).map((e) => {
            const myLeg = e.legs.find((l) => l.account === me.id)?.amount;
            const potLeg = e.legs.find((l) => l.account === POT)?.amount;
            const shown = filter === 'mine' ? myLeg ?? 0 : potLeg ?? e.legs.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);
            const isRev = rev.has(e.id);
            const open = openId === e.id;
            const stornoable = !isRev && e.kind !== 'reversal' && ['settlement', 'opening', 'special_in', 'special_out'].includes(e.kind) && (admin || (e.kind === 'settlement' && e.createdBy === me.id));
            return (
              <li key={e.id} className={`${isRev ? 'reversed' : ''} ${e.kind === 'reversal' ? 'is-rev' : ''}`}>
                <button className="j-row" type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : e.id)}>
                  <span className="j-date">{fmtDate(e.date, 'short')}</span>
                  <span className="j-main"><span className="j-kind">{KIND_LABEL[e.kind]}{isRev && <Pill tone="muted">storniert</Pill>}</span><span className="j-text">{e.text}</span></span>
                  {filter === 'all' && potLeg !== undefined ? <span className="j-amt"><small>Topf</small> <Money cents={potLeg} signed /></span> : <Money cents={shown} signed tone={filter === 'mine'} className="j-amt" />}
                </button>
                {open && (
                  <div className="j-detail">
                    <table><tbody>{e.legs.map((l) => <tr key={l.account}><td>{name(l.account)}</td><td><Money cents={l.amount} signed tone /></td></tr>)}</tbody></table>
                    <p className="fineprint">Buchung Nr. {e.seq} · erfasst von {name(e.createdBy)} am {new Date(e.createdAt).toLocaleString('de-DE')}</p>
                    {e.eventId && <a className="link" href={`#termin-${e.eventId}`}>Zum Termin</a>}
                    {stornoable && <button className="btn small" type="button" onClick={() => setStorno(e)}>Stornieren</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > limit && <button className="btn ghost block" type="button" onClick={() => setLimit(limit + 50)}>Ältere Buchungen zeigen ({list.length - limit})</button>}

      <Sheet open={!!storno} onClose={() => setStorno(null)} title="Buchung stornieren"
        footer={<button className="btn danger block" type="button" onClick={() => { const r = tryRun(call('reverseEntry', storno!.id, reason), 'Storniert – Gegenbuchung angelegt'); if (r.ok) setStorno(null); else setErr(r.error); }}>Gegenbuchung anlegen</button>}>
        <p>„{storno?.text}“ wird durch eine Gegenbuchung neutralisiert. Beide bleiben im Journal sichtbar.</p>
        <Field label="Grund (optional)"><input id="storno-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} /></Field>
        {err && <p className="form-error" role="alert">{err}</p>}
      </Sheet>

      <Sheet open={csv} onClose={() => setCsv(false)} title="CSV-Export aller Buchungen" wide
        footer={<button className="btn primary block" type="button" onClick={async () => { const ok = await copyText(csvText, csvRef.current); toast(ok ? 'CSV kopiert – z. B. in Excel einfügen' : 'Text markiert – jetzt mit Strg/Cmd+C kopieren'); }}><Icon name="copy" size={16} /> In die Zwischenablage</button>}>
        <p className="sheet-lead">Semikolon-getrennt, deutsches Dezimalkomma – passt direkt in Excel. In der fertigen App gibt es dafür einen Download.</p>
        <textarea id="csv-out" ref={csvRef} className="csv-box" readOnly value={csvText} rows={10} />
      </Sheet>
    </Section>
  );
}

function SpecialSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, me, tryRun, today } = useStore();
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [mode, setMode] = useState<A.SpecialInMode>('all');
  const [sel, setSel] = useState<string[]>([]);
  const [holder, setHolder] = useState(me.id);
  const amount = useMoneyField();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const members = activeMembers(state);
  const info = cycleInfo(state);
  useEffect(() => { if (open) { setDir('in'); setMode('all'); setSel([]); setHolder(me.id); amount.setRaw(''); setReason(''); setDate(today); setErr(null); } }, [open]); // eslint-disable-line
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = () => {
    if (!amount.valid) { setErr('Bitte einen Betrag eingeben.'); return; }
    const r = dir === 'in'
      ? tryRun(call('specialIn', { amount: amount.cents!, mode, memberIds: sel, holderId: holder, reason, date }), 'Sonderzuführung gebucht')
      : tryRun(call('specialOut', { amount: amount.cents!, recipientIds: sel, reason, date }), 'Sonderausschüttung gebucht');
    if (r.ok) onClose(); else setErr(r.error);
  };
  const n = dir === 'out' ? sel.length : mode === 'all' ? members.length : mode === 'selected' ? sel.length : 1;
  return (
    <Sheet open={open} onClose={onClose} title="Sonderbuchung" action={{ label: 'Buchen', onClick: submit }}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Segmented label="Richtung" value={dir} onChange={(v) => { setDir(v); setSel([]); setErr(null); }} options={[{ value: 'in', label: 'In den Topf' }, { value: 'out', label: 'Aus dem Topf' }]} />
        <Field label="Betrag" hint={dir === 'out' ? `Frei verfügbar: ${euro(info.available)} (Topf ${euro(info.pot)} − ${euro(info.reserve)} reserviert für die nächsten Stammtische)` : undefined}>
          <MoneyInput id="sp-amount" value={amount.raw} onChange={(v) => { amount.setRaw(v); setErr(null); }} />
        </Field>
        <Field label="Grund"><input id="sp-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dir === 'in' ? 'z. B. Geburtstagsrunde von Stefan' : 'z. B. Taxi zum Kegeln'} maxLength={80} /></Field>
        {dir === 'in' ? (
          <>
            <Field label="Wer finanziert?">
              <select id="sp-mode" value={mode} onChange={(e) => setMode(e.target.value as A.SpecialInMode)}>
                <option value="all">Alle aktiven Mitglieder gleich</option>
                <option value="selected">Ausgewählte Mitglieder</option>
                <option value="external">Externe Spende</option>
              </select>
            </Field>
            {mode === 'selected' && <MemberPicker members={members} selected={sel} onToggle={toggle} label="Finanzierende Mitglieder" />}
            {mode === 'external' && (
              <Field label="Wer hat das Geld entgegengenommen?" hint="Diese Person verwahrt die Spende und gibt sie über den Ausgleich weiter.">
                <select id="sp-holder" value={holder} onChange={(e) => setHolder(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              </Field>
            )}
          </>
        ) : (
          <>
            <span className="field-label">An wen?</span>
            <MemberPicker members={members} selected={sel} onToggle={toggle} label="Empfänger" />
            <button className="link" type="button" onClick={() => setSel(members.map((m) => m.id))}>Alle auswählen</button>
          </>
        )}
        <Field label="Datum"><input id="sp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {amount.valid && n > 0 && <p className="hint-box">{dir === 'in' ? 'Belastung' : 'Gutschrift'}: {n === 1 ? euro(amount.cents!) : `je ca. ${euro(Math.round(amount.cents! / n))}`}{dir === 'in' && mode === 'external' ? ' für die verwahrende Person' : ''}. Der Zwei-Treffen-Zähler bleibt unverändert.</p>}
        {err && <p className="form-error" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}

interface DraftClaim { debtorId: string; creditorId: string; raw: string }

function OpeningSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, tryRun, today } = useStore();
  const members = activeMembers(state);
  const [rows, setRows] = useState<DraftClaim[]>([]);
  const [date, setDate] = useState(today);
  const [step, setStep] = useState<'edit' | 'preview'>('edit');
  const [csvIn, setCsvIn] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setRows([{ debtorId: members[1]?.id ?? '', creditorId: members[0]?.id ?? '', raw: '' }]); setDate(today); setStep('edit'); setCsvIn(''); setErr(null); } }, [open]); // eslint-disable-line
  const upd = (i: number, p: Partial<DraftClaim>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const valid = rows.filter((r) => r.debtorId && r.creditorId && r.debtorId !== r.creditorId && (parseEuro(r.raw) ?? 0) > 0);
  const claims = valid.map((r) => ({ debtorId: r.debtorId, creditorId: r.creditorId, amount: parseEuro(r.raw)! }));
  const net = new Map<string, number>();
  for (const c of claims) { net.set(c.creditorId, (net.get(c.creditorId) ?? 0) + c.amount); net.set(c.debtorId, (net.get(c.debtorId) ?? 0) - c.amount); }
  const parseCsv = () => {
    const byName = (n: string) => members.find((m) => m.name.toLowerCase() === n.trim().toLowerCase())?.id;
    const out: DraftClaim[] = [];
    const bad: number[] = [];
    csvIn.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const [d, c, a] = line.split(/[;,\t]/).map((x) => x.trim());
      const di = byName(d ?? ''), ci = byName(c ?? '');
      if (!di || !ci || parseEuro(a ?? '') === null) { bad.push(i + 1); return; }
      out.push({ debtorId: di, creditorId: ci, raw: a });
    });
    if (bad.length) setErr(`Zeile ${bad.join(', ')} nicht erkannt. Format: Schuldner;Gläubiger;Betrag – Namen wie in der App.`);
    else setErr(null);
    if (out.length) setRows(out);
  };
  const submit = () => {
    const r = tryRun(call('importOpening', claims, date), 'Anfangsbestand übernommen');
    if (r.ok) onClose(); else setErr(r.error);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Anfangsbestand aus Splitwise" wide
      footer={step === 'edit'
        ? <button className="btn primary block" type="button" disabled={!claims.length} onClick={() => { setErr(null); setStep('preview'); }}>Weiter zur Vorschau ({claims.length})</button>
        : <div className="row-actions"><button className="btn ghost" type="button" onClick={() => setStep('edit')}>Zurück</button><button className="btn primary" type="button" onClick={submit}>Verbindlich übernehmen</button></div>}>
      {step === 'edit' ? (
        <div className="form">
          <p className="sheet-lead">Übertrage den Stand aus Splitwise: Wer schuldet wem wie viel? Das geht nur einmal und wird als datierter Anfangsbestand gebucht.</p>
          <div className="claims">
            {rows.map((r, i) => (
              <div className="claim-row" key={i}>
                <select aria-label="Schuldner" id={`cl-d-${i}`} value={r.debtorId} onChange={(e) => upd(i, { debtorId: e.target.value })}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                <span className="claim-word">schuldet</span>
                <select aria-label="Gläubiger" id={`cl-c-${i}`} value={r.creditorId} onChange={(e) => upd(i, { creditorId: e.target.value })}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                <MoneyInput id={`cl-a-${i}`} value={r.raw} onChange={(v) => upd(i, { raw: v })} />
                <button className="icon-btn" type="button" aria-label="Zeile entfernen" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" size={18} /></button>
                {r.debtorId === r.creditorId && <span className="field-error">Zwei verschiedene Personen wählen.</span>}
              </div>
            ))}
          </div>
          <button className="btn small" type="button" onClick={() => setRows([...rows, { debtorId: members[1]?.id ?? '', creditorId: members[0]?.id ?? '', raw: '' }])}><Icon name="plus" size={16} /> Forderung</button>
          <details className="csv-import">
            <summary>Oder als CSV einfügen</summary>
            <textarea id="cl-csv" rows={4} value={csvIn} onChange={(e) => setCsvIn(e.target.value)} placeholder={'Markus;Daniel;23,50\nTobias;Stefan;12'} />
            <button className="btn small" type="button" onClick={parseCsv} disabled={!csvIn.trim()}>Übernehmen in Liste</button>
          </details>
          <Field label="Stichtag"><input id="cl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {err && <p className="form-error" role="alert">{err}</p>}
        </div>
      ) : (
        <div className="form">
          <p className="sheet-lead">Bitte prüfen. Nach der Übernahme ist nur noch eine Korrektur per Storno möglich.</p>
          <ul className="lines">{claims.map((c, i) => (
            <li key={i}><Avatar member={members.find((m) => m.id === c.debtorId)} size={28} /><div className="l-main"><strong>{memberName(state, c.debtorId)} → {memberName(state, c.creditorId)}</strong><span>Stichtag {fmtDate(date)}</span></div><Money cents={c.amount} className="l-amt" /></li>
          ))}</ul>
          <h4>Wirkung je Person</h4>
          <dl className="breakdown">{[...net].map(([id, v]) => <div key={id}><dt>{memberName(state, id)}</dt><dd><Money cents={v} signed tone /></dd></div>)}</dl>
          {err && <p className="form-error" role="alert">{err}</p>}
        </div>
      )}
    </Sheet>
  );
}

/** Splitwise-Gruppenbilanz übernehmen: Saldo je Person + „Vereinskasse schuldet“ = Topf. */
function BalancesSheet({ open, onClose, onPairs }: { open: boolean; onClose: () => void; onPairs: () => void }) {
  const { state, tryRun, today } = useStore();
  const members = activeMembers(state);
  const [rows, setRows] = useState<Record<string, { sign: 1 | -1; raw: string }>>({});
  const [potRaw, setPotRaw] = useState('');
  const [settled, setSettled] = useState<'auto' | 0 | 1>('auto');
  const [date, setDate] = useState(today);
  const [step, setStep] = useState<'edit' | 'preview'>('edit');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setRows(Object.fromEntries(members.map((m) => [m.id, { sign: 1 as const, raw: '' }])));
    setPotRaw(''); setSettled('auto'); setDate(today); setStep('edit'); setErr(null);
  }, [open]); // eslint-disable-line

  const pot = parseEuro(potRaw || '0') ?? NaN;
  const balances = members.map((m) => ({ memberId: m.id, amount: (rows[m.id]?.sign ?? 1) * (parseEuro(rows[m.id]?.raw || '0') ?? NaN) }));
  const invalid = Number.isNaN(pot) || pot < 0 || balances.some((b) => Number.isNaN(b.amount));
  const sum = invalid ? 0 : balances.reduce((a, b) => a + b.amount, 0);
  const settledVal: 0 | 1 = settled === 'auto' ? (pot >= 2 * PAYOUT_PER_MEETING ? 0 : 1) : settled;
  const info = cycleInfo(state);

  // Vorschau mit der echten Fachlogik rechnen
  let preview: { state: State } | { error: string } | null = null;
  if (!invalid) {
    try {
      preview = { state: A.importBalances(state, { actor: state.currentUserId, now: new Date() }, { balances, pot, settledInCycle: settledVal, date }) };
    } catch (e) { preview = { error: e instanceof Error ? e.message : 'Fehler' }; }
  }
  const after = preview && 'state' in preview ? standings(preview.state) : null;
  const share = members.length ? Math.round(pot / members.length) : 0;
  const ok = !!after && sum === pot;

  const submit = () => {
    const r = tryRun(call('importBalances', { balances, pot, settledInCycle: settledVal, date }), 'Stand aus Splitwise übernommen');
    if (r.ok) onClose(); else setErr(r.error);
  };
  const setRow = (id: string, p: Partial<{ sign: 1 | -1; raw: string }>) => setRows({ ...rows, [id]: { ...rows[id], ...p } });

  return (
    <Sheet open={open} onClose={onClose} title="Stand aus Splitwise" wide
      action={step === 'edit' ? { label: 'Weiter', onClick: () => { if (ok) { setErr(null); setStep('preview'); } }, disabled: !ok } : { label: 'Übernehmen', onClick: submit }}>
      {step === 'edit' ? (
        <div className="form">
          <p className="sheet-lead">Öffne in Splitwise die <b>Gruppenbilanz</b> und übertrage für jede Person, was sie „bekommt“ oder „schuldet“. Die <b>Vereinskasse</b> ist bei uns der Topf.</p>
          <p className="hint-box">In der App sind {members.length} Mitglieder: {members.map((m) => m.name).join(', ')}. Fehlt jemand aus Splitwise, bitte zuerst einladen – sonst stimmt die Aufteilung des Topfs nicht.</p>
          <div className="bal-list">
            {members.map((m) => (
              <div className="bal-row" key={m.id}>
                <span className="bal-name"><Avatar member={m} size={28} />{m.name}</span>
                <div className="bal-sign" role="group" aria-label={`${m.name}: bekommt oder schuldet`}>
                  <button type="button" className={rows[m.id]?.sign === 1 ? 'on pos' : ''} onClick={() => setRow(m.id, { sign: 1 })}>bekommt</button>
                  <button type="button" className={rows[m.id]?.sign === -1 ? 'on neg' : ''} onClick={() => setRow(m.id, { sign: -1 })}>schuldet</button>
                </div>
                <MoneyInput id={`bal-${m.id}`} value={rows[m.id]?.raw ?? ''} onChange={(v) => setRow(m.id, { raw: v.replace('-', '') })} />
              </div>
            ))}
            <div className="bal-row pot">
              <span className="bal-name"><Icon name="mug" size={22} />Vereinskasse schuldet</span>
              <span className="bal-sign-fixed">= Topf</span>
              <MoneyInput id="bal-pot" value={potRaw} onChange={(v) => setPotRaw(v.replace('-', ''))} />
            </div>
          </div>
          {pot > 0 && !Number.isNaN(pot) && (
            <Field label="Im laufenden Zyklus schon abgerechnet" hint={`Bei ${euro(pot)} im Topf ${settledVal === 1 ? 'ist schon ein Stammtisch abgerechnet: Nach dem nächsten wird wieder aufgefüllt.' : 'ist der Topf voll: Aufgefüllt wird nach zwei weiteren Stammtischen.'}`}>
              <select id="bal-settled" value={settled === 'auto' ? String(settledVal) : String(settled)} onChange={(e) => setSettled(Number(e.target.value) as 0 | 1)}>
                <option value="0">Noch kein Treffen (Topf voll)</option>
                <option value="1">Ein Treffen (Topf halb leer)</option>
              </select>
            </Field>
          )}
          <p className={`bal-check ${invalid ? 'bad' : sum === pot ? 'good' : 'bad'}`}>
            {invalid ? 'Bitte nur Beträge wie 21,58 eingeben.' : <>Personen zusammen: <b>{euroSigned(sum)}</b> · Vereinskasse: <b>{euro(Number.isNaN(pot) ? 0 : pot)}</b> {sum === pot ? '✓ passt' : '– muss gleich sein'}</>}
          </p>
          {preview && 'error' in preview && sum === pot && <p className="form-error">{preview.error}</p>}
          {info.cycleNo > 0 && info.totalSettled === 0 && pot > 0 && <p className="fineprint">Die bereits gestartete Kasse wird durch den übernommenen Topfstand ersetzt (per Gegenbuchung).</p>}
          <Field label="Stichtag"><input id="bal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <button className="link" type="button" onClick={onPairs}>Stattdessen einzelne Forderungen („A schuldet B“) eintragen</button>
        </div>
      ) : (
        <div className="form">
          <p className="sheet-lead">So sieht der Stand danach in Stammi aus. Bitte prüfen – übernommen wird nur einmal.</p>
          <div className="table-wrap">
            <table className="settle-table">
              <thead><tr><th>Person</th><th>Splitwise</th><th>Stammi</th></tr></thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.id}><td><span className="cell-person"><Avatar member={m} size={24} />{m.name}</span></td>
                    <td><Money cents={balances[i].amount} signed /></td>
                    <td><Money cents={after?.get(m.id) ?? 0} signed tone /></td></tr>
                ))}
                <tr><td><span className="cell-person"><Icon name="mug" size={20} />Topf</span></td><td><Money cents={-pot} signed /></td><td><Money cents={pot} /></td></tr>
              </tbody>
            </table>
          </div>
          {pot > 0 && <p className="hint-box">Splitwise führt die Kasse als eigene Person. Bei uns gehört der Topf allen gleich – jeder Stand enthält deshalb seinen Anteil (je ca. {euro(share)}) schon eingerechnet. Darum ist jeder Wert um diesen Anteil niedriger, die Summe bleibt 0.</p>}
          {err && <p className="form-error" role="alert">{err}</p>}
          <button className="btn ghost" type="button" onClick={() => setStep('edit')}>Zurück</button>
        </div>
      )}
    </Sheet>
  );
}

export function ExplainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="So wird gerechnet" wide>
      <div className="explain">
        <h4>Der Topf</h4>
        <p>Der Topf ist virtuell – niemand verwahrt Bargeld. Zum Start und nach jeweils zwei abgerechneten Stammtischen wird er mit 5 × 20 € = 100 € aufgefüllt. Dabei bekommt jedes Mitglied 20 € Beitrag angerechnet.</p>
        <p>Jeder abgerechnete Stammtisch verteilt genau 50 € aus dem Topf auf die tatsächlich Anwesenden: zu zweit je 25 €, zu dritt 16,67 €/16,67 €/16,66 €, zu viert je 12,50 €, zu fünft je 10 €. Abgesagte Treffen oder Treffen mit weniger als zwei Personen zählen nicht.</p>
        <h4>Auslagen</h4>
        <p>Wer zahlt, trägt den Betrag ein. Er wird nur auf die verteilt, die wirklich da waren. Beispiel: A und B sind da, A zahlt 40 € → beide tragen 20 €, A hat 20 € bei B gut. Dazu bekommen beide je 25 € aus dem Topf.</p>
        <h4>Dein Stand</h4>
        <p>Alles fließt in eine Zahl: Auslagen, Topfgutschriften, Beiträge, Ausgleichszahlungen, Anfangsbestand und Sonderbuchungen. Weil der Topf allen gemeinsam gehört, wird sein aktueller Bestand gleichmäßig auf alle aktiven Mitglieder zurückgerechnet. So ergibt die Summe aller Stände immer genau 0 – und der Stand zeigt, was du bei einem Ausgleich heute zahlen würdest oder bekämst.</p>
        <p>Wer oft dabei ist, bekommt mehr aus dem Topf als die 20 € Beitrag. Wer fehlt, zahlt seinen Beitrag trotzdem – das ist der Ausgleich für die, die die Runde tragen.</p>
        <h4>Korrekturen</h4>
        <p>Nichts wird überschrieben. Jede Korrektur ist eine sichtbare Gegenbuchung. Beträge werden centgenau gerechnet, Rest-Cents reihum verteilt.</p>
      </div>
    </Sheet>
  );
}
