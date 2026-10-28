import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 → eine einzige HTML-Datei (Artefakt-Vorschau). Sonst normaler Build für GitHub Pages.
export default defineConfig({
  base: './',
  resolve: {
    // Fachlogik liegt bei den Edge Functions, damit Server und Browser denselben Code nutzen
    alias: {
      '@engine': fileURLToPath(new URL('./supabase/functions/_shared/engine', import.meta.url)),
      '@db': fileURLToPath(new URL('./supabase/functions/_shared/db', import.meta.url)),
    },
  },
  plugins: [react(), ...(process.env.SINGLE ? [viteSingleFile()] : [])],
  test: { include: ['src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'] },
});
