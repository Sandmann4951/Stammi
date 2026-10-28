-- Stammtisch-App · Schema, Integritätsregeln und Row Level Security
-- ------------------------------------------------------------------
-- Grundsatz:
--   * LESEN: Mitglieder lesen direkt aus den Tabellen – RLS lässt nur Zeilen der eigenen Gruppe durch.
--   * SCHREIBEN: ausschließlich über die Edge Function `act` (Service-Verbindung, eine Transaktion
--     je Aktion, Gruppe per FOR UPDATE gesperrt). Für anon/authenticated gibt es keine Schreibrechte.
--   * Das Buchungsjournal ist unveränderlich (Trigger), Buchungen gehen immer auf (Summe 0),
--     fachliche Schlüssel (payout:<termin>, refill:<zyklus>, expense:<id>, opening) sind eindeutig.
-- IDs sind Text (aus der App-Logik), Primärschlüssel immer zusammen mit group_id.


-- ---------- Gruppe ----------
create table public.groups (
  id            text primary key,
  name          text not null check (length(name) between 1 and 60),
  created_at    timestamptz not null default now(),
  series        jsonb,                         -- Serienregel {startDate, intervalWeeks, time, title}
  state_version bigint not null default 0      -- steigt bei jeder Änderung → Clients laden neu (Realtime)
);

create table public.group_members (
  group_id   text not null references public.groups(id) on delete cascade,
  id         text not null,
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null check (length(name) between 1 and 30),
  email      text not null default '',
  role       text not null check (role in ('admin', 'member')),
  status     text not null check (status in ('active', 'inactive')),
  joined_at  timestamptz not null default now(),
  ord        int not null default 0,
  primary key (group_id, id),
  unique (group_id, user_id)
);
create unique index group_members_name_uq on public.group_members (group_id, lower(name));

create table public.invitations (
  group_id    text not null references public.groups(id) on delete cascade,
  id          text not null,
  token_hash  text not null unique,           -- nur der SHA-256-Hash, der Link selbst wird nie gespeichert
  email       text not null,
  created_at  timestamptz not null,
  expires_at  timestamptz not null,
  created_by  text not null,
  used_at     timestamptz,
  used_by     text,
  revoked_at  timestamptz,
  primary key (group_id, id),
  check (expires_at > created_at)
);

-- ---------- Termine ----------
create table public.events (
  group_id             text not null references public.groups(id) on delete cascade,
  id                   text not null,
  type                 text not null check (type in ('stammtisch', 'event')),
  title                text not null check (length(title) between 1 and 60),
  date                 date not null,
  end_date             date,
  time                 text not null default '',
  end_time             text,
  all_day              boolean,
  location             text not null default '',
  description          text not null default '',
  status               text not null check (status in ('planned', 'cancelled', 'closed')),
  original_series_date date,
  detached             boolean,
  idea_id              text,
  created_at           timestamptz not null,
  created_by           text not null,
  closed_at            timestamptz,
  cancel_reason        text,
  primary key (group_id, id),
  check (end_date is null or (type = 'event' and end_date > date and end_date - date < 21)),
  check (time = '' or time ~ '^\d{2}:\d{2}$'),
  check (end_time is null or end_time ~ '^\d{2}:\d{2}$')
);
-- Ein Serientermin existiert je Seriendatum genau einmal (auch wenn verschoben/abgesagt)
create unique index events_series_uq on public.events (group_id, original_series_date) where original_series_date is not null;

create table public.attendance (
  group_id   text not null,
  event_id   text not null,
  member_id  text not null,
  rsvp       text not null check (rsvp in ('yes', 'no', 'open')),
  present    boolean,
  updated_at timestamptz not null,
  primary key (group_id, event_id, member_id),          -- keine doppelte Teilnahme
  foreign key (group_id, event_id) references public.events(group_id, id) on delete cascade,
  foreign key (group_id, member_id) references public.group_members(group_id, id)
);

create table public.expenses (
  group_id     text not null,
  id           text not null,
  event_id     text not null,
  payer_id     text not null,
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 1000000),
  description  text not null check (length(description) between 1 and 80),
  created_by   text not null,
  created_at   timestamptz not null,
  voided_at    timestamptz,
  voided_by    text,
  primary key (group_id, id),
  foreign key (group_id, event_id) references public.events(group_id, id),
  foreign key (group_id, payer_id) references public.group_members(group_id, id)
);

-- ---------- Buchungsjournal ----------
create table public.ledger_entries (
  group_id    text not null references public.groups(id) on delete restrict,
  id          text not null,
  seq         integer not null,
  kind        text not null check (kind in ('refill','payout','expense','settlement','opening','special_in','special_out','reversal')),
  date        date not null,
  created_at  timestamptz not null,
  created_by  text not null,
  key         text,
  event_id    text,
  ref_id      text,
  reverses_id text,
  text        text not null,
  meta        jsonb,
  primary key (group_id, id),
  unique (group_id, seq),
  check ((kind = 'reversal') = (reverses_id is not null))
);
create unique index ledger_one_reversal_uq on public.ledger_entries (group_id, reverses_id) where reverses_id is not null;

create table public.ledger_legs (
  group_id     text not null,
  entry_id     text not null,
  account      text not null,               -- 'pot' oder Mitglieds-ID
  amount_cents integer not null check (amount_cents <> 0),
  primary key (group_id, entry_id, account),
  foreign key (group_id, entry_id) references public.ledger_entries(group_id, id) on delete restrict
);

-- Unveränderlich: keine Updates, keine Löschungen
create function public.ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Buchungen sind unveränderlich – Korrekturen nur per Gegenbuchung.';
end $$;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function public.ledger_immutable();
create trigger ledger_legs_immutable before update or delete on public.ledger_legs
  for each row execute function public.ledger_immutable();

-- Nullsumme je Buchung (am Ende der Transaktion geprüft)
create function public.ledger_check_balanced() returns trigger language plpgsql as $$
declare s bigint; n int;
begin
  select coalesce(sum(amount_cents), 0), count(*) into s, n
    from public.ledger_legs where group_id = new.group_id and entry_id = new.id;
  if n = 0 then raise exception 'Buchung % hat keine Beträge.', new.id; end if;
  if s <> 0 then raise exception 'Buchung % geht nicht auf (Summe %).', new.id, s; end if;
  return null;
end $$;
create constraint trigger ledger_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function public.ledger_check_balanced();

-- Fachlicher Schlüssel nur einmal aktiv (nicht storniert) → keine doppelte Abrechnung/Auffüllung
create function public.ledger_check_key() returns trigger language plpgsql as $$
begin
  if new.key is not null and exists (
    select 1 from public.ledger_entries e
     where e.group_id = new.group_id and e.key = new.key and e.id <> new.id
       and not exists (select 1 from public.ledger_entries r where r.group_id = e.group_id and r.reverses_id = e.id)
  ) then
    raise exception 'Doppelte Buchung verhindert (%).', new.key using errcode = 'unique_violation';
  end if;
  return new;
end $$;
create trigger ledger_key_unique before insert on public.ledger_entries
  for each row execute function public.ledger_check_key();

-- ---------- Chronik & Ideen ----------
create table public.notes (
  group_id   text not null,
  id         text not null,
  event_id   text not null,
  author_id  text not null,
  text       text not null check (length(text) between 1 and 1000),
  decision   boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  updated_by text not null,
  primary key (group_id, id),
  foreign key (group_id, event_id) references public.events(group_id, id) on delete cascade
);

create table public.media_assets (
  group_id     text not null,
  id           text not null,
  event_id     text not null,
  uploader_id  text not null,
  created_at   timestamptz not null,
  width        integer not null,
  height       integer not null,
  bytes        integer not null check (bytes <= 5242880),
  primary key (group_id, id),
  foreign key (group_id, event_id) references public.events(group_id, id) on delete cascade
);

create table public.ideas (
  group_id    text not null references public.groups(id) on delete cascade,
  id          text not null,
  title       text not null check (length(title) between 1 and 60),
  description text not null default '',
  creator_id  text not null,
  status      text not null check (status in ('open', 'planned', 'done')),
  checklist   jsonb not null default '[]',
  event_id    text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  updated_by  text not null,
  primary key (group_id, id)
);

create table public.idea_comments (
  group_id   text not null,
  id         text not null,
  idea_id    text not null,
  author_id  text not null,
  text       text not null check (length(text) between 1 and 1000),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (group_id, id),
  foreign key (group_id, idea_id) references public.ideas(group_id, id) on delete cascade
);

create table public.idea_votes (
  group_id   text not null,
  idea_id    text not null,
  member_id  text not null,
  value      smallint not null check (value in (-1, 1)),
  updated_at timestamptz not null,
  primary key (group_id, idea_id, member_id),
  foreign key (group_id, idea_id) references public.ideas(group_id, id) on delete cascade
);

-- ---------- Row Level Security ----------
-- Hilfsfunktionen laufen als Definer, damit sie selbst nicht an RLS scheitern.
create function public.is_group_member(gid text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                  where group_id = gid and user_id = auth.uid() and status = 'active');
$$;
create function public.is_group_admin(gid text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                  where group_id = gid and user_id = auth.uid() and status = 'active' and role = 'admin');
$$;
revoke all on function public.is_group_member(text), public.is_group_admin(text) from public;
grant execute on function public.is_group_member(text), public.is_group_admin(text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['groups','group_members','invitations','events','attendance','expenses',
                           'ledger_entries','ledger_legs','notes','media_assets','ideas','idea_comments','idea_votes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Nur lesen, nur die eigene Gruppe
grant select on public.groups, public.group_members, public.events, public.attendance, public.expenses,
  public.ledger_entries, public.ledger_legs, public.notes, public.media_assets, public.ideas,
  public.idea_comments, public.idea_votes to authenticated;
grant select (group_id, id, email, created_at, expires_at, created_by, used_at, used_by, revoked_at)
  on public.invitations to authenticated;            -- token_hash bleibt unsichtbar

create policy read_groups on public.groups for select to authenticated using (public.is_group_member(id));
create policy read_members on public.group_members for select to authenticated
  using (public.is_group_member(group_id) or user_id = auth.uid());
create policy read_invitations on public.invitations for select to authenticated using (public.is_group_admin(group_id));

do $$
declare t text;
begin
  foreach t in array array['events','attendance','expenses','ledger_entries','ledger_legs','notes',
                           'media_assets','ideas','idea_comments','idea_votes']
  loop
    execute format('create policy read_%1$s on public.%1$I for select to authenticated using (public.is_group_member(group_id))', t);
  end loop;
end $$;
