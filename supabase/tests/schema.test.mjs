// Prüft Schema, RLS und Journal-Regeln gegen echtes Postgres (PGlite, läuft ohne Supabase-Konto).
import { makeDb } from './pg-env.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const expectErr = async (sql, re, m) => { try { await db.exec(sql); ok(false, m + ' (kein Fehler!)'); } catch (e) { ok(re.test(e.message), m + ' → ' + e.message.split('\n')[0]); } };

const db = await makeDb();
console.log('Migrationen laufen durch.');

const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', U3 = '33333333-3333-3333-3333-333333333333';
await db.exec(`
  insert into auth.users values ('${U1}'), ('${U2}'), ('${U3}');
  insert into groups (id, name) values ('gA', 'Stammtisch A'), ('gB', 'Fremde Runde');
  insert into group_members (group_id, id, user_id, name, role, status) values
    ('gA', 'm1', '${U1}', 'Daniel', 'admin', 'active'), ('gA', 'm2', '${U2}', 'Markus', 'member', 'active'),
    ('gB', 'm9', '${U3}', 'Fremder', 'admin', 'active');
  insert into events (group_id, id, type, title, date, time, status, created_at, created_by) values
    ('gA', 't1', 'stammtisch', 'Stammtisch', '2026-10-26', '19:00', 'planned', now(), 'm1'),
    ('gB', 't9', 'stammtisch', 'Geheim', '2026-10-26', '19:00', 'planned', now(), 'm9');
  insert into invitations (group_id, id, token_hash, email, created_at, expires_at, created_by)
    values ('gA', 'e1', 'hash', 'neu@x.de', now(), now() + interval '7 days', 'm1');
  insert into storage.objects (bucket_id, name) values ('media', 'gA/t1/f1-full.jpg'), ('media', 'gB/t9/f9-full.jpg');
`);
const as = async (uid, role = 'authenticated') => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
const rows = async (sql) => (await db.query(sql)).rows;

console.log('\nRLS – Lesen');
await as(U2);
ok((await rows('select id from events')).map((r) => r.id).join() === 't1', 'Mitglied sieht nur Termine der eigenen Gruppe');
ok((await rows('select id from groups')).length === 1, 'Mitglied sieht nur die eigene Gruppe');
ok((await rows('select id from invitations')).length === 0, 'Normales Mitglied sieht keine Einladungen');
await expectErr('select token_hash from invitations', /permission denied/, 'Token-Hash ist nicht lesbar');
ok((await rows(`select name from storage.objects`)).map((r) => r.name).join() === 'gA/t1/f1-full.jpg', 'Fotos nur der eigenen Gruppe sichtbar');
await as(U1);
ok((await rows('select id from invitations')).length === 1, 'Admin sieht Einladungen');
await as(U3);
ok((await rows("select id from events where group_id = 'gA'")).length === 0, 'Fremde Gruppe sieht nichts von A');
await as(null, 'anon');
await expectErr('select * from events', /permission denied/, 'Ohne Login kein Zugriff');

console.log('\nRLS – Schreiben');
await as(U2);
await expectErr(`insert into events (group_id, id, type, title, date, status, created_at, created_by) values ('gA','tx','event','Hack','2026-11-01','planned',now(),'m2')`, /permission denied/, 'Kein direktes Anlegen von Terminen');
await expectErr(`update events set title = 'x'`, /permission denied/, 'Kein direktes Ändern');
await expectErr(`insert into ledger_entries (group_id,id,seq,kind,date,created_at,created_by,text) values ('gA','b1',1,'settlement','2026-10-01',now(),'m2','x')`, /permission denied/, 'Keine direkten Buchungen');
await expectErr(`update group_members set role = 'admin' where id = 'm2'`, /permission denied/, 'Sich selbst zum Admin machen geht nicht');
await expectErr(`insert into storage.objects (bucket_id, name) values ('media', 'gB/t9/evil.jpg')`, /row-level security/, 'Kein Upload in fremde Gruppe');
await db.exec(`insert into storage.objects (bucket_id, name) values ('media', 'gA/t1/f2-full.jpg')`); ok(true, 'Upload in eigene Gruppe erlaubt');

console.log('\nBuchungsjournal (als Server)');
await db.exec('reset role');
const book = (id, seq, kind, key, legs, rev = 'null') => `begin;
  insert into ledger_entries (group_id,id,seq,kind,date,created_at,created_by,key,reverses_id,text) values ('gA','${id}',${seq},'${kind}','2026-10-26',now(),'m1',${key ? `'${key}'` : 'null'},${rev},'t');
  ${legs.map(([a, c]) => `insert into ledger_legs values ('gA','${id}','${a}',${c});`).join('\n')}
  commit;`;
await db.exec(book('b1', 1, 'payout', 'payout:t1', [['pot', -5000], ['m1', 2500], ['m2', 2500]])); ok(true, 'Ausgeglichene Buchung wird angenommen');
await expectErr(book('b2', 2, 'settlement', null, [['m1', 100], ['m2', -50]]), /geht nicht auf/, 'Unausgeglichene Buchung wird abgelehnt');
await db.exec('rollback').catch(() => {});
await expectErr(book('b3', 3, 'payout', 'payout:t1', [['pot', -5000], ['m1', 5000]]), /Doppelte Buchung/, 'Doppelte Abrechnung desselben Termins verhindert');
await db.exec('rollback').catch(() => {});
await expectErr(`update ledger_entries set text = 'manipuliert' where id = 'b1'`, /unveränderlich/, 'Buchung kann nicht geändert werden');
await expectErr(`delete from ledger_legs where entry_id = 'b1'`, /unveränderlich/, 'Buchung kann nicht gelöscht werden');
await db.exec(book('r1', 4, 'reversal', null, [['pot', 5000], ['m1', -2500], ['m2', -2500]], "'b1'")); ok(true, 'Storno per Gegenbuchung möglich');
await expectErr(book('r2', 5, 'reversal', null, [['pot', 5000], ['m1', -5000]], "'b1'"), /duplicate key|unique/, 'Zweites Storno derselben Buchung verhindert');
await db.exec('rollback').catch(() => {});
await db.exec(book('b4', 6, 'payout', 'payout:t1', [['pot', -5000], ['m1', 2500], ['m2', 2500]])); ok(true, 'Nach Storno darf neu abgerechnet werden');
await expectErr(`insert into attendance values ('gA','t1','m2','yes',null,now()), ('gA','t1','m2','no',null,now())`, /duplicate key/, 'Doppelte Teilnahme verhindert');
await expectErr(`insert into events (group_id,id,type,title,date,end_date,status,created_at,created_by) values ('gA','t2','stammtisch','X','2026-11-01','2026-11-03','planned',now(),'m1')`, /check constraint/, 'Mehrtägiger Stammtisch abgelehnt');

console.log('\nFoto-Bewertungen & Kommentare');
await db.exec(`insert into media_assets values ('gA','f1','t1','m1',now(),10,10,100), ('gB','f9','t9','m9',now(),10,10,100);
  insert into media_votes values ('gA','f1','m2',1,now()), ('gB','f9','m9',-1,now());
  insert into media_comments values ('gA','c1','f1','m2','Super Foto',now(),now()), ('gB','c9','f9','m9','geheim',now(),now());
  update events set cover_media_id = 'f1' where id = 't1';`);
await as(U2);
ok((await rows('select media_id from media_votes')).map((r) => r.media_id).join() === 'f1', 'Bewertungen nur der eigenen Gruppe sichtbar');
ok((await rows('select id from media_comments')).map((r) => r.id).join() === 'c1', 'Foto-Kommentare nur der eigenen Gruppe sichtbar');
ok((await rows("select cover_media_id from events where id = 't1'"))[0]?.cover_media_id === 'f1', 'Titelbild am Termin lesbar');
const st = (await rows(`select group_state('gA') as s`))[0].s;
ok(st.media_votes.length === 1 && st.media_comments.length === 1, 'Gruppenzustand enthält Bewertungen und Kommentare');
await expectErr(`insert into media_votes values ('gA','f1','m1',1,now())`, /permission denied/, 'Keine direkten Bewertungen');
await expectErr(`insert into media_comments values ('gA','c2','f1','m2','x',now(),now())`, /permission denied/, 'Keine direkten Kommentare');
await db.exec('reset role');
await expectErr(`insert into media_comments values ('gA','c3','f1','m2','',now(),now())`, /check constraint/, 'Leerer Kommentar abgelehnt');
await db.exec(`delete from media_assets where group_id = 'gA' and id = 'f1'`);
ok((await rows(`select count(*)::int n from media_votes where group_id = 'gA'`))[0].n === 0 && (await rows(`select count(*)::int n from media_comments where group_id = 'gA'`))[0].n === 0, 'Foto gelöscht → Bewertungen und Kommentare weg');

console.log('\nKalender-Abo');
await as(U1);
await expectErr('select * from calendar_tokens', /permission denied/, 'Kalender-Links sind für App-Nutzer unsichtbar');
await expectErr(`insert into calendar_tokens (group_id, member_id, token_hash) values ('gA','m1','x')`, /permission denied/, 'Kalender-Links nicht direkt anlegbar');
await db.exec('reset role');

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
