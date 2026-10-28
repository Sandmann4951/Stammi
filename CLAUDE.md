# Hinweise für die Entwicklung

- Sprache der App und Doku: Deutsch. UX ist wichtig: mobile-first, große Bedienelemente, klare Fehlermeldungen.
- Fachlogik nur in `supabase/functions/_shared/engine` (reine Funktionen, Integer-Cent, Importe mit `.ts`-Endung für Deno). Die App importiert sie als `@engine/…`, die Edge Functions direkt. Jede Regeländerung braucht einen Test in `engine.test.ts`.
- Schreiben geht nur über die Edge Function `act`; neue Aktionen in `engine/registry.ts` eintragen.
- Schema-Änderungen nur als neue Datei in `supabase/migrations/`, mit passendem Fall in `supabase/tests/schema.test.mjs`.
- Vor jedem Commit: `npm run typecheck && npm test && npm run test:db && npm run check:functions`.
- Buchungen nie ändern oder löschen, nur per Gegenbuchung korrigieren.
- Architektur und Entscheidungen: `docs/KONZEPT.md`.
