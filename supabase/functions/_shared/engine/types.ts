// Datenmodell – bewusst nah an der späteren Supabase-Struktur (Abschnitt 8 der Leistungsbeschreibung).
// Alle Geldbeträge sind Integer-Cent.

export type Cents = number;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // volle ISO-Zeit

export type Role = 'admin' | 'member';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'inactive';
  joinedAt: ISODateTime;
  order: number; // deterministische Reihenfolge, u. a. für Rest-Cent-Verteilung
  userId?: string; // Verknüpfung zum Login (Supabase Auth)
}

export interface Invitation {
  id: string;
  token: string;
  email: string;
  createdAt: ISODateTime;
  expiresAt: ISODateTime;
  createdBy: string;
  usedAt?: ISODateTime;
  usedBy?: string;
  revokedAt?: ISODateTime;
}

export interface SeriesRule {
  startDate: ISODate; // legt auch den Wochentag fest
  intervalWeeks: number;
  time: string; // HH:MM
  title: string;
  /** veraltet: Der Ort wird je Termin festgelegt, nicht in der Serie. */
  location?: string;
}

export type EventType = 'stammtisch' | 'event';
export type EventStatus = 'planned' | 'cancelled' | 'closed';

export interface StEvent {
  id: string;
  type: EventType;
  title: string;
  date: ISODate; // Start
  endDate?: ISODate; // nur bei mehrtägigen Events: letzter Tag (inklusive)
  time: string; // Beginn HH:MM ('' bei ganztägig)
  endTime?: string; // Ende HH:MM (optional)
  allDay?: boolean;
  location: string;
  description: string;
  status: EventStatus;
  originalSeriesDate?: ISODate; // gesetzt bei Serienterminen; eindeutig
  detached?: boolean; // einzeln verschoben/geändert → Serie fasst ihn nicht mehr an
  ideaId?: string;
  createdAt: ISODateTime;
  createdBy: string;
  closedAt?: ISODateTime;
  cancelReason?: string;
}

export type Rsvp = 'yes' | 'no' | 'open';

export interface Attendance {
  eventId: string;
  memberId: string;
  rsvp: Rsvp;
  present?: boolean; // vom Admin bestätigte tatsächliche Anwesenheit
  updatedAt: ISODateTime;
}

export interface Expense {
  id: string;
  eventId: string;
  payerId: string;
  amount: Cents;
  description: string;
  createdBy: string;
  createdAt: ISODateTime;
  voidedAt?: ISODateTime;
  voidedBy?: string;
}

export interface Note {
  id: string;
  eventId: string;
  authorId: string;
  text: string;
  decision: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  updatedBy: string;
}

export interface MediaAsset {
  id: string;
  eventId: string;
  uploaderId: string;
  createdAt: ISODateTime;
  width: number;
  height: number;
  bytes: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export type IdeaStatus = 'open' | 'planned' | 'done';

export interface Idea {
  id: string;
  title: string;
  description: string;
  creatorId: string;
  status: IdeaStatus;
  checklist: ChecklistItem[];
  eventId?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  updatedBy: string;
}

export interface IdeaComment {
  id: string;
  ideaId: string;
  authorId: string;
  text: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface IdeaVote {
  ideaId: string;
  memberId: string;
  value: 1 | -1;
  updatedAt: ISODateTime;
}

// ---------- Buchungsjournal ----------

export const POT = 'pot';

export interface Leg {
  account: string; // POT oder Mitglieds-ID
  amount: Cents; // positiv = Guthaben/Forderung des Kontos, negativ = Schuld
}

export type EntryKind =
  | 'refill' // automatische Auffüllung: Topf +, je Mitglied 20 € Beitragsschuld
  | 'payout' // 50 € Topfgutschrift an Anwesende
  | 'expense' // Auslage: Zahler +, Anwesende −
  | 'settlement' // Ausgleichszahlung: Zahler +, Empfänger −
  | 'opening' // Anfangsbestand (Splitwise)
  | 'special_in' // Sonderzuführung
  | 'special_out' // Sonderausschüttung
  | 'reversal'; // Gegenbuchung

export interface LedgerEntry {
  id: string;
  seq: number;
  kind: EntryKind;
  date: ISODate; // fachliches Datum
  createdAt: ISODateTime;
  createdBy: string;
  key?: string; // fachlicher Eindeutigkeitsschlüssel (z. B. payout:<eventId>)
  eventId?: string;
  refId?: string; // z. B. Expense-ID
  reversesId?: string;
  text: string;
  legs: Leg[];
  meta?: Record<string, unknown>;
}

export interface Group {
  id: string;
  name: string;
  createdAt: ISODateTime;
}

export interface State {
  schema: number;
  group: Group;
  members: Member[];
  invitations: Invitation[];
  series: SeriesRule | null;
  events: StEvent[];
  attendance: Attendance[];
  expenses: Expense[];
  notes: Note[];
  media: MediaAsset[];
  ideas: Idea[];
  ideaComments: IdeaComment[];
  ideaVotes: IdeaVote[];
  ledger: LedgerEntry[];
  currentUserId: string;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
