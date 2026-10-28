import { endOf, localToday } from '@engine/util';
import { useStore, useRoute, type Route } from './store';
import { Avatar, Icon } from './ui';
import { Dashboard } from './views/Dashboard';
import { Calendar } from './views/Calendar';
import { EventDetail } from './views/EventDetail';
import { Cash } from './views/Cash';
import { IdeaDetail, Ideas } from './views/Ideas';
import { InviteAccept, More } from './views/More';

const TABS = [
  { hash: 'uebersicht', label: 'Übersicht', icon: 'home' },
  { hash: 'kalender', label: 'Kalender', icon: 'cal' },
  { hash: 'kasse', label: 'Kasse', icon: 'mug' },
  { hash: 'ideen', label: 'Ideen', icon: 'bulb' },
] as const;

function activeTab(r: Route) {
  if (r.name === 'termin') return 'kalender';
  if (r.name === 'idee') return 'ideen';
  return r.name;
}

function View({ r }: { r: Route }) {
  switch (r.name) {
    case 'kalender': return <Calendar />;
    case 'kasse': return <Cash />;
    case 'ideen': return <Ideas />;
    case 'mehr': return <More />;
    case 'termin': return <EventDetail id={r.id} />;
    case 'idee': return <IdeaDetail id={r.id} />;
    case 'einladung': return <InviteRoute token={r.token} />;
    default: return <Dashboard />;
  }
}

function InviteRoute({ token }: { token: string }) {
  const { backend, me } = useStore();
  if (backend.kind !== 'remote') return <InviteAccept token={token} />;
  return (
    <div className="page invite-page">
      <div className="invite-card">
        <span className="eyebrow">Einladung</span>
        <h1>Du bist schon dabei</h1>
        <p>Du bist bereits als <b>{me.name}</b> angemeldet. Den Einladungslink brauchst du nicht mehr.</p>
        <a className="btn primary block" href="#uebersicht">Zur Übersicht</a>
      </div>
    </div>
  );
}

export function App() {
  const { state, me, toasts, dismiss, syncing } = useStore();
  const route = useRoute();
  const tab = activeTab(route);
  const pending = state.events.filter((e) => e.status === 'planned' && endOf(e) < localToday()).length;

  return (
    <div className="app" lang="de">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#uebersicht">
            <span className="brand-mark" aria-hidden="true"><Icon name="mug" size={20} stroke={2} /></span>
            <span className="brand-text"><span className="brand-name">{state.group.name}</span><span className="brand-sub">seit {new Date(state.group.createdAt).getFullYear()}</span></span>
          </a>
          <nav className="topnav" aria-label="Hauptnavigation">
            {TABS.map((t) => (
              <a key={t.hash} href={`#${t.hash}`} className={tab === t.hash ? 'on' : ''} aria-current={tab === t.hash ? 'page' : undefined}>{t.label}</a>
            ))}
          </nav>
          {syncing && <span className="sync-dot" role="status" aria-label="Speichert">Speichert …</span>}
          <a className={`me-btn${tab === 'mehr' ? ' on' : ''}`} href="#mehr" aria-label={`Profil und Gruppe (${me.name})`}>
            <Avatar member={me} size={34} />
          </a>
        </div>
        <div className="rautenband" aria-hidden="true" />
      </header>

      <main className="main" id="main">
        <View r={route} />
      </main>

      <nav className="tabbar" aria-label="Hauptnavigation">
        {TABS.map((t) => (
          <a key={t.hash} href={`#${t.hash}`} className={tab === t.hash ? 'on' : ''} aria-current={tab === t.hash ? 'page' : undefined}>
            <span className="tb-icon"><Icon name={t.icon} size={23} />{t.hash === 'kalender' && pending > 0 && me.role === 'admin' && <i className="badge" aria-label={`${pending} offen`} />}</span>
            <span>{t.label}</span>
          </a>
        ))}
      </nav>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={t.kind === 'error' ? 'info' : 'check'} size={18} stroke={2.2} />
            <span>{t.text}</span>
            <button className="icon-btn" type="button" aria-label="Hinweis schließen" onClick={() => dismiss(t.id)}><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
