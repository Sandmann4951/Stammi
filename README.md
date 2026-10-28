# Stammi

Private Web-App für unseren Stammtisch: Termine und Zusagen, faire Kasse mit Topf und Auslagen, Chronik mit Notizen
und Fotos, Ideenpool. Mobile-first, läuft im Browser. Für das Handy als Lesezeichen auf dem Home-Bildschirm ablegen.

Technik: React + TypeScript (Vite) · Supabase (Postgres, Auth, Storage, Edge Functions) · Hosting als statische Seite.
Architektur, Datenmodell, Rechte und Finanzlogik: [docs/KONZEPT.md](docs/KONZEPT.md).

## Lokal starten

```bash
npm install
npm run dev          # Vorschau mit Beispieldaten im Browser (ohne Supabase)
npm test             # Finanz- und Regel-Tests
npm run test:db      # Schema, RLS und Buchungsregeln gegen echtes Postgres (PGlite)
```

Ohne `.env.local` läuft die App im **Vorschau-Modus**: Alle Daten liegen nur im eigenen Browser.

## Einrichtung Supabase (einmalig)

1. **Projekt anlegen** auf [supabase.com](https://supabase.com), Region **Frankfurt (eu-central-1)**. Das Datenbank-Passwort sicher notieren.
2. **Auth → Providers → Email**: aktiv lassen, *Confirm email* an.
3. **Auth → Sign In / Providers → „Allow new users to sign up“ ausschalten.** Konten entstehen nur über Einladungen.
4. **Auth → URL Configuration**: *Site URL* = Adresse der veröffentlichten App, dieselbe Adresse auch unter *Redirect URLs*.
5. **Auth → SMTP**: eigenen E-Mail-Versand eintragen, z. B. Brevo (kostenloses Kontingent) oder das Postfach eines eigenen
   Mail-Anbieters. Ohne eigenes SMTP stellt Supabase Mails nur an Mitglieder des Supabase-Projektteams zu
   (max. 2 pro Stunde). „Passwort vergessen“ würde für die Runde also nicht funktionieren.
6. **Schlüssel für die App** (Project Settings → API): `Project URL` und `anon public key`.
   Beide sind für den Browser gedacht und dürfen öffentlich sein. Den **service_role key nie** in die App, ins Repo
   oder in einen Chat geben.

## GitHub einrichten

**Variables** (Settings → Secrets and variables → Actions → *Variables*): für den Build der App

| Name | Wert |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon public key |

**Secrets** (gleiche Seite → *Secrets*): nur für den Workflow „Datenbank & Funktionen“

| Name | Wert |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | persönlicher Token aus supabase.com → Account → Access Tokens |
| `SUPABASE_PROJECT_ID` | die Projekt-Referenz (Teil der Project URL vor `.supabase.co`) |
| `SUPABASE_DB_PASSWORD` | Datenbank-Passwort aus Schritt 1 |

Danach unter **Actions → „Datenbank & Funktionen (Supabase)“ → Run workflow** einmal starten. Das spielt Schema,
Zugriffsregeln und Server-Funktionen ein. Der Workflow läuft bewusst nur manuell.

## Veröffentlichen

Der Workflow „Veröffentlichen“ baut bei jedem Push auf `main` die App, testet sie und lädt sie auf GitHub Pages
(Settings → Pages → Source: **GitHub Actions**).

> GitHub Pages ist im kostenlosen Plan nur für **öffentliche** Repos verfügbar. Ein öffentliches Repo ist hier
> unbedenklich: Im Code stehen keine Geheimnisse, und die Daten schützt die Datenbank selbst. Alternative bei privatem
> Repo: Cloudflare Pages oder Netlify (beide kostenlos, Build-Befehl `npm run build`, Ausgabeordner `dist`,
> dieselben zwei Variablen).

## Projektstruktur

```
src/engine/      Fachlogik (Kasse, Termine, Rechte) + Tests – läuft im Browser und in der Edge Function
src/views/       Seiten: Übersicht, Kalender/Chronik, Termin, Kasse, Ideen, Gruppe
supabase/        Migrationen (Schema + RLS + Storage), Tests, später Edge Functions
docs/            Konzept
scripts/         Hilfsskripte (Ein-Datei-Vorschau)
```
