-- Fotos: Bewertungen (Daumen hoch/runter), Kommentare und Titelbild je Termin.

-- Titelbild: Verweis auf ein Foto des Termins. Ohne Fremdschlüssel, weil Fotos selbst am Termin hängen
-- (Kreisbezug); die Fachlogik entfernt den Verweis, wenn das Foto gelöscht wird.
alter table public.events add column cover_media_id text;

create table public.media_comments (
  group_id   text not null,
  id         text not null,
  media_id   text not null,
  author_id  text not null,
  text       text not null check (length(text) between 1 and 1000),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (group_id, id),
  foreign key (group_id, media_id) references public.media_assets(group_id, id) on delete cascade
);

create table public.media_votes (
  group_id   text not null,
  media_id   text not null,
  member_id  text not null,
  value      smallint not null check (value in (-1, 1)),
  updated_at timestamptz not null,
  primary key (group_id, media_id, member_id),
  foreign key (group_id, media_id) references public.media_assets(group_id, id) on delete cascade
);

-- Wie alle Tabellen: lesen nur für Mitglieder der eigenen Gruppe, schreiben nur über die Edge Function.
do $$
declare t text;
begin
  foreach t in array array['media_comments','media_votes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy read_%1$s on public.%1$I for select to authenticated using (public.is_group_member(group_id))', t);
  end loop;
end $$;

-- Gruppenzustand um die neuen Tabellen erweitern
create or replace function public.group_state(gid text) returns jsonb
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
    'media_comments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.media_comments x where x.group_id = gid),
    'media_votes',    (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.media_votes x where x.group_id = gid),
    'idea_comments',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.idea_comments x where x.group_id = gid),
    'idea_votes',     (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.idea_votes x where x.group_id = gid),
    'ledger_entries', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ledger_entries x where x.group_id = gid),
    'ledger_legs',    (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ledger_legs x where x.group_id = gid)
  );
$$;
