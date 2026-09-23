// Baut die Web-Seite der Android-App nach www/:
//  - Oberfläche 1:1 aus ../src/renderer (dieselbe wie am PC)
//  - core.js: Anbindungen, Speicher & Abruf aus ../src/main, gebündelt für das Handy
// Danach: npx cap sync android  →  cd android && ./gradlew assembleRelease
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, '..', 'src', 'renderer');
// --preview: Browser-Vorschau ohne Handy (Capacitor wird durch dev/fake-capacitor.js ersetzt)
const preview = process.argv.includes('--preview');
const out = path.join(here, preview ? 'preview' : 'www');
const fake = path.join(here, 'dev', 'fake-capacitor.js');
const previewAlias = preview
  ? Object.fromEntries(['core', 'app', 'local-notifications', 'share', 'filesystem'].map((m) => [`@capacitor/${m}`, fake]))
  : {};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1) Oberfläche kopieren
fs.cpSync(renderer, out, { recursive: true, filter: (src) => path.basename(src) !== 'package.json' });

// 2) Kern bündeln
const shim = (name) => path.join(here, 'core', 'shims', name);
await build({
  entryPoints: [path.join(here, 'core', 'app.js')],
  outfile: path.join(out, 'core.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome80'],
  minify: process.argv.includes('--minify'),
  sourcemap: false,
  legalComments: 'none',
  nodePaths: [path.join(here, 'node_modules')],
  alias: {
    crypto: shim('crypto.js'),
    fs: shim('empty.js'),
    path: shim('empty.js'),
    os: shim('empty.js'),
    electron: shim('empty.js'),
    ...previewAlias
  },
  inject: [shim('buffer-global.js')],
  define: { 'process.env.SCHULRADAR_DEBUG': 'undefined' },
  logLevel: 'warning'
});

// 3) index.html fürs Handy anpassen
const indexFile = path.join(out, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
html = html
  .replace('<html lang="de">', '<html lang="de" data-platform="android">')
  .replace(
    /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'" />`
  )
  .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />')
  .replace('<script type="module" src="app.js"></script>', '<script src="core.js"></script>\n    <script type="module" src="app.js"></script>');
if (!html.includes('core.js') || !html.includes('data-platform="android"')) throw new Error('index.html konnte nicht angepasst werden');
fs.writeFileSync(indexFile, html);

const size = (f) => `${Math.round(fs.statSync(path.join(out, f)).size / 1024)} KB`;
console.log(`${path.basename(out)}/ erstellt (core.js ${size('core.js')}, app.js ${size('app.js')})`);
