# Stammi

Private Web-App für unseren Stammtisch: Termine und Zusagen, faire Kasse mit Topf und Auslagen, Chronik mit Notizen
und Fotos, Ideenpool. Mobile-first, läuft im Browser. Auf dem Handy: Seite öffnen → Teilen → „Zum Home-Bildschirm“.

**App:** https://sandmann4951.github.io/Stammi/ · **Vorschau mit Beispieldaten:** https://sandmann4951.github.io/Stammi/?vorschau

Technik: React + TypeScript (Vite) · Supabase (Postgres, Auth, Storage, Edge Functions) · GitHub Pages.
Architektur, Datenmodell, Rechte und Finanzlogik: [docs/KONZEPT.md](docs/KONZEPT.md).

## Einrichtung (einmalig)

### 1. Supabase-Projekt verbinden
Supabase-Dashboard → *Project Settings → Integrations → GitHub* → Repository `Sandmann4951/Stammi` verbinden:

| Einstellung | Wert |
|---|---|
| Working directory | `.` |
| Production branch | `main` |
| Deploy to production | **an** |
| Automatic branching | aus |

Ab jetzt spielt Supabase bei jedem Merge auf `main` neue Migrationen und Edge Functions automatisch ein.

### 2. Anmeldung einstellen (Supabase → Authentication)
1. **Sign In / Providers → „Allow new users to sign up“: aus.** Konten entstehen nur über Einladungen.
2. **Sign In / Providers → Email**: aktiv lassen.
3. **URL Configuration** → *Site URL*: `https://sandmann4951.github.io/Stammi/` und dieselbe Adresse unter *Redirect URLs*.
4. **Emails → SMTP Settings**: eigenen E-Mail-Versand eintragen (z. B. Brevo, kostenloses Kontingent). Ohne eigenes
   SMTP stellt Supabase nur an Mitglieder des Supabase-Projektteams zu (max. 2 Mails pro Stunde). „Passwort vergessen“
   würde für die Runde nicht funktionieren. Alles andere geht auch ohne.
5. Optional: **Emails → Templates** → „Reset Password“ auf Deutsch übersetzen.

### 3. Ersten Admin anlegen
Weil die offene Registrierung aus ist, legst du dein eigenes Konto einmal von Hand an:
*Authentication → Users → Add user → Create new user*: E-Mail, Passwort, **Auto Confirm User** an.
Dann die App öffnen, anmelden und **„Ich richte die Gruppe ein“** wählen. Du wirst Admin. Alle anderen lädst du
danach in der App über *Gruppe & Profil → Einladen* ein (Link per WhatsApp, 7 Tage gültig, einmal nutzbar).

### 4. GitHub Pages
*Settings → Pages → Source: GitHub Actions*. Jeder Push auf `main` testet, baut und veröffentlicht die App.

Die öffentlichen Verbindungsdaten (Project URL, Publishable key) stehen in `.env.production`. Sie sind zum
Veröffentlichen gedacht. Der **geheime Schlüssel** (`sb_secret_…`) kommt nie ins Repo und wird nicht gebraucht:
Die Edge Functions bekommen ihn von Supabase automatisch.

## Entwicklung

```bash
npm install
npm run dev              # Vorschau-Modus mit Beispieldaten (ohne Supabase)
npm test                 # Fachlogik, Datenbank-Abbildung und Server-Ablauf (inkl. PGlite)
npm run test:db          # Schema, RLS und Buchungsregeln gegen echtes Postgres (PGlite)
npm run check:functions  # Edge Functions mit Deno prüfen
npm run build:artifact   # Ein-Datei-Vorschau (immer Vorschau-Modus)
```

Gegen das echte Supabase entwickeln: `.env.example` nach `.env.local` kopieren.

## Wie es zusammenspielt

```
App (GitHub Pages) ── Anmeldung ──────► Supabase Auth
        │            ── Lesen ──────────► Postgres (RLS: nur die eigene Gruppe)
        │            ── Fotos ──────────► Storage (privat, befristete Links)
        └─────────── ── Schreiben ──────► Edge Function `act` ─► Postgres (eine Transaktion)
```

Jede Aktion wird in der App sofort angezeigt und parallel an `act` geschickt. Der Server rechnet mit derselben Logik
(`supabase/functions/_shared/engine`) und denselben IDs nach und gibt den verbindlichen Stand zurück. Lehnt er ab,
lädt die App neu und zeigt den Grund. Ändert jemand anderes etwas, aktualisiert sich die App automatisch.

## Projektstruktur

```
src/                               App: Seiten, Anmeldung, Supabase-Anbindung
supabase/functions/_shared/engine  Fachlogik + Tests (App und Server)
supabase/functions/_shared/db      Abbildung App ⇄ Tabellen, Schreiblogik + Tests
supabase/functions/act             Edge Function: alle Schreibaktionen
supabase/functions/accept-invite   Edge Function: Beitritt per Einladungslink
supabase/migrations                Schema, RLS, Storage, Realtime
supabase/tests                     Schema-/Sicherheitstests (PGlite)
docs/                              Konzept
```
