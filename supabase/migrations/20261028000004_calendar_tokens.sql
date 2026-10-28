-- Kalender-Abo: ein geheimer Link pro Mitglied. Gespeichert wird nur der SHA-256-Hash.
-- Nur die Server-Funktionen lesen/schreiben diese Tabelle – für App-Nutzer unsichtbar.
create table public.calendar_tokens (
  group_id   text not null,
  member_id  text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  primary key (group_id, member_id),
  foreign key (group_id, member_id) references public.group_members(group_id, id) on delete cascade
);
alter table public.calendar_tokens enable row level security;
revoke all on public.calendar_tokens from anon, authenticated;
