# Stammi – Konzept

Private Web-App für unseren Stammtisch: Kalender, faire Kasse, Chronik und Ideen.
Dieses Dokument hält Architektur, Datenmodell, Sicherheitsregeln, Anmeldung und die Finanzlogik fest.

## 1. Architektur

```
Handy/Browser ──► GitHub Pages (statische React-App)
      │
      ├── Anmeldung ─────────► Supabase Auth (E-Mail + Passwort)
      ├── Lesen ─────────────► Supabase Postgres  (RLS: nur eigene Gruppe)
      ├── Fotos ─────────────► Supabase Storage   (privater Bucket, signierte URLs)
      └── Schreiben ─────────► Edge Function `act` ──► Postgres (eine Transaktion)
                                 └─ dieselbe Fachlogik wie im Browser (supabase/functions/_shared/engine)
```

* **Lesen** passiert direkt aus den Tabellen. Row Level Security lässt nur Zeilen der eigenen Gruppe durch.
* **Schreiben** geht ausschließlich über die Edge Function `act`. Sie prüft das Login, sperrt die Gruppe
  (`SELECT … FOR UPDATE`), führt die Aktion mit der getesteten Logik aus `_shared/engine` aus und schreibt den
  Unterschied zum vorherigen Stand in einer Transaktion. Browser-Nutzer haben keinerlei Schreibrechte auf Tabellen.
* **Sofortige Anzeige**: Die App führt jede Aktion zuerst lokal aus und merkt sich die dabei erzeugten IDs. Der
  Server spielt genau diese IDs wieder ein (geprüft: Format und noch nicht vergeben). So entstehen auf beiden Seiten
  dieselben Einträge, und die App kann sofort weiterarbeiten. Lehnt der Server ab, lädt die App den Server-Stand neu.
* **Sicherheitsnetz in der Datenbank**: Buchungen sind unveränderlich, gehen immer auf (Summe 0), und fachliche
  Schlüssel (`payout:<termin>`, `refill:<zyklus>`, `expense:<id>`, `opening`) können nur einmal aktiv sein.
  Selbst ein Fehler in der Server-Funktion kann so keine Doppelbuchung erzeugen.
* **Aktualität**: Jede Änderung erhöht `groups.state_version`. Die App abonniert diese Zeile (Supabase Realtime)
  und lädt neu, sobald jemand anderes etwas ändert.

Warum die Finanzlogik nicht in SQL nachgebaut wird: Sie ist in TypeScript mit Tests abgesichert. Die Edge Function
(Deno) nutzt exakt denselben Code. Zwei Implementierungen würden früher oder später auseinanderlaufen.

Tests auf drei Ebenen: Fachlogik (`engine.test.ts`), Datenbank-Abbildung und Server-Ablauf gegen echtes Postgres
(`db.test.ts`, `server.test.ts`, PGlite), Schema und Zugriffsregeln (`supabase/tests/schema.test.mjs`).

## 2. Datenmodell

| Tabelle | Inhalt | Besonderheiten |
|---|---|---|
| `groups` | Gruppe, Serienregel (`series` jsonb), `state_version` | |
| `group_members` | Mitglied je Gruppe, Rolle, Status, Verknüpfung zu `auth.users` | Name je Gruppe eindeutig |
| `invitations` | Einladungen | nur SHA-256-Hash des Links gespeichert, für Mitglieder unsichtbar |
| `events` | Stammtische und Events | Seriendatum eindeutig, mehrtägig nur für Events (max. 21 Tage) |
| `attendance` | Zusage (`rsvp`) und tatsächliche Anwesenheit (`present`) | eine Zeile je Person und Termin |
| `expenses` | Auslagen | Integer-Cent, max. 10.000 € |
| `ledger_entries` + `ledger_legs` | Buchungsjournal | unveränderlich, Nullsumme, Storno nur einmal |
| `notes` | Notizen und Beschlüsse | |
| `media_assets` | Foto-Metadaten | Datei in Storage `media/<gruppe>/<termin>/<id>-full.jpg` |
| `ideas`, `idea_comments`, `idea_votes` | Ideenpool | eine Stimme je Person und Idee |

Abweichungen vom ursprünglichen Vorschlag der Leistungsbeschreibung:
* `cash_pool_cycles`, `settlements`, `opening_claims` sind keine eigenen Tabellen. Sie sind Buchungsarten im Journal
  (`refill` mit Zyklusnummer, `settlement`, `opening`). So gibt es nur eine Quelle der Wahrheit.
* `recurrence_rules` liegt als `groups.series`, `idea_checklist_items` als `ideas.checklist` (jsonb). Beides ist klein und
  wird immer als Ganzes geändert.

## 3. Rechte

| Aktion | Mitglied | Admin |
|---|---|---|
| Alles der eigenen Gruppe lesen | ✓ | ✓ |
| Eigene Zu-/Absage, Ort eines geplanten Termins | ✓ | ✓ (auch für andere) |
| Auslage erfassen (bis zum Abschluss) | ✓ | ✓ (auch danach) |
| Eigene Auslage löschen (bis zum Abschluss) | ✓ | ✓ (danach per Storno) |
| Ausgleichszahlung eintragen, eigene stornieren | ✓ | ✓ |
| Notizen, Fotos, Ideen, Kommentare, Bewertungen | ✓ (eigene bearbeiten) | ✓ (fremde nur löschen) |
| Events anlegen und eigene bearbeiten | ✓ | ✓ |
| Anwesenheit bestätigen, abrechnen, Abrechnung zurücknehmen | | ✓ |
| Serie, Absagen, Sonderbuchungen, Anfangsbestand, Einladungen, Rollen | | ✓ |

Durchgesetzt wird das zweimal: fachlich in `src/engine/actions.ts` (läuft in der Edge Function) und technisch durch
RLS. Browser-Nutzer können nur lesen, und das nur in der eigenen Gruppe. Geprüft wird das in
`supabase/tests/schema.test.mjs`, unter anderem mit diesen Fällen: fremde Gruppe lesen, ohne Login lesen, direkt
schreiben, sich selbst zum Admin machen, Buchung ändern, doppelt abrechnen.

## 4. Anmeldung

* **Konto**: E-Mail und selbstgewähltes Passwort (mindestens 8 Zeichen). Die Sitzung bleibt auf dem Handy angemeldet.
* **Keine offene Registrierung**: In Supabase ist „Allow new users to sign up“ ausgeschaltet. Konten entstehen nur über eine Einladung.
* **Einladung** (wie in der Vorschau):
  1. Der Admin tippt „Link erstellen“. Die Edge Function `act` prüft, dass er Admin ist, erzeugt einen zufälligen
     Schlüssel (32 Byte) und speichert nur dessen Hash. Der Link ist 7 Tage gültig und nur einmal nutzbar.
  2. Der Admin schickt den Link per WhatsApp.
  3. Die eingeladene Person öffnet den Link und gibt Anzeigename, E-Mail und Passwort ein. Die Edge Function
     `accept-invite` prüft den Schlüssel und legt Konto und Mitgliedschaft an. Danach ist die Person angemeldet.
* **Passwort vergessen**: Supabase schickt eine E-Mail mit Link zurück in die App. Dort vergibt man ein neues Passwort.
  Dafür braucht es einen eigenen E-Mail-Versand (SMTP), siehe README.
* **Erster Admin**: wird einmal im Supabase-Dashboard angelegt und richtet in der App die Gruppe ein. Das geht nur,
  solange noch keine Gruppe existiert.
* **Datenschutz**: Gespeichert werden nur Anzeigename und E-Mail. Export aller Buchungen als CSV ist eingebaut. Wer
  die Gruppe verlässt, wird deaktiviert, nicht gelöscht, weil seine Buchungen im Journal bleiben müssen.
  Konto-Löschung auf Wunsch macht der Admin in Supabase.

## 5. Finanzlogik

Alle Beträge in Integer-Cent. Jede Buchung hat Beine auf Konten (Topf oder Mitglied), die Summe ist immer 0.

| Buchung | Topf | Mitglieder |
|---|---|---|
| Auffüllung (Start und nach je 2 abgerechneten Stammtischen) | + n × 20 € | je − 20 € (Beitrag) |
| Topfgutschrift je abgerechnetem Stammtisch (≥ 2 Anwesende) | − 50 € | Anwesende je + Anteil |
| Auslage | | Zahler + Betrag, Anwesende je − Anteil |
| Ausgleichszahlung A → B | | A + Betrag, B − Betrag |
| Anfangsbestand (Splitwise) | | Gläubiger +, Schuldner − |
| Sonderzuführung | + X | Finanzierende je − Anteil (bei Spende: verwahrende Person) |
| Sonderausschüttung (nur aus freiem Topfbetrag) | − X | Empfänger je + Anteil |

**Stand einer Person** = Summe ihrer Beine + gleicher Anteil am aktuellen Topfbestand.
Die Summe aller Stände ist damit immer genau 0, und die Zahlungsvorschläge gehen glatt auf.

Rest-Cents gehen deterministisch reihum (Startpunkt aus der Termin-ID), damit niemand dauerhaft bevorzugt wird.

### Beispiele (alle als Test in `src/engine/engine.test.ts`)

* **50 € Topf**: zu zweit 25,00 / 25,00 · zu dritt 16,67 / 16,67 / 16,66 · zu viert 4 × 12,50 · zu fünft 5 × 10,00.
  Bei 0 oder 1 Anwesenden oder bei Absage gibt es keine Ausschüttung, und der Zyklus zählt nicht weiter.
* **Auslage**: A und B sind da, A zahlt 40 €. Beide tragen 20 €, A hat 20 € bei B gut. Zusätzlich bekommen beide je 25 € aus dem Topf.
* **Zyklus**: Start 100 € → Treffen 1 → 50 € → Absage (zählt nicht) → Treffen 2 → 0 € → sofort wieder auf 100 € aufgefüllt, genau einmal.
* **Korrektur**: „Abrechnung zurücknehmen“ storniert Topfgutschrift, verteilte Auslagen und eine dadurch ausgelöste
  Auffüllung per Gegenbuchung. Danach erneut abschließen ergibt dieselben Stände.

### Entscheidungen (aus Abschnitt 11 der Leistungsbeschreibung)

1. Der 20-€-Beitrag wird **bei jeder Auffüllung** als Beitragsschuld je aktivem Mitglied gebucht.
2. Sonderzuführungen und -ausschüttungen: **Der Admin wählt je Buchung**, wer zahlt (alle, ausgewählte oder externe
   Spende mit verwahrender Person) und wer bekommt.

### Hausregeln

* Wer am weitesten im Minus ist, zahlt die Rechnung, sofern anwesend. Die App zeigt die Person auf der Übersicht und schlägt sie beim Erfassen vor.
* Nach der Abrechnung können nur Admins Auslagen nachtragen oder stornieren.
* Der Ort wird je Treffen festgelegt (jedes Mitglied darf), nicht in der Serie.
