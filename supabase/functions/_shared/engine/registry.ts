// Liste der Aktionen, die die App beim Server auslösen darf. Server und App nutzen dieselbe Liste.
import * as A from './actions.ts';
import type { State } from './types.ts';

export const ACTIONS = {
  setRsvp: A.setRsvp,
  setEventLocation: A.setEventLocation,
  createEvent: A.createEvent,
  updateEvent: A.updateEvent,
  cancelEvent: A.cancelEvent,
  restoreEvent: A.restoreEvent,
  deleteEvent: A.deleteEvent,
  closeEvent: A.closeEvent,
  reopenEvent: A.reopenEvent,
  startCashPool: A.startCashPool,
  updateSeries: A.updateSeries,
  addExpense: A.addExpense,
  voidExpense: A.voidExpense,
  addSettlement: A.addSettlement,
  reverseEntry: A.reverseEntry,
  importOpening: A.importOpening,
  importBalances: A.importBalances,
  specialIn: A.specialIn,
  specialOut: A.specialOut,
  addNote: A.addNote,
  updateNote: A.updateNote,
  deleteNote: A.deleteNote,
  addMedia: A.addMedia,
  deleteMedia: A.deleteMedia,
  addIdea: A.addIdea,
  updateIdea: A.updateIdea,
  setIdeaStatus: A.setIdeaStatus,
  deleteIdea: A.deleteIdea,
  planIdea: A.planIdea,
  addIdeaComment: A.addIdeaComment,
  updateIdeaComment: A.updateIdeaComment,
  deleteIdeaComment: A.deleteIdeaComment,
  voteIdea: A.voteIdea,
  revokeInvite: A.revokeInvite,
  setMemberRole: A.setMemberRole,
  setMemberStatus: A.setMemberStatus,
  renameMember: A.renameMember,
} as const;

export type ActionName = keyof typeof ACTIONS;
type Tail<T> = T extends [unknown, unknown, ...infer R] ? R : never;
export type ActionArgs<K extends ActionName> = Tail<Parameters<(typeof ACTIONS)[K]>>;
export type ActionResult<K extends ActionName> = ReturnType<(typeof ACTIONS)[K]>;

/** Eine Aktion als Daten: wird lokal ausgeführt und genauso an den Server geschickt. */
export interface Call<K extends ActionName = ActionName> { name: K; args: ActionArgs<K> }
export function call<K extends ActionName>(name: K, ...args: ActionArgs<K>): Call<K> {
  return { name, args };
}

export function isAction(name: unknown): name is ActionName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, name);
}

export function applyCall(state: State, ctx: A.Ctx, c: Call): State | { state: State } {
  const fn = ACTIONS[c.name] as unknown as (s: State, ctx: A.Ctx, ...a: unknown[]) => State | { state: State };
  return fn(state, ctx, ...(c.args as unknown[]));
}

export function stateOf(r: State | { state: State }): State {
  return 'ledger' in r ? r : r.state;
}
