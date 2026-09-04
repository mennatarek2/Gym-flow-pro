#!/usr/bin/env node
/**
 * Detect suspicious hardcoded UI strings in FE apps.
 * Uses allowlist of paths still pending migration (shrink over time).
 * Suppress inline with: // i18n-ignore-next-line  or  /* i18n-ignore *
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '../..');
const allowlistPath = path.join(__dirname, 'hardcoded-allowlist.json');
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));

const SUSPICIOUS = /\b(toast|alert|confirm)\s*\(\s*['"`][A-Za-z]/;
const JSX_HARD = />\s*[A-Z][a-z]+ [A-Za-z ]{2,40}\s*</;

function walk(dir, pred, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

function rel(p) {
  return path.relative(frontendRoot, p).replace(/\\/g, '/');
}

const hits = [];

for (const app of ['apps/web/src/app', 'apps/admin/src', 'apps/platform-console/src']) {
  const base = path.join(frontendRoot, app);
  for (const file of walk(base, (p) => /\.(js|tsx|ts|html)$/.test(p) && !p.includes('selftest'))) {
    const r = rel(file);
    if (allowlist.paths.some((a) => r === a || r.startsWith(a.replace(/\*$/, '')))) continue;
    if (allowlist.files.includes(r)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('i18n-ignore')) continue;
      if (i > 0 && lines[i - 1].includes('i18n-ignore-next-line')) continue;
      if (SUSPICIOUS.test(line) || (file.endsWith('.tsx') && JSX_HARD.test(line))) {
        // skip if already using t( or GfpI18n.t or tLabel with key pattern
        if (/GfpI18n\.t\(|\bt\(['"`][a-z]|tLabel\(/.test(line) && !SUSPICIOUS.test(line)) continue;
        if (SUSPICIOUS.test(line)) {
          hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 160) });
        }
      }
    }
  }
}

if (hits.length) {
  console.error('Hardcoded UI string check failed\n');
  for (const h of hits.slice(0, 80)) {
    console.error(`${h.file}:${h.line}\nHardcoded UI string detected:\n${h.text}\n`);
  }
  if (hits.length > 80) console.error(`… and ${hits.length - 80} more`);
  process.exit(1);
}
console.log('i18n:hardcoded OK (no unexpected toast/JSX literals outside allowlist)');
