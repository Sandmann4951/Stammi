import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as A from './engine/actions';
import { DomainError, type Member, type State, type StEvent } from './engine/types';
import { localToday } from './engine/util';
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

type Result = State | { state: State };
interface Store {
  state: State;
  me: Member;
  admin: boolean;
  today: string;
  /** Führt eine Aktion aus. Liefert das Ergebnis oder null bei fachlichem Fehler (wird als Toast gezeigt). */
  run: <R extends Result>(fn: (s: State, ctx: A.Ctx) => R, okText?: string) => R | null;
  /** Wie run, aber wirft den Fehlertext zurück statt Toast – für Formulare mit Inline-Fehlern. */
  tryRun: <R extends Result>(fn: (s: State, ctx: A.Ctx) => R, okText?: string) => { ok: true; value: R } | { ok: false; error: string };
  replace: (s: State, text?: string) => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  dismiss: (id: number) => void;
  resetDemo: () => void;
  resetEmpty: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ref = useRef(state);
  ref.current = state;
  const tid = useRef(0);

  useEffect(() => { save(state); }, [state]);
  // Serie bei Tageswechsel/Rückkehr fortschreiben
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'visible') setState((s) => A.ensureSeries(s, new Date())); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : action ? 6000 : 3200);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const tryRun = useCallback(<R extends Result>(fn: (s: State, ctx: A.Ctx) => R, okText?: string) => {
    const prev = ref.current;
    try {
      const r = fn(prev, { actor: prev.currentUserId, now: new Date() });
      const next = 'state' in r && !('ledger' in r) ? (r as { state: State }).state : (r as State);
      ref.current = next;
      setState(next);
      if (okText) toast(okText);
      return { ok: true as const, value: r };
    } catch (e) {
      if (e instanceof DomainError) return { ok: false as const, error: e.message };
      console.error(e);
      return { ok: false as const, error: 'Unerwarteter Fehler. Bitte noch einmal versuchen.' };
    }
  }, [toast]);

  const run = useCallback(<R extends Result>(fn: (s: State, ctx: A.Ctx) => R, okText?: string) => {
    const r = tryRun(fn, okText);
    if (r.ok) return r.value;
    toast(r.error, 'error');
    return null;
  }, [tryRun, toast]);

  const replace = useCallback((s: State, text?: string) => { ref.current = s; setState(s); if (text) toast(text); }, [toast]);

  const value = useMemo<Store>(() => {
    const me = state.members.find((m) => m.id === state.currentUserId) ?? state.members[0];
    return {
      state, me, admin: A.isAdmin(state, me.id), today: localToday(), run, tryRun, replace, toasts, toast, dismiss,
      resetDemo: () => replace(demoState(), 'Beispieldaten geladen'),
      resetEmpty: () => replace(emptyState(), 'Leere Gruppe angelegt'),
    };
  }, [state, run, tryRun, replace, toasts, toast, dismiss]);

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
