import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as A from '@engine/actions';
import { applyCall, stateOf, type ActionName, type ActionResult, type Call } from '@engine/registry';
import { DomainError, type Member, type State, type StEvent } from '@engine/types';
import { localToday, recordIds } from '@engine/util';
import { fetchState, invoke, sendCall, watchGroup, type ActResponse } from './remote';
import { demoState, emptyState } from './seed';

// ---------- Persistenz (Vorschau: nur in diesem Browser) ----------
const KEY = 'stammtisch-vorschau-v1';

/** Hebt ältere Vorschau-Stände auf das aktuelle Schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(s: any): State | null {
  if (!s || !Array.isArray(s.ledger) || !Array.isArray(s.events)) return null;
  if (s.schema === 1) {
    const today = localToday();
    s.ideaComments = [];
    s.ideaVotes = [];
    if (s.series) delete s.series.location;
    // Künftige Serientermine hatten den festen Serienort geerbt → wieder offen
    s.events = s.events.map((e: StEvent) => (e.originalSeriesDate && e.status === 'planned' && !e.detached && e.date > today ? { ...e, location: '' } : e));
    s.schema = 2;
  }
  return s.schema === 2 ? (s as State) : null;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = migrate(JSON.parse(raw));
      if (s) return A.ensureSeries(s, new Date());
    }
  } catch { /* Speicher nicht verfügbar → Demo */ }
  return demoState();
}
function save(s: State) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignorieren */ }
}

// ---------- Toasts ----------
export interface Toast { id: number; text: string; kind: 'ok' | 'error'; action?: { label: string; run: () => void } }

type TryResult<K extends ActionName> = { ok: true; value: ActionResult<K> } | { ok: false; error: string };

/** Woher die Daten kommen: Vorschau (nur dieser Browser) oder Supabase. */
export type Backend = { kind: 'preview' } | { kind: 'remote'; groupId: string; userId: string; version: number; signOut: () => Promise<void> };

interface Store {
  state: State;
  me: Member;
  admin: boolean;
  today: string;
  backend: Backend;
  /** Seit dem letzten Server-Stand noch nicht bestätigte Änderungen. */
  syncing: boolean;
  /** Führt eine Aktion aus (sofort sichtbar; online zusätzlich beim Server). Ergebnis oder null bei fachlichem Fehler (Toast). */
  run: <K extends ActionName>(c: Call<K>, okText?: string) => ActionResult<K> | null;
  /** Wie run, aber liefert den Fehlertext zurück statt Toast – für Formulare mit Inline-Fehlern. */
  tryRun: <K extends ActionName>(c: Call<K>, okText?: string) => TryResult<K>;
  /** Einladung erzeugen. Online erzeugt der Server den Link. */
  invite: (email: string) => Promise<{ ok: true; link: string } | { ok: false; error: string }>;
  /** Nur Vorschau: ganzen Zustand ersetzen (Personenwechsel, Zurücksetzen). */
  replace: (s: State, text?: string) => void;
  reload: () => Promise<void>;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  dismiss: (id: number) => void;
  resetDemo: () => void;
  resetEmpty: () => void;
}

const Ctx = createContext<Store | null>(null);

export function inviteLink(token: string) {
  return `${location.origin}${location.pathname}#einladung-${token}`;
}

export function StoreProvider({ children, backend: initialBackend, initial }: { children: ReactNode; backend?: Backend; initial?: State }) {
  const [backend, setBackend] = useState<Backend>(initialBackend ?? { kind: 'preview' });
  const [state, setState] = useState<State>(() => initial ?? load());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState(0);
  const ref = useRef(state);
  ref.current = state;
  const backendRef = useRef(backend);
  backendRef.current = backend;
  const tid = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const remote = backend.kind === 'remote';

  useEffect(() => { if (!remote) save(state); }, [state, remote]);
  // Serie bei Tageswechsel/Rückkehr fortschreiben (online nur zur Anzeige – der Server legt sie beim nächsten Schreiben an)
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'visible') setState((s) => A.ensureSeries(s, new Date())); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : action ? 6000 : 3200);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const applyServer = useCallback((s: State, version: number) => {
    const b = backendRef.current;
    if (b.kind !== 'remote') return;
    if (version < b.version) return;
    setBackend({ ...b, version });
    const shown = A.ensureSeries(s, new Date());
    ref.current = shown;
    setState(shown);
  }, []);

  const reload = useCallback(async () => {
    const b = backendRef.current;
    if (b.kind !== 'remote') return;
    try {
      const r = await fetchState(b.groupId, b.userId);
      applyServer(r.state, r.version);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Neu laden fehlgeschlagen.', 'error');
    }
  }, [applyServer, toast]);

  // Live: andere haben etwas geändert → neu laden (wenn wir nicht gerade selbst senden)
  useEffect(() => {
    if (backend.kind !== 'remote') return;
    return watchGroup(backend.groupId, (v) => {
      const b = backendRef.current;
      if (b.kind === 'remote' && v > b.version && pendingRef.current === 0) reload();
    });
  }, [backend.kind === 'remote' ? backend.groupId : '', reload]); // eslint-disable-line

  const tryRun = useCallback(<K extends ActionName>(c: Call<K>, okText?: string): TryResult<K> => {
    const prev = ref.current;
    try {
      const { result, ids } = recordIds(() => applyCall(prev, { actor: prev.currentUserId, now: new Date() }, c));
      const next = stateOf(result);
      ref.current = next;
      setState(next);
      if (okText) toast(okText);
      if (backendRef.current.kind === 'remote') {
        pendingRef.current++;
        setPending(pendingRef.current);
        queue.current = queue.current.then(async () => {
          try {
            const r = await sendCall(c, ids);
            // Nur übernehmen, wenn keine weitere eigene Änderung mehr unterwegs ist
            if (pendingRef.current === 1) applyServer(r.state, r.version);
          } catch (e) {
            toast(`Nicht gespeichert: ${e instanceof Error ? e.message : 'Fehler'}`, 'error');
            await reload();
          } finally {
            pendingRef.current--;
            setPending(pendingRef.current);
          }
        });
      }
      return { ok: true, value: result as ActionResult<K> };
    } catch (e) {
      if (e instanceof DomainError) return { ok: false, error: e.message };
      console.error(e);
      return { ok: false, error: 'Unerwarteter Fehler. Bitte noch einmal versuchen.' };
    }
  }, [toast, applyServer, reload]);

  const run = useCallback(<K extends ActionName>(c: Call<K>, okText?: string) => {
    const r = tryRun(c, okText);
    if (r.ok) return r.value;
    toast(r.error, 'error');
    return null;
  }, [tryRun, toast]);

  const invite = useCallback(async (email: string) => {
    const b = backendRef.current;
    if (b.kind === 'remote') {
      try {
        await queue.current;
        const r = await invoke<ActResponse>('act', { action: 'inviteMember', args: [email] });
        applyServer(r.state, r.version);
        return { ok: true as const, link: inviteLink(r.token!) };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : 'Fehler' };
      }
    }
    try {
      const prev = ref.current;
      const r = A.inviteMember(prev, { actor: prev.currentUserId, now: new Date() }, email);
      ref.current = r.state;
      setState(r.state);
      return { ok: true as const, link: inviteLink(r.token) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Fehler' };
    }
  }, [applyServer]);

  const replace = useCallback((s: State, text?: string) => { ref.current = s; setState(s); if (text) toast(text); }, [toast]);

  const value = useMemo<Store>(() => {
    const me = state.members.find((m) => m.id === state.currentUserId) ?? state.members[0];
    return {
      state, me, admin: A.isAdmin(state, me.id), today: localToday(), backend, syncing: pending > 0,
      run, tryRun, invite, replace, reload, toasts, toast, dismiss,
      resetDemo: () => replace(demoState(), 'Beispieldaten geladen'),
      resetEmpty: () => replace(emptyState(), 'Leere Gruppe angelegt'),
    };
  }, [state, backend, pending, run, tryRun, invite, replace, reload, toasts, toast, dismiss]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider fehlt');
  return s;
}

// ---------- Routing über den Hash (#kalender, #termin-<id> …) ----------
export type Route =
  | { name: 'uebersicht' } | { name: 'kalender' } | { name: 'kasse' } | { name: 'ideen' } | { name: 'mehr' }
  | { name: 'termin'; id: string } | { name: 'idee'; id: string } | { name: 'einladung'; token: string };

export function parseHash(h: string): Route {
  const x = h.replace(/^#/, '');
  if (x.startsWith('termin-')) return { name: 'termin', id: x.slice(7) };
  if (x.startsWith('idee-')) return { name: 'idee', id: x.slice(5) };
  if (x.startsWith('einladung-')) return { name: 'einladung', token: x.slice(10) };
  if (['kalender', 'kasse', 'ideen', 'mehr'].includes(x)) return { name: x } as Route;
  return { name: 'uebersicht' };
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const h = () => { setR(parseHash(location.hash)); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

export function go(hash: string) {
  if (location.hash === '#' + hash) return;
  location.hash = hash;
}
