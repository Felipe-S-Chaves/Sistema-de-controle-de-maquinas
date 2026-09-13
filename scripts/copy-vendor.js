'use strict';

/**
 * Copia os arquivos do Bootstrap de node_modules para frontend/assets/vendor.
 * Assim o frontend nao depende de CDN: funciona em rede local e offline.
 * Roda automaticamente no postinstall.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'node_modules', 'bootstrap', 'dist');
const TARGET = path.join(ROOT, 'frontend', 'assets', 'vendor', 'bootstrap');

const FILES = [
  ['css', 'bootstrap.min.css'],
  ['css', 'bootstrap.min.css.map'],
  ['js', 'bootstrap.bundle.min.js'],
  ['js', 'bootstrap.bundle.min.js.map']
];

if (!fs.existsSync(SOURCE)) {
  console.log('[vendor] Bootstrap ainda nao instalado; execute npm install.');
  process.exit(0);
}

fs.mkdirSync(TARGET, { recursive: true });

let copied = 0;
for (const [dir, file] of FILES) {
  const from = path.join(SOURCE, dir, file);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(TARGET, file));
  copied += 1;
}

console.log(`[vendor] ${copied} arquivo(s) do Bootstrap copiados para frontend/assets/vendor/bootstrap.`);
