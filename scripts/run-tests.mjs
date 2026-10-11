#!/usr/bin/env node
// npm test [-- <filter>...]: the core unit tests (packages/stunt-double/test), then every toolchain suite
// (tests/<tool>.test.mjs) in parallel processes.
//
//   npm test                 everything
//   npm test -- core         only the core unit tests        (npm run test:core)
//   npm test -- vite         only tests/vite.test.mjs         (npm run test:vite)
//   npm test -- vite webpack several suites (no core tests unless "core" is named too)
//   npm test -- --list       list what would run
//
// Extra flags after the filters go to `node --test` (e.g. --test-name-pattern=F7). Suites need the tarballs of
// `npm run setup`. Environment: STUNT_DOUBLE_WORK_DIR (fixture installs, default <tmp>/stunt-double-tests),
// STUNT_DOUBLE_REINSTALL=1 (ignore cached installs), STUNT_DOUBLE_CLEAN=1 (delete them afterwards).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('-'));
const nodeFlags = args.filter((a) => a.startsWith('-') && a !== '--list');

const coreDir = path.join(root, 'packages', 'stunt-double', 'test');
const coreFiles = fs.existsSync(coreDir) ? fs.readdirSync(coreDir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(coreDir, f)) : [];
const suiteFiles = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(root, 'tests', f));
const suiteName = (f) => path.basename(f).replace(/\.test\.mjs$/, '');

const wantCore = !filters.length || filters.includes('core');
const suites = filters.length ? suiteFiles.filter((f) => filters.includes(suiteName(f))) : suiteFiles;
const unknown = filters.filter((x) => x !== 'core' && !suiteFiles.some((f) => suiteName(f) === x));
if (unknown.length) {
  console.error(`run-tests: unknown suite(s) ${unknown.join(', ')}. Available: core, ${suiteFiles.map(suiteName).join(', ')}`);
  process.exit(1);
}
if (args.includes('--list')) {
  if (wantCore) console.log(`core   ${coreFiles.map((f) => path.relative(root, f)).join(' ')}`);
  for (const f of suites) console.log(`${suiteName(f).padEnd(6)} ${path.relative(root, f)}`);
  process.exit(0);
}

function nodeTest(files, label) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n=== ${label}: node --test ${files.map((f) => path.relative(root, f)).join(' ')}`);
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', `--test-concurrency=${Math.max(1, Math.min(files.length, os.availableParallelism?.() ?? 4))}`, ...nodeFlags, ...files], { cwd: root, stdio: 'inherit' });
    child.on('close', (code, signal) => {
      console.log(`=== ${label}: ${code === 0 ? 'passed' : `FAILED (exit ${code ?? signal})`} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      resolve(code === 0);
    });
  });
}

let ok = true;
if (wantCore) {
  if (!coreFiles.length) { console.error('run-tests: no core unit tests found'); ok = false; }
  else ok = (await nodeTest(coreFiles, 'core unit tests')) && ok;
}
if (suites.length) {
  if (!fs.existsSync(path.join(root, '.packs')) || !fs.readdirSync(path.join(root, '.packs')).some((f) => f.endsWith('.tgz'))) {
    console.error('run-tests: .packs/ is empty: run `npm run setup` first (it builds the SDK variants and packs every tarball the fixtures install).');
    process.exit(1);
  }
  ok = (await nodeTest(suites, `toolchain suites (${suites.map(suiteName).join(', ')})`)) && ok;
}
process.exit(ok ? 0 : 1);
