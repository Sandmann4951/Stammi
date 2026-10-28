# Hinweise für die Entwicklung

- Sprache der App und Doku: Deutsch. UX ist wichtig: mobile-first, große Bedienelemente, klare Fehlermeldungen.
- Fachlogik nur in `src/engine` (reine Funktionen, Integer-Cent). Jede Regeländerung braucht einen Test in `src/engine/engine.test.ts`.
- Schema-Änderungen nur als neue Datei in `supabase/migrations/`, mit passendem Fall in `supabase/tests/schema.test.mjs`.
- Vor jedem Commit: `npm run typecheck && npm test && npm run test:db`.
- Buchungen nie ändern oder löschen, nur per Gegenbuchung korrigieren.
- Architektur und Entscheidungen: `docs/KONZEPT.md`.
