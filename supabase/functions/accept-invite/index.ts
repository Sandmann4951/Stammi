// Edge Function `accept-invite`: Beitritt per Einladungslink (ohne Login).
// 1) Link und Eingaben prüfen  2) Konto anlegen (bestätigt)  3) Mitgliedschaft schreiben.
// Schlägt Schritt 3 fehl, wird das Konto wieder gelöscht.
import { adminFetch, CORS, errorResponse, inTransaction, json } from '../_shared/http.ts';
import { checkInvite, commitInvite, HttpError } from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Nur POST.' }, 405);
  let createdUserId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const { input, hash } = await inTransaction((db) => checkInvite(db, body));

    const r = await adminFetch('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true, user_metadata: { name: input.name.trim() } }),
    });
    const created = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(created?.msg ?? created?.message ?? created?.error_description ?? '');
      if (/already|registered|exists/i.test(msg)) throw new HttpError(409, 'Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an oder nutze „Passwort vergessen“.');
      if (/password/i.test(msg)) throw new HttpError(400, 'Das Passwort ist zu schwach. Bitte ein längeres wählen.');
      console.error('createUser', r.status, created);
      throw new HttpError(500, 'Das Konto konnte nicht angelegt werden. Bitte später noch einmal versuchen.');
    }
    createdUserId = created.id as string;

    await inTransaction((db) => commitInvite(db, hash, input, createdUserId!));
    return json({ ok: true, email: input.email });
  } catch (e) {
    if (createdUserId) await adminFetch(`/auth/v1/admin/users/${createdUserId}`, { method: 'DELETE' }).catch(() => {});
    return errorResponse(e);
  }
});
