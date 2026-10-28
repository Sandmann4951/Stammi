// Fotos: Komprimierung im Browser + Ablage. In der Vorschau in IndexedDB,
// online in einem privaten Supabase-Storage-Bucket mit signierten URLs.
import { useEffect, useState } from 'react';
import { uid } from '@engine/util';
import { sb } from './remote';

// Online: Fotos liegen im privaten Bucket `media` unter <gruppe>/<termin>/<id>-full|thumb.jpg
let remoteCfg: { groupId: string } | null = null;
export function configureMedia(cfg: { groupId: string } | null) { remoteCfg = cfg; }
const storagePath = (eventId: string, id: string, size: 'full' | 'thumb') => `${remoteCfg!.groupId}/${eventId}/${id}-${size}.jpg`;

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const FULL_EDGE = 1600;
const THUMB_EDGE = 480;

const DB = 'stammtisch-medien';
const STORE = 'bilder';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function put(key: string, blob: Blob) {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function get(key: string): Promise<Blob | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result as Blob | undefined);
    r.onerror = () => rej(r.error);
  });
}
export async function removeMediaBlobs(id: string) {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id + ':full');
    tx.objectStore(STORE).delete(id + ':thumb');
  } catch { /* egal */ }
}

async function resize(bmp: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', quality));
}

export class UploadError extends Error {}

export async function processPhoto(file: File, eventId: string): Promise<{ id: string; width: number; height: number; bytes: number }> {
  if (file.type && !file.type.startsWith('image/')) throw new UploadError(`„${file.name}“ ist kein Foto. Videos sind in dieser Version deaktiviert.`);
  if (file.size > MAX_INPUT_BYTES) throw new UploadError(`„${file.name}“ ist größer als 20 MB.`);
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); }
  catch { throw new UploadError(`„${file.name}“ konnte nicht gelesen werden. Bitte als JPEG oder PNG speichern.`); }
  const full = await resize(bmp, FULL_EDGE, 0.82);
  const thumb = await resize(bmp, THUMB_EDGE, 0.75);
  const id = uid('f');
  if (remoteCfg) {
    for (const [size, blob] of [['full', full], ['thumb', thumb]] as const) {
      const { error } = await sb().storage.from('media').upload(storagePath(eventId, id, size), blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw new UploadError(`„${file.name}“ konnte nicht hochgeladen werden. Bist du online?`);
    }
  } else {
    try {
      await put(id + ':full', full);
      await put(id + ':thumb', thumb);
    } catch {
      throw new UploadError('Der Browser erlaubt hier keinen Fotospeicher (z. B. privates Fenster).');
    }
  }
  const scale = Math.min(1, FULL_EDGE / Math.max(bmp.width, bmp.height));
  return { id, width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale), bytes: full.size };
}

const cache = new Map<string, string>();
export function useMediaUrl(id: string, size: 'thumb' | 'full', eventId = ''): string | null | undefined {
  const key = id + ':' + size;
  const [url, setUrl] = useState<string | null | undefined>(cache.get(key));
  useEffect(() => {
    if (cache.has(key)) { setUrl(cache.get(key)); return; }
    let alive = true;
    if (remoteCfg) {
      if (id === 'none') { setUrl(null); return; }
      // Signierte Links gelten 1 Stunde – genug für eine Sitzung, danach neu
      sb().storage.from('media').createSignedUrl(storagePath(eventId, id, size), 3600).then(({ data }) => {
        if (!alive) return;
        if (data?.signedUrl) { cache.set(key, data.signedUrl); setTimeout(() => cache.delete(key), 50 * 60 * 1000); }
        setUrl(data?.signedUrl ?? null);
      });
      return () => { alive = false; };
    }
    get(key).then((b) => {
      if (!alive) return;
      if (!b) { setUrl(null); return; }
      const u = URL.createObjectURL(b);
      cache.set(key, u);
      setUrl(u);
    }).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [key, eventId]);
  return url;
}
