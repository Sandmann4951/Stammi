// Vollbild-Galerie eines Termins: wischen, bewerten, kommentieren, Titelbild wählen.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as A from '@engine/actions';
import { call } from '@engine/registry';
import type { MediaAsset, MediaComment, StEvent } from '@engine/types';
import { removeMediaBlobs, useMediaUrl } from '../media';
import { useStore } from '../store';
import { Avatar, fmtDateTime, Icon, memberName } from '../ui';

function Slide({ m, near }: { m: MediaAsset; near: boolean }) {
  const thumb = useMediaUrl(near ? m.id : 'none', 'thumb', m.eventId);
  const full = useMediaUrl(near ? m.id : 'none', 'full', m.eventId);
  const { state } = useStore();
  const src = full || thumb;
  return (
    <div className="gal-slide">
      {src ? <img src={src} alt={`Foto von ${memberName(state, m.uploaderId)}`} draggable={false} />
        : near && full === null && thumb === null ? <span className="gal-missing">Foto nicht verfügbar</span>
        : <span className="gal-loading" aria-label="Lädt" />}
    </div>
  );
}

function CommentItem({ c }: { c: MediaComment }) {
  const { state, me, admin, tryRun } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const author = state.members.find((m) => m.id === c.authorId);
  const save = () => { if (tryRun(call('updateMediaComment', c.id, text)).ok) setEditing(false); };
  return (
    <li className="gal-comment">
      <Avatar member={author} size={28} />
      <div>
        <div className="gc-head"><strong>{author?.name ?? 'Unbekannt'}</strong><span>{fmtDateTime(c.createdAt)}{c.updatedAt !== c.createdAt && ' · geändert'}</span></div>
        {editing ? (
          <form className="gc-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input id={`gc-edit-${c.id}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} autoFocus />
            <button className="btn small primary" type="submit" disabled={!text.trim()}>OK</button>
            <button className="btn small ghost" type="button" onClick={() => { setText(c.text); setEditing(false); }}>Abbrechen</button>
          </form>
        ) : <p>{c.text}</p>}
        {!editing && (c.authorId === me.id || admin) && (
          <div className="gc-actions">
            {c.authorId === me.id && <button className="link" type="button" onClick={() => setEditing(true)}>Bearbeiten</button>}
            <button className="link danger" type="button" onClick={() => tryRun(call('deleteMediaComment', c.id))}>Löschen</button>
          </div>
        )}
      </div>
    </li>
  );
}

function Comments({ m, onClose }: { m: MediaAsset; onClose: () => void }) {
  const { state, me, tryRun } = useStore();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const list = state.mediaComments.filter((c) => c.mediaId === m.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const voters = (v: 1 | -1) => state.mediaVotes.filter((x) => x.mediaId === m.id && x.value === v).map((x) => memberName(state, x.memberId));
  const up = voters(1), down = voters(-1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [list.length]);
  const send = () => {
    const r = tryRun(call('addMediaComment', m.id, text));
    if (r.ok) { setText(''); setErr(null); } else setErr(r.error);
  };
  return (
    <div className="gal-panel" role="dialog" aria-label="Kommentare zum Foto">
      <div className="gp-head">
        <strong>Kommentare{list.length ? ` (${list.length})` : ''}</strong>
        <button className="icon-btn" type="button" aria-label="Kommentare schließen" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <div className="gp-body">
        {(up.length > 0 || down.length > 0) && (
          <p className="gp-votes">
            {up.length > 0 && <span><Icon name="up" size={14} /> {up.join(', ')}</span>}
            {down.length > 0 && <span><Icon name="down" size={14} /> {down.join(', ')}</span>}
          </p>
        )}
        {list.length ? <ul className="gal-comments">{list.map((c) => <CommentItem key={c.id} c={c} />)}</ul>
          : <p className="gp-empty">Noch keine Kommentare. Schreib den ersten!</p>}
        <div ref={end} />
      </div>
      <form className="gp-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Avatar member={me} size={28} />
        <input id={`gc-new-${m.id}`} value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} placeholder="Kommentieren …" maxLength={1000} enterKeyHint="send" aria-label="Kommentar schreiben" />
        <button className="btn small primary" type="submit" disabled={!text.trim()}>Senden</button>
      </form>
      {err && <p className="form-error gp-err" role="alert">{err}</p>}
    </div>
  );
}

export function Gallery({ ev, photos, start, onClose }: { ev: StEvent; photos: MediaAsset[]; start: number; onClose: () => void }) {
  const { state, me, admin, run } = useStore();
  const track = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(Math.min(start, photos.length - 1));
  const [panel, setPanel] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const cur = photos[Math.min(idx, photos.length - 1)];

  // Startbild ohne Animation anspringen
  useLayoutEffect(() => {
    const t = track.current;
    if (t) t.scrollLeft = idx * t.clientWidth;
  }, []); // eslint-disable-line

  // Foto gelöscht → Index im gültigen Bereich halten, ohne Fotos schließen
  useEffect(() => {
    if (!photos.length) closeRef.current();
    else if (idx > photos.length - 1) setIdx(photos.length - 1);
  }, [photos.length, idx]);

  useEffect(() => { setConfirmDel(false); }, [cur?.id]);

  const goTo = (i: number) => {
    const t = track.current;
    if (!t) return;
    const n = Math.max(0, Math.min(photos.length - 1, i));
    t.scrollTo({ left: n * t.clientWidth, behavior: 'smooth' });
  };

  useEffect(() => {
    document.body.classList.add('noscroll', 'gallery-open');
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.('input, textarea')) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return; }
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'ArrowRight') goTo(Math.round((track.current?.scrollLeft ?? 0) / (track.current?.clientWidth || 1)) + 1);
      if (e.key === 'ArrowLeft') goTo(Math.round((track.current?.scrollLeft ?? 0) / (track.current?.clientWidth || 1)) - 1);
    };
    document.addEventListener('keydown', k);
    // Tastatur (Kommentar) → Galerie auf den sichtbaren Bereich verkleinern
    const vv = window.visualViewport;
    const fit = () => {
      const el = root.current;
      if (!el || !vv) return;
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
    };
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    fit();
    // Drehen/Größe ändern: aktuelles Bild bleibt stehen
    const onResize = () => { const t = track.current; if (t) t.scrollLeft = Math.round(t.scrollLeft / (t.clientWidth || 1)) * t.clientWidth; };
    window.addEventListener('resize', onResize);
    return () => {
      document.body.classList.remove('noscroll', 'gallery-open');
      document.removeEventListener('keydown', k);
      vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', onResize);
      prev?.focus?.({ preventScroll: true });
    };
  }, []); // eslint-disable-line

  const onScroll = () => {
    const t = track.current;
    if (!t) return;
    const i = Math.round(t.scrollLeft / (t.clientWidth || 1));
    if (i !== idx && i >= 0 && i < photos.length) setIdx(i);
  };

  if (!cur) return null;
  const score = A.mediaScore(state, cur.id);
  const mine = state.mediaVotes.find((v) => v.mediaId === cur.id && v.memberId === me.id)?.value;
  const comments = state.mediaComments.filter((c) => c.mediaId === cur.id).length;
  const isCover = ev.coverMediaId === cur.id;
  const autoCover = !ev.coverMediaId && A.coverOf(state, ev.id)?.id === cur.id;
  const canDelete = admin || cur.uploaderId === me.id;
  const vote = (v: 1 | -1) => run(call('voteMedia', cur.id, v));
  const toggleCover = () => run(call('setEventCover', ev.id, isCover ? null : cur.id));
  const del = () => {
    if (run(call('deleteMedia', cur.id), 'Foto gelöscht')) removeMediaBlobs(cur.id);
    setConfirmDel(false);
  };

  return createPortal(
    <div className="gallery" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Fotos: ${ev.title}`}>
      <div className="gal-top">
        <button className="gal-btn" type="button" aria-label="Galerie schließen" onClick={onClose}><Icon name="x" size={22} /></button>
        <div className="gal-info">
          <strong>{idx + 1} / {photos.length}</strong>
          <span>{memberName(state, cur.uploaderId)} · {fmtDateTime(cur.createdAt)}</span>
        </div>
        {canDelete && (confirmDel ? (
          <span className="gal-confirm">
            <button className="btn small danger" type="button" onClick={del}>Löschen</button>
            <button className="btn small ghost" type="button" onClick={() => setConfirmDel(false)}>Nein</button>
          </span>
        ) : <button className="gal-btn" type="button" aria-label="Foto löschen" onClick={() => setConfirmDel(true)}><Icon name="trash" size={20} /></button>)}
      </div>

      <div className="gal-stage">
        <div className="gal-track" ref={track} onScroll={onScroll}>
          {photos.map((m, i) => <Slide key={m.id} m={m} near={Math.abs(i - idx) <= 1} />)}
        </div>
        {idx > 0 && <button className="gal-nav prev" type="button" aria-label="Vorheriges Foto" onClick={() => goTo(idx - 1)}><Icon name="left" size={26} /></button>}
        {idx < photos.length - 1 && <button className="gal-nav next" type="button" aria-label="Nächstes Foto" onClick={() => goTo(idx + 1)}><Icon name="right" size={26} /></button>}
      </div>

      <div className="gal-bar">
        <button type="button" className={`gal-act${mine === 1 ? ' on up' : ''}`} aria-pressed={mine === 1} aria-label={`Gefällt mir, ${score.up}`} onClick={() => vote(1)}>
          <Icon name="up" size={22} /><span>{score.up || ''}</span>
        </button>
        <button type="button" className={`gal-act${mine === -1 ? ' on down' : ''}`} aria-pressed={mine === -1} aria-label={`Gefällt mir nicht, ${score.down}`} onClick={() => vote(-1)}>
          <Icon name="down" size={22} /><span>{score.down || ''}</span>
        </button>
        <button type="button" className={`gal-act${panel ? ' on' : ''}`} aria-expanded={panel} aria-label={`Kommentare, ${comments}`} onClick={() => setPanel((p) => !p)}>
          <Icon name="chat" size={22} /><span>{comments || ''}</span>
        </button>
        <button type="button" className={`gal-act cover${isCover ? ' on' : ''}`} aria-pressed={isCover} onClick={() => { toggleCover(); }}
          title={autoCover ? 'Wird gerade automatisch als Titelbild verwendet' : undefined}>
          <Icon name="star" size={22} /><span>{isCover ? 'Titelbild' : autoCover ? 'Titelbild (auto)' : 'Als Titelbild'}</span>
        </button>
      </div>

      {panel && <Comments m={cur} onClose={() => setPanel(false)} />}
      {photos.length > 1 && !panel && (
        <div className="gal-dots" aria-hidden="true">
          {photos.length <= 15 ? photos.map((m, i) => <i key={m.id} className={i === idx ? 'on' : ''} />) : null}
        </div>
      )}
      <span className="sr-only" aria-live="polite">{`Foto ${idx + 1} von ${photos.length}`}</span>
    </div>,
    document.body,
  );
}
