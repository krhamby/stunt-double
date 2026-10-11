#!/usr/bin/env node
// npm run setup: build every @acme/core variant and npm-pack the tool, the SDK variants and the registry
// placeholder into .packs/. Example projects and the test harness install ONLY from these tarballs, so their
// node_modules look exactly like a real install (no workspace symlinks).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packs = path.join(root, '.packs');
const t0 = Date.now();

if (!fs.existsSync(path.join(root, 'node_modules', 'oxc-parser')) || !fs.existsSync(path.join(root, 'node_modules', 'typescript'))) {
  console.error('setup: run `npm ci` (or `npm install`) at the repository root first.');
  process.exit(1);
}
fs.rmSync(packs, { recursive: true, force: true });
fs.mkdirSync(packs, { recursive: true });

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

process.stdout.write(run(process.execPath, [path.join(root, 'examples/acme-core/scripts/build.mjs'), '--packs', packs]));
for (const dir of ['examples/acme-core-slots-placeholder', 'packages/stunt-double']) {
  const name = run('npm', ['pack', '--silent', '--pack-destination', packs, path.join(root, dir)]).trim().split('\n').at(-1);
  console.log(`${dir} -> .packs/${name}`);
}
console.log(`setup: ${fs.readdirSync(packs).length} tarballs in .packs/ (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
