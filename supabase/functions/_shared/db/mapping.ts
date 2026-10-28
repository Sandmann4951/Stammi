// Abbildung App-Zustand (State) ⇄ Datenbankzeilen. Wird von der App (Lesen) und der
// Edge Function (Lesen + Schreiben) gemeinsam genutzt – eine Quelle, keine Abweichungen.
import type {
  Attendance, Expense, Idea, IdeaComment, IdeaVote, Invitation, LedgerEntry, MediaAsset, Member, Note, State, StEvent,
} from '../engine/types.ts';

export type Row = Record<string, unknown>;
export type ColType = 'text' | 'int' | 'bool' | 'date' | 'ts' | 'json' | 'uuid' | 'smallint';

/** Spalten je Tabelle (in Schreibreihenfolge: Eltern vor Kindern). */
export const TABLES = {
  groups: { pk: ['id'], cols: { id: 'text', name: 'text', created_at: 'ts', series: 'json' } },
  group_members: {
    pk: ['group_id', 'id'],
    cols: { group_id: 'text', id: 'text', user_id: 'uuid', name: 'text', email: 'text', role: 'text', status: 'text', joined_at: 'ts', ord: 'int' },
  },
  invitations: {
    pk: ['group_id', 'id'],
    cols: { group_id: 'text', id: 'text', token_hash: 'text', email: 'text', created_at: 'ts', expires_at: 'ts', created_by: 'text', used_at: 'ts', used_by: 'text', revoked_at: 'ts' },
  },
  events: {
    pk: ['group_id', 'id'],
    cols: {
      group_id: 'text', id: 'text', type: 'text', title: 'text', date: 'date', end_date: 'date', time: 'text', end_time: 'text', all_day: 'bool',
      location: 'text', description: 'text', status: 'text', original_series_date: 'date', detached: 'bool', idea_id: 'text',
      created_at: 'ts', created_by: 'text', closed_at: 'ts', cancel_reason: 'text',
    },
  },
  ideas: {
    pk: ['group_id', 'id'],
    cols: { group_id: 'text', id: 'text', title: 'text', description: 'text', creator_id: 'text', status: 'text', checklist: 'json', event_id: 'text', created_at: 'ts', updated_at: 'ts', updated_by: 'text' },
  },
  attendance: {
    pk: ['group_id', 'event_id', 'member_id'],
    cols: { group_id: 'text', event_id: 'text', member_id: 'text', rsvp: 'text', present: 'bool', updated_at: 'ts' },
  },
  expenses: {
    pk: ['group_id', 'id'],
    cols: { group_id: 'text', id: 'text', event_id: 'text', payer_id: 'text', amount_cents: 'int', description: 'text', created_by: 'text', created_at: 'ts', voided_at: 'ts', voided_by: 'text' },
  },
  notes: {
    pk: ['group_id', 'id'],
    cols: { group_id: 'text', id: 'text', event_id: 'text', author_id: 'text', text: 'text', decision: 'bool', created_at: 'ts', updated_at: 'ts', updated_by: 'text' },
  },
  media_assets: {
    pk: ['group_id', 'id'],
    cols: { group_id: 'text', id: 'text', event_id: 'text', uploader_id: 'text', created_at: 'ts', width: 'int', height: 'int', bytes: 'int' },
  },
  idea_comments: {
    pk: ['group_id', 'id'],
    cols: { group_id: 'text', id: 'text', idea_id: 'text', author_id: 'text', text: 'text', created_at: 'ts', updated_at: 'ts' },
  },
  idea_votes: {
    pk: ['group_id', 'idea_id', 'member_id'],
    cols: { group_id: 'text', idea_id: 'text', member_id: 'text', value: 'smallint', updated_at: 'ts' },
  },
  ledger_entries: {
    pk: ['group_id', 'id'],
    cols: {
      group_id: 'text', id: 'text', seq: 'int', kind: 'text', date: 'date', created_at: 'ts', created_by: 'text', key: 'text',
      event_id: 'text', ref_id: 'text', reverses_id: 'text', text: 'text', meta: 'json',
    },
  },
  ledger_legs: {
    pk: ['group_id', 'entry_id', 'account'],
    cols: { group_id: 'text', entry_id: 'text', account: 'text', amount_cents: 'int' },
  },
} as const satisfies Record<string, { pk: readonly string[]; cols: Record<string, ColType> }>;

export type TableName = keyof typeof TABLES;
export const TABLE_ORDER = Object.keys(TABLES) as TableName[];
/** Buchungen werden nur angefügt – nie geändert oder gelöscht. */
export const APPEND_ONLY: ReadonlySet<TableName> = new Set(['ledger_entries', 'ledger_legs']);
export type Tables = Record<TableName, Row[]>;

// ---------- Normalisierung ----------
const n = (v: unknown) => (v === undefined ? null : v);
const opt = <T>(v: unknown) => (v === null || v === undefined ? undefined : (v as T));
const ts = (v: unknown) => (v === null || v === undefined ? undefined : new Date(v as string).toISOString());
const day = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
};

// ---------- State → Zeilen ----------
export function toRows(s: State): Tables {
  const g = s.group.id;
  const t = Object.fromEntries(TABLE_ORDER.map((k) => [k, [] as Row[]])) as Tables;
  t.groups.push({ id: g, name: s.group.name, created_at: s.group.createdAt, series: n(s.series) });
  for (const m of s.members) t.group_members.push({ group_id: g, id: m.id, user_id: n(m.userId), name: m.name, email: m.email, role: m.role, status: m.status, joined_at: m.joinedAt, ord: m.order });
  for (const i of s.invitations) t.invitations.push({ group_id: g, id: i.id, token_hash: i.token, email: i.email, created_at: i.createdAt, expires_at: i.expiresAt, created_by: i.createdBy, used_at: n(i.usedAt), used_by: n(i.usedBy), revoked_at: n(i.revokedAt) });
  for (const e of s.events) {
    t.events.push({
      group_id: g, id: e.id, type: e.type, title: e.title, date: e.date, end_date: n(e.endDate), time: e.time, end_time: n(e.endTime), all_day: n(e.allDay),
      location: e.location, description: e.description, status: e.status, original_series_date: n(e.originalSeriesDate), detached: n(e.detached),
      idea_id: n(e.ideaId), created_at: e.createdAt, created_by: e.createdBy, closed_at: n(e.closedAt), cancel_reason: n(e.cancelReason),
    });
  }
  for (const i of s.ideas) t.ideas.push({ group_id: g, id: i.id, title: i.title, description: i.description, creator_id: i.creatorId, status: i.status, checklist: i.checklist, event_id: n(i.eventId), created_at: i.createdAt, updated_at: i.updatedAt, updated_by: i.updatedBy });
  for (const a of s.attendance) t.attendance.push({ group_id: g, event_id: a.eventId, member_id: a.memberId, rsvp: a.rsvp, present: n(a.present), updated_at: a.updatedAt });
  for (const x of s.expenses) t.expenses.push({ group_id: g, id: x.id, event_id: x.eventId, payer_id: x.payerId, amount_cents: x.amount, description: x.description, created_by: x.createdBy, created_at: x.createdAt, voided_at: n(x.voidedAt), voided_by: n(x.voidedBy) });
  for (const x of s.notes) t.notes.push({ group_id: g, id: x.id, event_id: x.eventId, author_id: x.authorId, text: x.text, decision: x.decision, created_at: x.createdAt, updated_at: x.updatedAt, updated_by: x.updatedBy });
  for (const x of s.media) t.media_assets.push({ group_id: g, id: x.id, event_id: x.eventId, uploader_id: x.uploaderId, created_at: x.createdAt, width: x.width, height: x.height, bytes: x.bytes });
  for (const x of s.ideaComments) t.idea_comments.push({ group_id: g, id: x.id, idea_id: x.ideaId, author_id: x.authorId, text: x.text, created_at: x.createdAt, updated_at: x.updatedAt });
  for (const x of s.ideaVotes) t.idea_votes.push({ group_id: g, idea_id: x.ideaId, member_id: x.memberId, value: x.value, updated_at: x.updatedAt });
  for (const e of s.ledger) {
    t.ledger_entries.push({ group_id: g, id: e.id, seq: e.seq, kind: e.kind, date: e.date, created_at: e.createdAt, created_by: e.createdBy, key: n(e.key), event_id: n(e.eventId), ref_id: n(e.refId), reverses_id: n(e.reversesId), text: e.text, meta: n(e.meta) });
    for (const l of e.legs) t.ledger_legs.push({ group_id: g, entry_id: e.id, account: l.account, amount_cents: l.amount });
  }
  return t;
}

// ---------- Zeilen → State ----------
export function fromRows(t: Partial<Tables>, currentUserId?: string): State {
  const get = (k: TableName) => (t[k] ?? []) as Row[];
  const gr = get('groups')[0];
  if (!gr) throw new Error('Gruppe nicht gefunden.');
  const members: Member[] = get('group_members').map((r) => ({
    id: r.id as string, name: r.name as string, email: (r.email as string) ?? '', role: r.role as Member['role'], status: r.status as Member['status'],
    joinedAt: ts(r.joined_at)!, order: Number(r.ord ?? 0), userId: opt<string>(r.user_id),
  })).sort((a, b) => a.order - b.order);
  const legsBy = new Map<string, { account: string; amount: number }[]>();
  for (const l of get('ledger_legs')) {
    const k = l.entry_id as string;
    if (!legsBy.has(k)) legsBy.set(k, []);
    legsBy.get(k)!.push({ account: l.account as string, amount: Number(l.amount_cents) });
  }
  const ledger: LedgerEntry[] = get('ledger_entries').map((r) => ({
    id: r.id as string, seq: Number(r.seq), kind: r.kind as LedgerEntry['kind'], date: day(r.date)!, createdAt: ts(r.created_at)!, createdBy: r.created_by as string,
    key: opt<string>(r.key), eventId: opt<string>(r.event_id), refId: opt<string>(r.ref_id), reversesId: opt<string>(r.reverses_id), text: r.text as string,
    meta: opt<Record<string, unknown>>(json(r.meta, null)),
    legs: (legsBy.get(r.id as string) ?? []).sort((a, b) => a.account.localeCompare(b.account)),
  })).sort((a, b) => a.seq - b.seq);
  const byCreated = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

  const meUser = currentUserId ? members.find((m) => m.userId === currentUserId) : undefined;
  return {
    schema: 2,
    group: { id: gr.id as string, name: gr.name as string, createdAt: ts(gr.created_at)! },
    series: json(gr.series, null),
    members,
    invitations: get('invitations').map((r): Invitation => ({
      id: r.id as string, token: (r.token_hash as string) ?? '', email: r.email as string, createdAt: ts(r.created_at)!, expiresAt: ts(r.expires_at)!,
      createdBy: r.created_by as string, usedAt: ts(r.used_at), usedBy: opt<string>(r.used_by), revokedAt: ts(r.revoked_at),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    events: get('events').map((r): StEvent => ({
      id: r.id as string, type: r.type as StEvent['type'], title: r.title as string, date: day(r.date)!, endDate: day(r.end_date), time: (r.time as string) ?? '',
      endTime: opt<string>(r.end_time), allDay: opt<boolean>(r.all_day), location: (r.location as string) ?? '', description: (r.description as string) ?? '',
      status: r.status as StEvent['status'], originalSeriesDate: day(r.original_series_date), detached: opt<boolean>(r.detached), ideaId: opt<string>(r.idea_id),
      createdAt: ts(r.created_at)!, createdBy: r.created_by as string, closedAt: ts(r.closed_at), cancelReason: opt<string>(r.cancel_reason),
    })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    attendance: get('attendance').map((r): Attendance => ({
      eventId: r.event_id as string, memberId: r.member_id as string, rsvp: r.rsvp as Attendance['rsvp'], present: opt<boolean>(r.present), updatedAt: ts(r.updated_at)!,
    })).sort((a, b) => a.eventId.localeCompare(b.eventId) || a.memberId.localeCompare(b.memberId)),
    expenses: get('expenses').map((r): Expense => ({
      id: r.id as string, eventId: r.event_id as string, payerId: r.payer_id as string, amount: Number(r.amount_cents), description: r.description as string,
      createdBy: r.created_by as string, createdAt: ts(r.created_at)!, voidedAt: ts(r.voided_at), voidedBy: opt<string>(r.voided_by),
    })).sort(byCreated),
    notes: get('notes').map((r): Note => ({
      id: r.id as string, eventId: r.event_id as string, authorId: r.author_id as string, text: r.text as string, decision: !!r.decision,
      createdAt: ts(r.created_at)!, updatedAt: ts(r.updated_at)!, updatedBy: r.updated_by as string,
    })).sort(byCreated),
    media: get('media_assets').map((r): MediaAsset => ({
      id: r.id as string, eventId: r.event_id as string, uploaderId: r.uploader_id as string, createdAt: ts(r.created_at)!,
      width: Number(r.width), height: Number(r.height), bytes: Number(r.bytes),
    })).sort(byCreated),
    ideas: get('ideas').map((r): Idea => ({
      id: r.id as string, title: r.title as string, description: (r.description as string) ?? '', creatorId: r.creator_id as string, status: r.status as Idea['status'],
      checklist: json(r.checklist, []), eventId: opt<string>(r.event_id), createdAt: ts(r.created_at)!, updatedAt: ts(r.updated_at)!, updatedBy: r.updated_by as string,
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ideaComments: get('idea_comments').map((r): IdeaComment => ({
      id: r.id as string, ideaId: r.idea_id as string, authorId: r.author_id as string, text: r.text as string, createdAt: ts(r.created_at)!, updatedAt: ts(r.updated_at)!,
    })).sort(byCreated),
    ideaVotes: get('idea_votes').map((r): IdeaVote => ({
      ideaId: r.idea_id as string, memberId: r.member_id as string, value: Number(r.value) as 1 | -1, updatedAt: ts(r.updated_at)!,
    })).sort((a, b) => a.ideaId.localeCompare(b.ideaId) || a.memberId.localeCompare(b.memberId)),
    ledger,
    currentUserId: meUser?.id ?? members[0]?.id ?? '',
  };
}

/** Kanonische Form zum Vergleichen (Reihenfolgen, undefined-Felder). */
export function canonical(s: State): State {
  return { ...fromRows(toRows(s)), currentUserId: s.currentUserId };
}
