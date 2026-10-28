import { useRef, useState } from 'react';
import * as A from '@engine/actions';
import { call } from '@engine/registry';
import { standings } from '@engine/finance';
import { euro } from '@engine/util';
import { go, useStore } from '../store';
import { Avatar, copyText, Field, fmtDateTime, Icon, Pill, Section, Sheet } from '../ui';
import { PasswordSheet } from '../auth';
import { ExplainSheet } from './Cash';
import { SeriesSheet, seriesText } from './Calendar';

export function More() {
  const { state, me, admin, run, replace, toast, resetDemo, resetEmpty, backend, invite: createInvite } = useStore();
  const remote = backend.kind === 'remote';
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState('');
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [series, setSeries] = useState(false);
  const [explain, setExplain] = useState(false);
  const [reset, setReset] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const st = standings(state);
  const now = new Date();

  const invite = async () => {
    setBusy(true);
    const r = await createInvite(email);
    setBusy(false);
    if (!r.ok) { setInviteErr(r.error); return; }
    setInviteErr(null); setEmail('');
    setLastLink(r.link);
    toast('Einladung erstellt');
  };

  return (
    <div className="page">
      <header className="page-head"><h1>Gruppe & Profil</h1></header>

      <Section title="Mein Profil">
        <div className="profile">
          <Avatar member={me} size={52} />
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(call('renameMember', me.id, name), 'Name gespeichert'); }}>
            <Field label="Anzeigename"><input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} /></Field>
            <button className="btn small" type="submit" disabled={name.trim() === me.name || !name.trim()}>Speichern</button>
          </form>
        </div>
        <p className="fineprint">{me.email || 'Keine E-Mail hinterlegt'} · {me.role === 'admin' ? 'Admin' : 'Mitglied'}</p>
        {remote && (
          <div className="row-actions wrap">
            <button className="btn small" type="button" onClick={() => setPwOpen(true)}>Passwort ändern</button>
            <button className="btn small ghost" type="button" onClick={() => backend.kind === 'remote' && backend.signOut()}>Abmelden</button>
          </div>
        )}
      </Section>

      <CalendarSubscribe />

      {!remote && <Section title="Vorschau: Ansicht als">
        <p className="muted-line">Hier gibt es noch keinen Login. Wechsle die Person, um zu sehen, was Mitglieder und Admin jeweils dürfen.</p>
        <div className="switcher">
          {state.members.filter((m) => m.status === 'active').map((m) => (
            <button key={m.id} type="button" className={m.id === me.id ? 'on' : ''} aria-pressed={m.id === me.id}
              onClick={() => { replace({ ...state, currentUserId: m.id }); setName(m.name); toast(`Du siehst die App jetzt als ${m.name}`); }}>
              <Avatar member={m} size={30} /><span>{m.name}</span>{m.role === 'admin' && <small>Admin</small>}
            </button>
          ))}
        </div>
      </Section>}

      <Section title={`Mitglieder · ${state.members.filter((m) => m.status === 'active').length}`}>
        <ul className="lines members">
          {state.members.slice().sort((a, b) => a.order - b.order).map((m) => (
            <li key={m.id} className={m.status === 'inactive' ? 'inactive' : ''}>
              <Avatar member={m} size={34} />
              <div className="l-main">
                <strong>{m.name} {m.role === 'admin' && <Pill tone="wine">Admin</Pill>} {m.status === 'inactive' && <Pill tone="muted">inaktiv</Pill>}</strong>
                <span>{m.email} · Stand {euro(st.get(m.id) ?? 0)}</span>
              </div>
              {admin && m.id !== me.id && (
                <select aria-label={`Rolle von ${m.name}`} value={m.status === 'inactive' ? 'inactive' : m.role}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'inactive') run(call('setMemberStatus', m.id, 'inactive'), `${m.name} deaktiviert`);
                    else {
                      if (m.status === 'inactive' && !run(call('setMemberStatus', m.id, 'active'))) return;
                      run(call('setMemberRole', m.id, v as 'admin'), 'Gespeichert');
                    }
                  }}>
                  <option value="member">Mitglied</option><option value="admin">Admin</option><option value="inactive">Inaktiv</option>
                </select>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {admin && (
        <Section title="Einladen">
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); invite(); }}>
            <Field label="E-Mail der Person" error={inviteErr}><input id="inv-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setInviteErr(null); }} placeholder="name@beispiel.de" autoComplete="off" /></Field>
            <button className="btn primary small" type="submit" disabled={busy}>{busy ? 'Erstelle …' : 'Link erstellen'}</button>
          </form>
          {lastLink && (
            <div className="invite-link">
              <p><strong>Persönlicher Link, 7 Tage gültig, nur einmal nutzbar.</strong> Schick ihn per WhatsApp oder Mail.</p>
              <div className="copy-row">
                <input id="inv-link" ref={linkRef} readOnly value={lastLink} onFocus={(e) => e.target.select()} />
                <button className="btn small" type="button" onClick={async () => toast((await copyText(lastLink, linkRef.current)) ? 'Link kopiert' : 'Link markiert – jetzt kopieren')}><Icon name="copy" size={16} /> Kopieren</button>
              </div>
              {!remote && <a className="link" href={lastLink.slice(lastLink.indexOf('#'))}>Vorschau: Einladung selbst öffnen</a>}
              {remote && <p className="fineprint">Der Link wird nur jetzt angezeigt. Geht er verloren, einfach einen neuen erstellen.</p>}
            </div>
          )}
          {state.invitations.length > 0 && (
            <ul className="lines invites">
              {state.invitations.slice(0, 8).map((i) => {
                const s = A.inviteState(i, now);
                return (
                  <li key={i.id}>
                    <Icon name="link" size={18} />
                    <div className="l-main"><strong>{i.email}</strong><span>{s === 'open' ? `gültig bis ${fmtDateTime(i.expiresAt)}` : s === 'used' ? `angenommen ${fmtDateTime(i.usedAt!)}` : s === 'revoked' ? 'zurückgezogen' : 'abgelaufen'}</span></div>
                    {s === 'open' && <button className="btn small ghost" type="button" onClick={() => run(call('revokeInvite', i.id), 'Einladung zurückgezogen')}>Zurückziehen</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      <Section title="Einstellungen">
        <div className="settings-list">
          {state.series && <button type="button" onClick={() => (admin ? setSeries(true) : toast('Die Serie ändert der Admin.', 'error'))}><Icon name="cal" /><span><strong>Terminserie</strong><small>{seriesText(state.series)}</small></span><Icon name="chev" size={18} /></button>}
          <button type="button" onClick={() => setExplain(true)}><Icon name="info" /><span><strong>So wird gerechnet</strong><small>Topf, Auslagen, Stand</small></span><Icon name="chev" size={18} /></button>
          <button type="button" onClick={() => go('kasse')}><Icon name="receipt" /><span><strong>Datenexport</strong><small>Alle Buchungen als CSV (Kasse → Buchungen)</small></span><Icon name="chev" size={18} /></button>
          {!remote && <button type="button" onClick={() => setReset(true)}><Icon name="trash" /><span><strong>Vorschau-Daten zurücksetzen</strong><small>Beispieldaten neu laden oder leer starten</small></span><Icon name="chev" size={18} /></button>}
        </div>
        <p className="fineprint">{remote ? 'Alle Mitglieder sehen denselben Stand. Änderungen anderer erscheinen automatisch.' : 'Vorschau-Version: Alle Daten liegen nur in diesem Browser.'}</p>
      </Section>

      <SeriesSheet open={series} onClose={() => setSeries(false)} />
      {remote && <PasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />}
      <ExplainSheet open={explain} onClose={() => setExplain(false)} />
      <Sheet open={reset} onClose={() => setReset(false)} title="Vorschau-Daten zurücksetzen">
        <p>Alles, was du in dieser Vorschau eingetragen hast, wird ersetzt.</p>
        <div className="stack">
          <button className="btn block" type="button" onClick={() => { resetDemo(); setReset(false); go('uebersicht'); }}>Beispieldaten laden</button>
          <button className="btn danger block" type="button" onClick={() => { resetEmpty(); setReset(false); go('uebersicht'); }}>Leer starten (nur ich als Admin)</button>
        </div>
      </Sheet>
    </div>
  );
}

export function InviteAccept({ token }: { token: string }) {
  const { state, replace, toast } = useStore();
  const inv = state.invitations.find((i) => i.token === token);
  const [f, setF] = useState({ name: '', email: inv?.email ?? '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const status = inv ? A.inviteState(inv, new Date()) : null;
  const submit = () => {
    try {
      const r = A.acceptInvite(state, new Date(), token, f);
      replace({ ...r.state, currentUserId: r.memberId });
      toast(`Willkommen in der Runde, ${f.name.trim()}!`);
      go('uebersicht');
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="page invite-page">
      <div className="invite-card">
        <span className="eyebrow">Einladung</span>
        <h1>{state.group.name}</h1>
        {!inv || status !== 'open' ? (
          <p className="form-error">{!inv ? 'Diesen Einladungslink gibt es nicht (mehr). Frag beim Admin nach einem neuen.' : status === 'used' ? 'Diese Einladung wurde schon verwendet.' : status === 'revoked' ? 'Diese Einladung wurde zurückgezogen.' : 'Diese Einladung ist abgelaufen. Bitte den Admin um einen neuen Link.'}</p>
        ) : (
          <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <p>Du wurdest eingeladen. Leg dein Konto an – danach siehst du Termine, Kasse und Ideen der Runde.</p>
            <Field label="Anzeigename" hint="So sehen dich die anderen"><input id="acc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={30} autoComplete="nickname" /></Field>
            <Field label="E-Mail"><input id="acc-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
            <Field label="Passwort" hint="Mindestens 8 Zeichen"><input id="acc-pw" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
            {err && <p className="form-error" role="alert">{err}</p>}
            <button className="btn primary block" type="submit">Konto anlegen und beitreten</button>
            <p className="fineprint">Vorschau: Das Passwort wird hier nicht gespeichert.</p>
          </form>
        )}
      </div>
    </div>
  );
}

function CalendarSubscribe() {
  const { backend, calendarLink, toast } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const create = async () => {
    setBusy(true); setErr(null); setConfirmNew(false);
    const r = await calendarLink();
    setBusy(false);
    if (r.ok) setUrl(r.url); else setErr(r.error);
  };
  const webcal = url?.replace(/^https?:/, 'webcal:');
  return (
    <Section title="Kalender-Abo" id="kalender-abo">
      <p className="muted-line">Alle Termine automatisch im iPhone-, Google- oder Outlook-Kalender – mit Ort, Änderungen und Absagen. Deine Zusage steht in der Beschreibung.</p>
      {backend.kind !== 'remote' ? (
        <p className="hint-box">In der Vorschau nicht verfügbar – in der echten App gibt es hier deinen persönlichen Abo-Link.</p>
      ) : !url ? (
        <>
          <button className="btn primary" type="button" onClick={create} disabled={busy}><Icon name="cal" size={18} /> {busy ? 'Erzeuge Link …' : 'Im Kalender abonnieren'}</button>
          <p className="fineprint">Hast du schon abonniert, brauchst du nichts zu tun. Ein neuer Link macht den alten ungültig.</p>
        </>
      ) : (
        <div className="cal-sub">
          <a className="btn primary block" href={webcal}><Icon name="cal" size={18} /> Zum iPhone-Kalender hinzufügen</a>
          <p className="fineprint">Öffnet „Kalenderabo hinzufügen“. Dort auf „Abonnieren“ und „Hinzufügen“ tippen.</p>
          <span className="field-label">Für Google, Outlook oder den Mac: Link kopieren</span>
          <div className="copy-row">
            <input id="cal-link" ref={ref} readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="btn small" type="button" onClick={async () => toast((await copyText(url, ref.current)) ? 'Link kopiert' : 'Link markiert – jetzt kopieren')}><Icon name="copy" size={16} /> Kopieren</button>
          </div>
          <p className="fineprint">Google Kalender (am Computer): Andere Kalender → + → Per URL. Der Link ist persönlich – bitte nicht weitergeben.</p>
        </div>
      )}
      {url && (confirmNew ? (
        <div className="row-actions wrap">
          <span className="fineprint">Der bisherige Link funktioniert danach nicht mehr.</span>
          <button className="btn small danger" type="button" onClick={create}>Neuen Link erzeugen</button>
          <button className="btn small ghost" type="button" onClick={() => setConfirmNew(false)}>Abbrechen</button>
        </div>
      ) : <button className="link" type="button" onClick={() => setConfirmNew(true)}>Neuen Link erzeugen (alten sperren)</button>)}
      {err && <p className="form-error" role="alert">{err}</p>}
    </Section>
  );
}
