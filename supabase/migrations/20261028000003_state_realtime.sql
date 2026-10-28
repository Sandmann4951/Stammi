-- Gesamter Gruppenzustand in einem Aufruf (für die App). Läuft mit den Rechten des Aufrufers:
-- RLS greift, Token-Hashes von Einladungen werden nie ausgeliefert.
create function public.group_state(gid text) returns jsonb
  language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'groups',         (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.groups x where x.id = gid),
    'group_members',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_members x where x.group_id = gid),
    'invitations',    (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
                         select group_id, id, email, created_at, expires_at, created_by, used_at, used_by, revoked_at
                           from public.invitations where group_id = gid) x),
    'events',         (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.events x where x.group_id = gid),
    'ideas',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ideas x where x.group_id = gid),
    'attendance',     (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.attendance x where x.group_id = gid),
    'expenses',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.expenses x where x.group_id = gid),
    'notes',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.notes x where x.group_id = gid),
    'media_assets',   (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.media_assets x where x.group_id = gid),
    'idea_comments',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.idea_comments x where x.group_id = gid),
    'idea_votes',     (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.idea_votes x where x.group_id = gid),
    'ledger_entries', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ledger_entries x where x.group_id = gid),
    'ledger_legs',    (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ledger_legs x where x.group_id = gid)
  );
$$;
revoke all on function public.group_state(text) from public, anon;
grant execute on function public.group_state(text) to authenticated;

-- Änderungen live an alle Mitglieder melden: Die App beobachtet groups.state_version.
alter publication supabase_realtime add table public.groups;
