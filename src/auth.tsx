// Anmeldung & Ersteinrichtung (nur im Supabase-Modus).
import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { State } from '@engine/types';
import { App } from './App';
import { configureMedia } from './media';
import { appUrl, fetchState, invoke, myGroupId, REMOTE, sb, type ActResponse } from './remote';
import { go, StoreProvider, useRoute } from './store';
import { Field, Icon, Sheet } from './ui';

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'recovery' }
  | { k: 'no-group'; session: Session }
  | { k: 'ready'; session: Session; groupId: string; state: State; version: number }
  | { k: 'error'; message: string };

/** Einstieg: ohne Supabase-Verbindung Vorschau-Modus, sonst Login → Gruppe laden → App. */
export function Root() {
  if (!REMOTE) return <StoreProvider><App /></StoreProvider>;
  return <AuthGate />;
}

function AuthGate() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const route = useRoute();

  useEffect(() => {
    const { data } = sb().auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    sb().auth.getSession().then(({ data: d }) => setSession(d.session));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (recovery) { setPhase({ k: 'recovery' }); return; }
    if (!session) { setPhase({ k: 'signed-out' }); return; }
    let alive = true;
    setPhase({ k: 'loading' });
    (async () => {
      try {
        const gid = await myGroupId(session.user.id);
        if (!alive) return;
        if (!gid) { setPhase({ k: 'no-group', session }); return; }
        const r = await fetchState(gid, session.user.id);
        configureMedia({ groupId: gid });
        if (alive) setPhase({ k: 'ready', session, groupId: gid, state: r.state, version: r.version });
      } catch (e) {
        if (alive) setPhase({ k: 'error', message: e instanceof Error ? e.message : 'Fehler beim Laden.' });
      }
    })();
    return () => { alive = false; };
  }, [session === undefined ? '?' : session?.user.id ?? '-', recovery, attempt]); // eslint-disable-line

  const signOut = async () => { await sb().auth.signOut(); go('uebersicht'); };

  if (phase.k === 'loading') return <Shell><div className="auth-loading"><span className="spinner" aria-hidden="true" /> Lädt …</div></Shell>;
  if (phase.k === 'recovery') return <NewPassword onDone={() => setRecovery(false)} />;
  if (phase.k === 'error') {
    return (
      <Shell title="Keine Verbindung">
        <p className="form-error">{phase.message}</p>
        <button className="btn primary block" type="button" onClick={() => setAttempt((a) => a + 1)}>Erneut versuchen</button>
        <button className="btn ghost block" type="button" onClick={signOut}>Abmelden</button>
      </Shell>
    );
  }
  if (phase.k === 'signed-out') return route.name === 'einladung' ? <JoinByInvite token={route.token} /> : <Login />;
  if (phase.k === 'no-group') return <Setup session={phase.session} onDone={() => setAttempt((a) => a + 1)} onSignOut={signOut} />;
  return (
    <StoreProvider key={phase.groupId} initial={phase.state}
      backend={{ kind: 'remote', groupId: phase.groupId, userId: phase.session.user.id, version: phase.version, signOut }}>
      <App />
    </StoreProvider>
  );
}

// ---------- Bausteine ----------
function Shell({ title, children, lead }: { title?: string; children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-brand"><span className="brand-mark" aria-hidden="true"><Icon name="mug" size={22} stroke={2} /></span><span>Stammi</span></div>
      <div className="invite-card">
        {title && <h1>{title}</h1>}
        {lead && <p className="sheet-lead">{lead}</p>}
        {children}
      </div>
    </div>
  );
}

function authMessage(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/email not confirmed/i.test(msg)) return 'Die E-Mail-Adresse ist noch nicht bestätigt.';
  if (/rate limit|too many/i.test(msg)) return 'Zu viele Versuche. Bitte kurz warten und dann noch einmal.';
  if (/password should be|weak/i.test(msg)) return 'Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen.';
  if (/fetch|network/i.test(msg)) return 'Keine Verbindung. Bist du online?';
  return msg;
}

function PasswordField({ id, value, onChange, label = 'Passwort', hint, autoComplete = 'current-password' }: {
  id: string; value: string; onChange: (v: string) => void; label?: string; hint?: string; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="pw-wrap">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
        <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Passwort verbergen' : 'Passwort anzeigen'}>{show ? 'Verbergen' : 'Zeigen'}</button>
      </div>
    </Field>
  );
}

// ---------- Anmelden / Passwort vergessen ----------
function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);

  const login = async () => {
    setBusy(true); setErr(null);
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr(authMessage(error.message));
  };
  const reset = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr('Bitte deine E-Mail-Adresse eingeben.'); return; }
    setBusy(true); setErr(null);
    const { error } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
    setBusy(false);
    if (error && !/rate/i.test(error.message)) { setErr(authMessage(error.message)); return; }
    setSent(true);
  };

  if (forgot) {
    return (
      <Shell title="Passwort vergessen" lead="Gib deine E-Mail-Adresse ein. Du bekommst einen Link, mit dem du ein neues Passwort festlegst.">
        {sent ? (
          <>
            <p className="hint-box">Wenn es für <b>{email.trim()}</b> ein Konto gibt, ist die E-Mail unterwegs. Schau auch im Spam-Ordner nach.</p>
            <button className="btn block" type="button" onClick={() => { setForgot(false); setSent(false); }}>Zurück zur Anmeldung</button>
          </>
        ) : (
          <form className="form" onSubmit={(e) => { e.preventDefault(); reset(); }}>
            <Field label="E-Mail"><input id="fg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
            {err && <p className="form-error" role="alert">{err}</p>}
            <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Sende …' : 'Link schicken'}</button>
            <button className="btn ghost block" type="button" onClick={() => { setForgot(false); setErr(null); }}>Abbrechen</button>
          </form>
        )}
      </Shell>
    );
  }

  return (
    <Shell title="Anmelden" lead="Melde dich mit E-Mail und Passwort an. Neu hier? Dann brauchst du einen Einladungslink vom Admin.">
      <form className="form" onSubmit={(e) => { e.preventDefault(); login(); }}>
        <Field label="E-Mail"><input id="li-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" /></Field>
        <PasswordField id="li-pw" value={pw} onChange={setPw} />
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary block" type="submit" disabled={busy || !email || !pw}>{busy ? 'Melde an …' : 'Anmelden'}</button>
        <button className="link" type="button" onClick={() => { setForgot(true); setErr(null); }}>Passwort vergessen?</button>
      </form>
    </Shell>
  );
}

// ---------- Neues Passwort (aus der E-Mail) ----------
function NewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (pw.length < 8) { setErr('Das Passwort braucht mindestens 8 Zeichen.'); return; }
    if (pw !== pw2) { setErr('Die beiden Passwörter sind nicht gleich.'); return; }
    setBusy(true); setErr(null);
    const { error } = await sb().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(authMessage(error.message)); return; }
    history.replaceState(null, '', appUrl() + '#uebersicht');
    onDone();
  };
  return (
    <Shell title="Neues Passwort" lead="Leg ein neues Passwort fest. Danach bist du angemeldet.">
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <PasswordField id="np-1" value={pw} onChange={setPw} label="Neues Passwort" hint="Mindestens 8 Zeichen" autoComplete="new-password" />
        <PasswordField id="np-2" value={pw2} onChange={setPw2} label="Noch einmal" autoComplete="new-password" />
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Speichere …' : 'Passwort speichern'}</button>
      </form>
    </Shell>
  );
}

/** Passwort ändern (aus „Gruppe & Profil“). */
export function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { if (open) { setPw(''); setPw2(''); setErr(null); setDone(false); } }, [open]);
  const submit = async () => {
    if (pw.length < 8) { setErr('Das Passwort braucht mindestens 8 Zeichen.'); return; }
    if (pw !== pw2) { setErr('Die beiden Passwörter sind nicht gleich.'); return; }
    const { error } = await sb().auth.updateUser({ password: pw });
    if (error) { setErr(authMessage(error.message)); return; }
    setDone(true);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Passwort ändern" action={done ? { label: 'Fertig', onClick: onClose } : { label: 'Sichern', onClick: submit }}>
      {done ? <p className="hint-box">Dein Passwort ist geändert.</p> : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <PasswordField id="cp-1" value={pw} onChange={setPw} label="Neues Passwort" hint="Mindestens 8 Zeichen" autoComplete="new-password" />
          <PasswordField id="cp-2" value={pw2} onChange={setPw2} label="Noch einmal" autoComplete="new-password" />
          {err && <p className="form-error" role="alert">{err}</p>}
        </form>
      )}
    </Sheet>
  );
}

// ---------- Beitritt per Einladungslink ----------
function JoinByInvite({ token }: { token: string }) {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^[a-f0-9]{64}$/.test(token);
  const submit = async () => {
    if (!f.name.trim()) { setErr('Bitte einen Anzeigenamen wählen.'); return; }
    if (f.password.length < 8) { setErr('Das Passwort braucht mindestens 8 Zeichen.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await invoke<{ ok: boolean; email: string }>('accept-invite', { token, ...f });
      const { error } = await sb().auth.signInWithPassword({ email: r.email, password: f.password });
      if (error) throw new Error(authMessage(error.message));
      history.replaceState(null, '', appUrl() + '#uebersicht');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Beitritt fehlgeschlagen.');
      setBusy(false);
    }
  };
  if (!valid) {
    return (
      <Shell title="Einladung ungültig">
        <p className="form-error">Dieser Link ist unvollständig. Bitte kopiere ihn noch einmal komplett oder frag den Admin nach einem neuen.</p>
        <a className="btn block" href="#uebersicht">Zur Anmeldung</a>
      </Shell>
    );
  }
  return (
    <Shell title="Willkommen in der Runde" lead="Du wurdest eingeladen. Leg dein Konto an – danach siehst du Termine, Kasse, Chronik und Ideen.">
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Anzeigename" hint="So sehen dich die anderen"><input id="ji-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={30} autoComplete="nickname" /></Field>
        <Field label="E-Mail" hint="Für die Anmeldung und „Passwort vergessen“"><input id="ji-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" inputMode="email" /></Field>
        <PasswordField id="ji-pw" value={f.password} onChange={(v) => setF({ ...f, password: v })} hint="Mindestens 8 Zeichen" autoComplete="new-password" />
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Lege Konto an …' : 'Konto anlegen und beitreten'}</button>
        <a className="link" href="#uebersicht">Ich habe schon ein Konto</a>
      </form>
    </Shell>
  );
}

// ---------- Ersteinrichtung ----------
function Setup({ session, onDone, onSignOut }: { session: Session; onDone: () => void; onSignOut: () => void }) {
  const [group, setGroup] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await invoke<ActResponse>('act', { action: 'createGroup', args: [group, name] });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Einrichten fehlgeschlagen.');
      setBusy(false);
    }
  };
  return (
    <Shell title="Noch keine Gruppe" lead={<>Angemeldet als <b>{session.user.email}</b>. Du gehörst noch zu keiner Gruppe. Zum Beitreten öffne den Einladungslink vom Admin.</>}>
      <details className="setup-box">
        <summary>Ich richte die Gruppe ein (allererster Start)</summary>
        <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label="Name der Runde"><input id="su-group" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="z. B. Stammtisch Kirchheim" maxLength={60} /></Field>
          <Field label="Dein Anzeigename"><input id="su-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="nickname" /></Field>
          <p className="fineprint">Du wirst Admin. Die Serie startet mit „jeden zweiten Montag, 19 Uhr“ – das kannst du danach im Kalender ändern.</p>
          {err && <p className="form-error" role="alert">{err}</p>}
          <button className="btn primary block" type="submit" disabled={busy || !group.trim() || !name.trim()}>{busy ? 'Richte ein …' : 'Gruppe einrichten'}</button>
        </form>
      </details>
      <button className="btn ghost block" type="button" onClick={onSignOut}>Abmelden</button>
    </Shell>
  );
}
