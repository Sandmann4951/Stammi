// Edge Function `calendar`: Kalender-Abo (iCalendar) per geheimem Link – für iPhone, Google, Outlook.
// Kalender-Apps können sich nicht anmelden; der Link selbst ist der Schlüssel (nur als Hash gespeichert).
import { inTransaction } from '../_shared/http.ts';
import { handleCalendar } from '../_shared/server.ts';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://sandmann4951.github.io/Stammi/';

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Nur GET.', { status: 405 });
  try {
    const token = new URL(req.url).searchParams.get('t') ?? '';
    const ics = await inTransaction((db) => handleCalendar(db, token, APP_URL));
    if (!ics) return new Response('Dieser Kalender-Link ist ungültig oder wurde ersetzt.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(req.method === 'HEAD' ? null : ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="stammi.ics"',
        'Cache-Control': 'no-cache, max-age=0',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    console.error(e);
    return new Response('Der Kalender ist gerade nicht verfügbar.', { status: 503 });
  }
});
