// Plumbing for the tool-specific extra tests of the esbuild / Rollup / Rolldown / Farm suites (the shared
// catalogue runs through tests/harness): install an example once into a temp dir from the .packs/ tarballs, copy
// it per case, run a command, assert the rendered markers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRenderOutput, summarize, compareRender } from '../harness/markers.mjs';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const packs = path.join(repo, '.packs');

export function run(cmd, args, cwd, { env = {}, timeout = 180_000 } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...env }, maxBuffer: 1 << 26, timeout });
  return { code: r.status ?? 1, signal: r.signal, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: Date.now() - t0 };
}

export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const writeJson = (f, j) => fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
export const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

/** The [Fx]-style codes in an output, e.g. ['[F1]', '[F2]']. */
export const codesIn = (out) => [...new Set(out.match(/\[(F\d+[a-z]?|W7|STALE|SETUP|CFG|TS)\]/g) ?? [])].sort();

/**
 * One workspace per suite: <tmp>/base is the example installed from .packs/; project() copies it.
 * npm "file:./sdk-slots" is a RELATIVE symlink, so a copy keeps its own link.
 */
export function workspace(exampleName) {
  const example = path.join(repo, 'examples', exampleName);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `sd-${exampleName}-`));
  const base = path.join(work, 'base');
  const ws = {
    work, base, example,
    rel: (s) => s.replaceAll(work, '<work>'),
    show: (r) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}\n${ws.rel(r.out).slice(-4000)}`,
    install() {
      for (const t of ['acme-core-1.0.0.tgz', 'acme-core-slots-0.0.1.tgz', 'stunt-double-0.1.0.tgz'])
        assert.ok(fs.existsSync(path.join(packs, t)), `missing .packs/${t}: run \`npm run setup\` first`);
      fs.cpSync(example, base, { recursive: true, filter: (src) => !/[\\/](node_modules|dist|dist-ssr|\.stunt-double|sdk-slots)$/.test(src) });
      const f = path.join(base, 'package.json');
      writeJson(f, JSON.parse(fs.readFileSync(f, 'utf8').replaceAll('file:../../.packs/', `file:${packs}/`)));
      const r = run('npm', ['install', '--package-lock=false', '--no-audit', '--no-fund'], base, { timeout: 600_000 });
      assert.equal(r.code, 0, ws.show(r));
      return r;
    },
    /** A copy of the installed base, optionally mutated. */
    project(name, mutate) {
      const from = base;
      const dir = path.join(work, name);
      // Everything is copied except node_modules, which is HARDLINKED (cp -al): npm replaces files instead of
      // writing them in place, and the generator writes only under .stunt-double/, sdk-slots/ and src/. Tool caches inside
      // node_modules are dropped so no case can see another case's cache.
      fs.mkdirSync(dir);
      for (const e of fs.readdirSync(from)) {
        const r = run('cp', [e === 'node_modules' ? '-al' : '-a', path.join(from, e), path.join(dir, e)], work);
        assert.equal(r.code, 0, ws.show(r));
      }
      for (const c of ['.farm', '.cache', '.vite', '.tmp']) fs.rmSync(path.join(dir, 'node_modules', c), { recursive: true, force: true });
      // npm's hidden lockfile may be rewritten in place by a reinstall: give each copy its own.
      const hidden = path.join(dir, 'node_modules/.package-lock.json');
      if (fs.existsSync(hidden)) { const text = fs.readFileSync(hidden); fs.rmSync(hidden); fs.writeFileSync(hidden, text); }
      mutate?.(dir, ws);
      return dir;
    },
    /** Install another version of a dependency (an SDK variant tarball), like a user's upgrade. */
    swapDep(dir, name, spec) {
      const f = path.join(dir, 'package.json');
      const pkg = readJson(f);
      pkg.dependencies[name] = spec;
      writeJson(f, pkg);
      fs.rmSync(path.join(dir, 'node_modules', ...name.split('/')), { recursive: true, force: true });
      const r = run('npm', ['install', '--no-audit', '--no-fund'], dir, { timeout: 600_000 });
      assert.equal(r.code, 0, ws.show(r));
    },
    cleanup() { if (!process.env.KEEP_WORK) fs.rmSync(work, { recursive: true, force: true }); },
  };
  return ws;
}

/** node-run of a built SSR bundle; a small heap + timeout turn an infinite render (F7) into a quick crash. */
export const probe = (dir, entry = 'dist-ssr/entry-server.js') =>
  run(process.execPath, ['--max-old-space-size=128', 'probes/render.mjs', entry], dir, { timeout: 60_000 });

/** The marker sequence every example renders with its three overrides (wrapped Button, replaced PriceTag, Logo). */
export const POSITIVE = {
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, BRAND_PRICE: 3, BRAND_LOGO: 1, SDK_DEFAULT_PRICETAG: 0 },
};

export function assertRender(ws, r, expect = POSITIVE) {
  assert.equal(r.code, 0, ws.show(r));
  const html = parseRenderOutput(r.out);
  assert.ok(html, `no STUNT-DOUBLE-RENDER line:\n${ws.show(r)}`);
  const errors = compareRender(summarize(html), expect);
  assert.deepEqual(errors, [], errors.join('\n'));
}
