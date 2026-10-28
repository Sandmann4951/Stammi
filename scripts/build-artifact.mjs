// Baut aus dist/index.html eine Artefakt-Datei (ohne doctype/html/head/body-Hülle).
import { readFileSync, writeFileSync } from 'node:fs';
let h = readFileSync('dist/index.html', 'utf8');
const head = h.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = h.match(/<body>([\s\S]*?)<\/body>/)[1];
const keep = head.replace(/<meta charset[^>]*>/, '').replace(/<meta name="viewport"[^>]*>/, '');
const title = keep.match(/<title>.*?<\/title>/)[0];
const meta = keep.match(/<meta name="claude:viewport-fit-sides"[^>]*>/)[0];
const rest = keep.replace(title, '').replace(meta, '');
// Skripte ans Ende, damit #root existiert
const scripts = rest.match(/<script[\s\S]*?<\/script>/g) || [];
const noScripts = rest.replace(/<script[\s\S]*?<\/script>/g, '');
writeFileSync('dist/stammtisch-app.html', `${title}\n${meta}\n${noScripts}\n${body}\n${scripts.join('\n')}\n`);
