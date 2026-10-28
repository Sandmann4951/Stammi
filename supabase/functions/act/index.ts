// Edge Function `act`: einziger Schreibweg der App.
// Login prüfen → Gruppe sperren → Aktion mit der gemeinsamen Fachlogik ausführen → Unterschied schreiben.
import { adminFetch, CORS, errorResponse, getUser, inTransaction, json } from '../_shared/http.ts';
import { handleAct } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Nur POST.' }, 405);
  try {
    const user = await getUser(req);
    if (!user) return json({ error: 'Bitte neu anmelden.' }, 401);
    const body = await req.json().catch(() => ({}));
    const result = await inTransaction((db) => handleAct(db, user, body));
    // Gelöschte Fotos auch aus dem Speicher entfernen (nach erfolgreichem Commit)
    if (result.removedMedia.length) {
      const prefixes = result.removedMedia.flatMap((p) => [`${p}-full.jpg`, `${p}-thumb.jpg`]);
      await adminFetch('/storage/v1/object/media', { method: 'DELETE', body: JSON.stringify({ prefixes }) }).catch((e) => console.error('Storage', e));
    }
    return json({ state: result.state, version: result.version, token: result.token });
  } catch (e) {
    return errorResponse(e);
  }
});
