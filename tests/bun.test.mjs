// Bun 1.4 suite. examples/customer-bun is the three-step default (install, the plugin line in build.ts,
// src/overrides; bunfig lines for the dev server and `bun test`): no link, no tsconfig paths, no config.
// It runs `bun build.ts` (Bun.build + stuntDoubleBun(), T1), `stunt-double check`, `bun test` with the
// stunt-double/bun-test preload, and the dev server (`bun ./index.html`). Commands that run NO stunt-double
// code — the `bun build` CLI (it cannot load plugins) and `bun test` without the preload — need the universal
// tier (`stunt-double init --universal`: a committed sdk-slots/ stub linked with "workspace:*"); those cells
// run on a universal-tier copy, so "bare" means T0 without `stunt-double check &&`.
//
//   npm run setup && node --test tests/bun.test.mjs        (BUN=/path/to/bun to pick a binary)
//
// Every cell is OBSERVED behaviour of Bun 1.4.2: where only `stunt-double check &&` catches a mistake, the bare
// cell says so.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRenderOutput, summarize, compareRender } from './harness/markers.mjs';
import { defineToolSuite } from './harness/index.mjs';

// ---------------------------------------------------------------------------------------------------------
// The shared harness suite (tests/README.md): the positive scenario, the whole mutation catalogue, a dev-server
// probe, the TypeScript 5.9 type gate and the universal tier, all installed with `bun install`.
const BUN_CLI_SSR = 'bun build ./src/entry-server.tsx --target node --format esm --outdir dist-ssr';
const BUN_CLI_BUILD = `bun build ./index.html --outdir dist && ${BUN_CLI_SSR}`;

defineToolSuite({
  name: 'bun',
  fixtureDir: 'examples/customer-bun',
  pm: 'bun',
  commands: {
    build: 'bun build.ts', // Bun.build() + stuntDoubleBun(): browser (index.html) + SSR bundles
    render: 'node probes/render.mjs',
    test: 'bun test', // bunfig [test] preload = ["stunt-double/bun-test"]
  },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/*.js' }, alsoPass: ['check', 'test'] },
  // the `bun build` CLI cannot load plugins: the same app built without stunt-double
  unwired: { files: {}, command: 'bun build ./src/entry-server.tsx --target node --outdir dist-unwired' },
  // every mistake the build refuses, `bun test` refuses too: the preload runs the same generator and type gate
  expectations: (m) => (m.expect.outcome === 'fail' && m.expect.command === 'build' ? { also: [{ command: 'test' }] } : undefined),
  devProbe: bunDevProbe,
  typescript5: true,
  universal: {
    pm: 'bun', // "workspace:*" + "workspaces": ["sdk-slots"]
    build: `stunt-double check && ${BUN_CLI_BUILD}`,
    bare: BUN_CLI_BUILD,
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});

/** Dev server (`bun ./index.html`, bunfig [serve.static] plugins = ["stunt-double/bun"]) in the harness app. */
async function bunDevProbe(fx, t) {
  const s = devServer(fx.app);
  const js = async (re, what) => (await s.until(what, async () => { const p = await s.page(); return p.status === 200 && p.js.status === 200 && re.test(p.js.body) && p; })).js.body;
  try {
    const first = await js(/BRAND_LOGO/, 'the page');
    assert.doesNotMatch(first, /SDK_DEFAULT_PRICETAG/);
    // remove an override: the SDK default comes back without a restart; restore it: the override again
    fx.remove(fx.override('PriceTag.tsx'));
    await js(/SDK_DEFAULT_PRICETAG/, 'the SDK PriceTag after removing the override');
    fx.restore(fx.override('PriceTag.tsx'));
    assert.doesNotMatch(await js(/BRAND_PRICE/, 'the override after restoring it'), /SDK_DEFAULT_PRICETAG/);
    // a mistake: Bun's error page (HTTP 500) with the [F3] line; fixing it clears it
    fx.remove(fx.override('Logo.tsx'));
    await s.until('HTTP 500', async () => (await s.page()).status === 500);
    await s.until('[F3] on the dev server output', () => /\[F3\] required slot "Logo"/.test(s.log) && /STUNT-DOUBLE-ERROR -- \[F3\]/.test(s.log));
    fx.restore(fx.override('Logo.tsx'));
    await js(/BRAND_LOGO/, 'the fixed page');
    t.diagnostic('bun dev server: override add/remove live; [F3] error page cleared on fix');
  } finally { s.stop(); }
}

// ---------------------------------------------------------------------------------------------------------
// Bun-specific checks beyond the harness: observed behaviour per command for every mistake (including the
// commands that run no stunt-double code), the bun-test preload, external rules, the dev server, doctor.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packs = path.join(repo, '.packs');
const example = path.join(repo, 'examples/customer-bun');
const BUN = process.env.BUN ?? (fs.existsSync(path.join(os.homedir(), '.bun/bin/bun')) ? path.join(os.homedir(), '.bun/bin/bun') : 'bun');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-bun-'));
const base = path.join(work, 'base'); // adapter tier: the example as committed
const baseU = path.join(work, 'base-universal'); // universal tier: + `stunt-double init --universal`

function run(cmd, args, cwd, { env = {}, timeout = 180_000 } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...env }, maxBuffer: 1 << 26, timeout });
  return { code: r.status ?? 1, signal: r.signal, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: Date.now() - t0 };
}
const rel = (s) => s.replaceAll(work, '<work>');
const show = (r) => `exit ${r.code}\n${rel(r.out).slice(-3000)}`;

function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function writeJson(f, j) { fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); }
function setDep(dir, name, spec, field = 'dependencies') {
  const f = path.join(dir, 'package.json');
  const pkg = readJson(f);
  pkg[field][name] = spec;
  writeJson(f, pkg);
}

/** bun install from scratch. Never reuse a bun.lock here: Bun 1.4.2 silently keeps the OLD contents of a
 *  rebuilt file: tarball while bun.lock pins it (no integrity error) [V]. */
function bunInstall(dir) {
  fs.rmSync(path.join(dir, 'bun.lock'), { force: true });
  fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
  return run(BUN, ['install'], dir);
}

/** A copy of an installed base project (symlinks kept verbatim: the isolated store links are relative). */
function project(name, mutate, { universal = false } = {}) {
  const dir = path.join(work, name);
  fs.cpSync(universal ? baseU : base, dir, { recursive: true, verbatimSymlinks: true });
  mutate?.(dir);
  return dir;
}

function dropPreload(dir) {
  const f = path.join(dir, 'bunfig.toml');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^\[test\][\s\S]*?(?=^\[|(?![\s\S]))/m, ''));
}
const sdCli = (dir) => path.join(dir, 'node_modules/stunt-double/bin/stunt-double.mjs');
const cmd = {
  /** T1: `bun build.ts` (Bun.build + stuntDoubleBun()), browser + SSR bundles */
  build: (dir) => run(BUN, ['build.ts'], dir),
  /** the chain for adapter-less commands */
  check: (dir) => run(process.execPath, [sdCli(dir), 'check'], dir),
  /** T0 bare: the `bun build` CLI (no plugins possible), SSR bundle for the probe */
  bare: (dir) => run(BUN, ['build', './src/entry-server.tsx', '--target', 'node', '--format', 'esm', '--outdir', 'dist-bare'], dir),
  /** `bun test` with bunfig [test] preload = ["stunt-double/bun-test"] (STA + gate + scoped socket rewrite) */
  test: (dir) => run(BUN, ['test'], dir),
  /** `bun test` with the preload line removed: the Bun runtime resolves sockets natively (link, or the placeholder) */
  testBare: (dir) => { dropPreload(dir); return run(BUN, ['test'], dir); },
  /** node-run of a built SSR bundle; a small heap + timeout turn an infinite render (F7) into a quick crash */
  probe: (dir, entry = 'dist-ssr/entry-server.js') => run(process.execPath, ['--max-old-space-size=128', 'probes/render.mjs', entry], dir, { timeout: 60_000 }),
};

const POSITIVE = {
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, BRAND_PRICE: 3, BRAND_LOGO: 1, SDK_DEFAULT_PRICETAG: 0 },
};

function assertRender(r, expect) {
  assert.equal(r.code, 0, show(r));
  const html = parseRenderOutput(r.out);
  assert.ok(html, `no STUNT-DOUBLE-RENDER line:\n${show(r)}`);
  const errors = compareRender(summarize(html), expect);
  assert.deepEqual(errors, [], errors.join('\n'));
}

const fails = (r, re) => { assert.notEqual(r.code, 0, `expected a failure matching ${re}\n${show(r)}`); if (re) assert.match(r.out, re, show(r)); };
const passes = (r) => assert.equal(r.code, 0, show(r));

before(() => {
  for (const t of ['acme-core-1.0.0.tgz', 'stunt-double-0.1.0.tgz', 'acme-core-slots-0.0.1.tgz'])
    assert.ok(fs.existsSync(path.join(packs, t)), `missing .packs/${t}: run \`npm run setup\` first`);
  const skip = /[\\/](node_modules|dist|dist-ssr|dist-bare|\.stunt-double)$|bun\.lockb?$/;
  fs.cpSync(example, base, { recursive: true, filter: (s) => !skip.test(s) });
  const f = path.join(base, 'package.json');
  writeJson(f, JSON.parse(fs.readFileSync(f, 'utf8').replaceAll('file:../../.packs/', `file:${packs}/`)));
  const r = bunInstall(base);
  assert.equal(r.code, 0, `bun install failed\n${show(r)}`);
  // universal tier: what `npx stunt-double init --universal` does for Bun, then bun install
  fs.cpSync(base, baseU, { recursive: true, verbatimSymlinks: true });
  const init = run(process.execPath, [sdCli(baseU), 'init', '--universal'], baseU);
  assert.equal(init.code, 0, show(init));
  // a link project needs no placeholder override (and npm rejects one next to a link: EOVERRIDE)
  const pu = readJson(path.join(baseU, 'package.json'));
  delete pu.overrides;
  writeJson(path.join(baseU, 'package.json'), pu);
  const ru = bunInstall(baseU);
  assert.equal(ru.code, 0, `bun install (universal) failed\n${show(ru)}`);
  // init + install leave sdk-slots/gen/ empty; the first `stunt-double check &&` (or gen) fills it
  const gen = run(process.execPath, [sdCli(baseU), 'gen'], baseU);
  assert.equal(gen.code, 0, show(gen));
});
after(() => { if (!process.env.KEEP) fs.rmSync(work, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------------------------------------
const ONLY = process.env.ONLY?.split(',');
const selected = (id) => !ONLY || ONLY.includes(id);

describe('positive: customer-bun', { skip: !selected('positive') }, () => {
  test('bun --version is pinned 1.4.x', () => {
    const r = run(BUN, ['--version'], base);
    assert.match(r.out.trim(), /^1\.4\.\d+/, show(r));
  });

  test('three-step install: no link, the SDK\'s @acme/core-slots peer is the registry placeholder', () => {
    const pkg = readJson(path.join(base, 'package.json'));
    assert.equal(pkg.dependencies['@acme/core-slots'], undefined);
    assert.equal(pkg.workspaces, undefined);
    assert.ok(!fs.existsSync(path.join(base, 'stunt-double.config.json')) && !fs.existsSync(path.join(base, 'sdk-slots')));
    assert.doesNotMatch(fs.readFileSync(path.join(base, 'tsconfig.json'), 'utf8'), /paths|stunt-double/);
    const seen = path.join(fs.realpathSync(path.join(base, 'node_modules/@acme/core')), '..', 'core-slots', 'package.json');
    assert.equal(readJson(seen).stuntDouble?.placeholder, true);
  });

  test('universal tier: init --universal + bun install links sdk-slots/ (workspace:*) into the SDK\'s isolated store', () => {
    const pkg = readJson(path.join(baseU, 'package.json'));
    assert.equal(pkg.dependencies['@acme/core-slots'], 'workspace:*');
    assert.deepEqual(pkg.workspaces, ['sdk-slots']);
    assert.equal(pkg.overrides, undefined);
    const seen = fs.realpathSync(path.join(fs.realpathSync(path.join(baseU, 'node_modules/@acme/core')), '..', 'core-slots'));
    assert.equal(seen, fs.realpathSync(path.join(baseU, 'sdk-slots')));
    passes(cmd.check(project('universal-check', null, { universal: true })));
  });

  test('universal tier before the first gen/check: the `bun build` CLI fails loudly (no shims yet), never a default', () => {
    const dir = project('universal-nogen', (d) => fs.rmSync(path.join(d, 'sdk-slots/gen'), { recursive: true, force: true }), { universal: true });
    fails(cmd.bare(dir), /Could not resolve: "@acme\/core-slots\/Button"/);
  });

  test('bun build.ts: exit 0; SSR bundle renders every override in app and SDK positions', () => {
    const dir = project('positive');
    const b = cmd.build(dir);
    passes(b);
    assertRender(cmd.probe(dir), POSITIVE);
    const chunks = fs.readdirSync(path.join(dir, 'dist')).filter((f) => f.endsWith('.js')).map((f) => `dist/${f}`);
    assert.ok(chunks.length > 0 && fs.existsSync(path.join(dir, 'dist/index.html')), 'dist/index.html + chunks');
    for (const f of [...chunks, 'dist-ssr/entry-server.js']) {
      const js = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!js.includes('SDK_DEFAULT_PRICETAG'), `${f} contains the replaced PriceTag default`);
      assert.ok(js.includes('BRAND_LOGO'), `${f} lacks the Logo override`);
    }
  });

  test('stunt-double check: exit 0', () => passes(cmd.check(base)));

  // regression (src/cli.mjs ADAPTERLESS): `bun build.ts` runs a Bun.build() script and is not the `bun build` CLI
  test('stunt-double doctor: passes on "bun build.ts"; still flags a bare `bun build` script', () => {
    const dir = project('doctor');
    passes(run(process.execPath, [sdCli(dir), 'doctor'], dir));
    const pkg = readJson(path.join(dir, 'package.json'));
    pkg.scripts['build:cli'] = 'bun build ./src/main.tsx --outdir dist';
    writeJson(path.join(dir, 'package.json'), pkg);
    fails(run(process.execPath, [sdCli(dir), 'doctor'], dir), /\[DOCTOR\] script "build:cli" runs a tool without a stunt-double adapter and without the gate/);
  });

  test('bun test (bun-test preload; no link, no paths) renders the overrides', () => {
    const r = cmd.test(project('positive-test'));
    passes(r);
    assert.match(r.out, /3 pass/, show(r));
  });

  test('bun test without the preload: fails CLOSED on the placeholder (adapter tier), renders via the link (universal)', () => {
    fails(cmd.testBare(project('positive-test-unwired')), /Cannot find module '\.\/STUNT-DOUBLE-NOT-WIRED/);
    const r = cmd.testBare(project('positive-test-bare', null, { universal: true }));
    passes(r);
    assert.match(r.out, /3 pass/, show(r));
  });

  test('a throw in the bun-test preload fails bun test (exit 1) and prints the [Fx] text', () => {
    const dir = project('preload-throw', (d) => fs.rmSync(path.join(d, 'src/overrides/Logo.tsx')));
    const r = cmd.test(dir);
    fails(r, /StuntDoubleError: stunt-double: 1 injection error \(@acme\/core@1\.0\.0\)\s+\[F3\] required slot "Logo" has no implementation/);
    assert.match(r.out, / 0 pass/, 'no test ran');
  });

  test('`bun build` CLI (no plugin): fails CLOSED on the placeholder (adapter tier); the link wires it (universal)', () => {
    fails(cmd.bare(project('positive-bare-unwired')), /Could not resolve: "\.\/STUNT-DOUBLE-NOT-WIRED/);
    const dir = project('positive-bare', null, { universal: true });
    passes(cmd.bare(dir));
    assertRender(cmd.probe(dir, 'dist-bare/entry-server.js'), POSITIVE);
  });

  // regression: Bun.build's `root` (output layout) is neither the project root nor the metafile base
  test('Bun.build({ root }) keeps the project root and the audit working', () => {
    const script = (hijack) => `import { stuntDoubleBun } from 'stunt-double/bun';
${hijack ? `const hijack = { name: 'hijack', setup(b: any) { b.onResolve({ filter: /^@acme\\/core-slots\\/Button$/ }, () => ({ path: require.resolve('@acme/core/original/Button', { paths: [require('node:path').dirname(require.resolve('@acme/core'))] }) })); } };` : ''}
await Bun.build({ entrypoints: ['./src/entry-server.tsx'], root: './src', outdir: './dist-ssr', target: 'node', format: 'esm', plugins: [${hijack ? 'hijack, ' : ''}stuntDoubleBun()] });
`;
    const dir = project('root-option', (d) => { write(d, 'ok.ts', script(false)); write(d, 'bad.ts', script(true)); });
    passes(run(BUN, ['ok.ts'], dir));
    assertRender(cmd.probe(dir), POSITIVE);
    fails(run(BUN, ['bad.ts'], dir), /\[F6\] @acme\/core imports @acme\/core-slots\/Button but \.stunt-double\/gen\/Button\.jsx is not in the bundle/);
  });

  // external rules (server targets): externalizing the SDK builds fine natively and fails only at boot, so the
  // adapter fails the build with [F6]; an external SOCKET alone is overridden by the plugin's onResolve [V].
  for (const target of ['node', 'bun']) for (const [name, extra, re] of [
    ["packages: 'external'", "packages: 'external'", /\[F6\] Bun\.build leaves "@acme\/core" external/],
    ["external: ['@acme/*']", "external: ['@acme/*']", /\[F6\] Bun\.build leaves "@acme\/core" external/],
    ["external: ['@acme/core-slots/*']", "external: ['@acme/core-slots/*']", null],
  ]) test(`target ${target}, ${name}: ${re ? '[F6] at build time' : 'the plugin wins, overrides render'}`, () => {
    const dir = project(`ext-${target}-${name.replace(/\W+/g, '')}`, (d) => write(d, 'ext.ts', `import { stuntDoubleBun } from 'stunt-double/bun';
await Bun.build({ entrypoints: ['./src/entry-server.tsx'], outdir: './dist-ssr', target: '${target}', format: 'esm', ${extra}, plugins: [stuntDoubleBun()] });
`));
    const r = run(BUN, ['ext.ts'], dir);
    if (re) {
      fails(r, re);
      assert.ok(!fs.existsSync(path.join(dir, 'dist-ssr/entry-server.js')), 'outputs removed');
    } else {
      passes(r);
      assertRender(target === 'node' ? cmd.probe(dir) : run(BUN, ['probes/render.mjs', 'dist-ssr/entry-server.js'], dir), POSITIVE);
    }
  });

  test('a runtime Bun.plugin onResolve (preload) never sees the SDK\'s bare socket specifiers', () => {
    const dir = project('runtime-plugin', (d) => {
      dropPreload(d); // only the hand-written runtime plugin below
      fs.writeFileSync(path.join(d, 'preload.ts'), `import { plugin } from 'bun';
plugin({ name: 'rt', setup(b) { b.onResolve({ filter: /^@acme\\/core-slots\\// }, (a) => { console.log('RUNTIME-ONRESOLVE ' + a.path); return { path: ${JSON.stringify(path.join(d, '.stunt-double/gen'))} + '/' + a.path.split('/').pop() + '.jsx' }; }); } });
`);
    });
    const r = run(BUN, ['test', '--preload', './preload.ts'], dir);
    // the bare specifier resolves natively to the placeholder; the runtime plugin is never asked
    fails(r, /Cannot find module '\.\/STUNT-DOUBLE-NOT-WIRED/);
    assert.doesNotMatch(r.out, /RUNTIME-ONRESOLVE/);
  });
});

describe('bun-test preload: rewriteSockets', { skip: !selected('positive') }, () => {
  test('rewrites only exact socket specifiers of known slots in module-request literals', async () => {
    const { rewriteSockets: fn } = await import('../packages/stunt-double/src/adapters/bun-rewrite.mjs');
    const src = `import { Button } from '@acme/core-slots/Button';
export { PriceTag } from "@acme/core-slots/PriceTag";
const L = () => import('@acme/core-slots/Logo');
import { X } from '@acme/core-slots/Unknown';
import '@acme/core-slots-extra/Button';
const s = '@acme/core-slots/Button';
`;
    const out = fn('/sdk/dist/index.js', src, '@acme/core-slots', (slot) => `/gen/${slot}.jsx`, ['Button', 'PriceTag', 'Logo']);
    assert.equal(out, `import { Button } from "/gen/Button.jsx";
export { PriceTag } from "/gen/PriceTag.jsx";
const L = () => import("/gen/Logo.jsx");
import { X } from '@acme/core-slots/Unknown';
import '@acme/core-slots-extra/Button';
const s = '@acme/core-slots/Button';
`);
    assert.equal(fn('/sdk/dist/x.js', `import React from 'react';\n`, '@acme/core-slots', (s) => s, ['Button']), null);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Dev server: `bun ./index.html` with bunfig.toml [serve.static] plugins = ["stunt-double/bun"].
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextPort = 4700 + (process.pid % 200);

function devServer(dir) {
  const port = nextPort++;
  const child = spawn(BUN, [`--port=${port}`, './index.html'], { cwd: dir, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://localhost:${port}`;
  const get = async (p = '/') => { try { const r = await fetch(url + p); return { status: r.status, body: await r.text() }; } catch { return { status: 0, body: '' }; } };
  /** the page and its client bundle */
  const page = async () => {
    const html = await get('/');
    const src = /<script[^>]+src="([^"]+\.js)"/.exec(html.body)?.[1];
    const js = src ? await get(src) : { status: 0, body: '' };
    return { status: html.status, js };
  };
  const until = async (what, fn, ms = 20_000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}\n--- dev server log ---\n${rel(log).slice(-3000)}`);
      await sleep(100);
    }
  };
  return { child, page, until, get log() { return log; }, stop: () => child.kill('SIGKILL') };
}

describe('dev server: bun ./index.html', { skip: !selected('dev') }, () => {
  test('renders the overrides; an injection error shows in Bun\'s error page and clears on fix', async () => {
    const dir = project('dev');
    const s = devServer(dir);
    try {
      const ok = await s.until('the page', async () => { const p = await s.page(); return p.status === 200 && p.js.status === 200 && p; });
      assert.match(ok.js.body, /BRAND_LOGO/);
      assert.doesNotMatch(ok.js.body, /SDK_DEFAULT_PRICETAG/);

      const logo = path.join(dir, 'src/overrides/Logo.tsx');
      const saved = fs.readFileSync(logo, 'utf8');
      fs.rmSync(logo);
      // the plugin's watcher poisons the shims; Bun rebuilds and serves its error page (HTTP 500)
      await s.until('the poisoned shims', () => fs.readFileSync(path.join(dir, '.stunt-double/gen/Button.jsx'), 'utf8').includes('STUNT-DOUBLE-ERROR -- [F3]'));
      const bad = await s.until('HTTP 500', async () => { const p = await s.page(); return p.status === 500 && p; });
      assert.equal(bad.status, 500);
      await s.until('[F3] on the dev server output', () => /\[F3\] required slot "Logo" has no implementation/.test(s.log) && /Could not resolve: "\.\/STUNT-DOUBLE-ERROR -- \[F3\]/.test(s.log));

      fs.writeFileSync(logo, saved);
      const fixed = await s.until('the fixed page', async () => { const p = await s.page(); return p.status === 200 && p.js.status === 200 && /BRAND_LOGO/.test(p.js.body) && p; });
      assert.match(fixed.js.body, /BRAND_LOGO/);
      assert.match(s.log, /stunt-double: injection errors fixed/);
    } finally { s.stop(); }
  });

  test('cold start with a mistake: the server stays up and serves the error page with the [Fx] line', async () => {
    const dir = project('dev-cold', (d) => fs.renameSync(path.join(d, 'src/overrides/Button.tsx'), path.join(d, 'src/overrides/Buton.tsx')));
    const s = devServer(dir);
    try {
      await s.until('HTTP 500', async () => (await s.page()).status === 500);
      await s.until('[F2] on the dev server output', () => /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton"/.test(s.log));
      assert.equal(s.child.exitCode, null, 'dev server still running');
    } finally { s.stop(); }
  });
});

// ---------------------------------------------------------------------------------------------------------
// Mutations. Cells: build = `bun build.ts` (T1), check = `stunt-double check`, test = `bun test` with the
// bun-test preload, dev = cold start of `bun ./index.html` — all on the adapter-tier example; bare = `bun build`
// CLI + run of its bundle, testBare = `bun test` without the preload — on the universal-tier copy (T0 bare).
// `tier: 'universal'` runs every cell on the universal copy; `bareTier: 'adapter'` runs bare cells unwired.
const F = (re) => (r) => fails(r, re);
const OK = (r) => passes(r);
const write = (d, f, s) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), s); };
const swapSdk = (tgz) => (d) => { setDep(d, '@acme/core', `file:${packs}/${tgz}`); const r = bunInstall(d); assert.equal(r.code, 0, show(r)); };

/** bare cell: the CLI build + probe on its output */
const bareRender = (expect) => (r, dir) => { passes(r); assertRender(cmd.probe(dir, 'dist-bare/entry-server.js'), expect); };
const bareCrash = (re) => (r, dir) => { passes(r); fails(cmd.probe(dir, 'dist-bare/entry-server.js'), re); };

/** dev cell: cold start of `bun ./index.html` with the mistake present */
const devErr = (re) => async (s) => {
  await s.until('HTTP 500 (Bun error page)', async () => (await s.page()).status === 500);
  await s.until(`${re} on the dev server output`, () => re.test(s.log) && /STUNT-DOUBLE-ERROR -- \[F/.test(s.log));
};
/** type errors never block dev: the page works, the gate prints to stderr */
const devOk = (re, js = /BRAND_BUTTON/) => async (s) => {
  const p = await s.until('HTTP 200', async () => { const r = await s.page(); return r.status === 200 && r.js.status === 200 && r; });
  assert.match(p.js.body, js);
  if (re) await s.until(`${re} on the dev server output`, () => re.test(s.log));
};

const MUTATIONS = [
  {
    id: 'F1a', test: F(/\[F1\] Logo/), dev: devOk(/\[F1\] Logo/), what: 'override adds a required prop (props incompatible)',
    apply: (d) => write(d, 'src/overrides/Logo.tsx', `import type { SlotProps } from '@acme/core/contracts';
export function Logo({ size, tone }: SlotProps['Logo'] & { tone: 'loud' }) {
  return <svg data-sd="BRAND_LOGO" data-tone={tone} width={size} />;
}
`),
    build: F(/\[F1\] Logo/), check: F(/\[F1\] Logo/),
    bare: bareRender({ sdk: { BRAND_LOGO: 1 } }), // R1: no bundler type-checks
    testBare: OK,
  },
  {
    id: 'F1b', test: F(/\[F1\] Button.*ignores these SDK props/), dev: devOk(/\[F1\] Button.*ignores these SDK props/), what: 'override ignores contract props',
    apply: (d) => write(d, 'src/overrides/Button.tsx', `import type { ReactNode } from 'react';
import { Button as Original } from '@acme/core/original/Button';
import { useTheme } from '../theme';
export function Button({ children }: { children?: ReactNode }) {
  return <span data-sd="BRAND_BUTTON" data-ctx={useTheme()}><Original>{children}</Original></span>;
}
`),
    build: F(/\[F1\] Button.*ignores these SDK props/), check: F(/\[F1\] Button.*ignores these SDK props/),
    bare: bareRender(POSITIVE), testBare: OK, // R1: onClick / variant silently dropped
  },
  {
    id: 'F1c', test: OK, dev: devOk(), what: 'must NOT fail: forwardRef / class overrides',
    apply: (d) => write(d, 'src/overrides/Button.tsx', `import { Component, forwardRef } from 'react';
import { Button as Original } from '@acme/core/original/Button';
import type { SlotProps } from '@acme/core/contracts';
import { useTheme } from '../theme';
class Frame extends Component<{ children?: React.ReactNode }> { render() { return this.props.children; } }
export const Button = forwardRef<HTMLButtonElement, Omit<SlotProps['Button'], 'ref'>>(function Button(props, ref) {
  const theme = useTheme();
  return <Frame><span data-sd="BRAND_BUTTON" data-ctx={theme}><Original {...props} ref={ref} /></span></Frame>;
});
`),
    build: OK, check: OK, bare: bareRender(POSITIVE), testBare: OK,
    render: POSITIVE,
  },
  {
    id: 'F2a', test: F(/\[F2\] src\/overrides\/Buton\.tsx/), dev: devErr(/\[F2\] src\/overrides\/Buton\.tsx/), what: 'typo: src/overrides/Buton.tsx',
    apply: (d) => fs.renameSync(path.join(d, 'src/overrides/Button.tsx'), path.join(d, 'src/overrides/Buton.tsx')),
    build: F(/\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/), check: F(/\[F2\]/),
    // R1, observed: the CLI/runtime use the PREVIOUS shim (installed gen/Button.jsx still imports Button.tsx,
    // which no longer exists) -> loud resolve error, not a silent default
    bare: F(/Could not resolve: "\.\.\/\.\.\/src\/overrides\/Button\.tsx"/), testBare: F(/Cannot find module '\.\.\/\.\.\/src\/overrides\/Button\.tsx'/),
  },
  {
    id: 'F2b', test: F(/RENAMED to "Price"/), dev: devErr(/RENAMED to "Price"/), what: 'SDK upgrade 1.0.0 -> 2.0.0: PriceTag renamed Price, new required Footer',
    apply: swapSdk('acme-core-2.0.0.tgz'),
    build: F(/\[F2\] src\/overrides\/PriceTag\.tsx: slot "PriceTag" was RENAMED to "Price"/), check: F(/RENAMED to "Price"/),
    // RES: the 2.0.0 SDK imports the new socket @acme/core-slots/Price, which the stale gen/ lacks
    bare: F(/Could not resolve: "@acme\/core-slots\/Price"/), testBare: F(/Cannot find module '@acme\/core-slots\/Price'/),
  },
  {
    id: 'F3', test: F(/\[F3\] required slot "Logo"/), dev: devErr(/\[F3\]/), what: 'required slot Logo not provided',
    apply: (d) => fs.rmSync(path.join(d, 'src/overrides/Logo.tsx')),
    build: F(/\[F3\] required slot "Logo" has no implementation/), check: F(/\[F3\]/),
    // RES: the previous shim imports the deleted file (after a fresh `gen`, the Logo shim is missing): loud
    bare: F(/Could not resolve: "\.\.\/\.\.\/src\/overrides\/Logo\.tsx"/), testBare: F(/Cannot find module '\.\.\/\.\.\/src\/overrides\/Logo\.tsx'/),
  },
  {
    id: 'F4', test: F(/\[F4\]/), dev: devErr(/\[F4\]/), what: 'two claims: Button.tsx + Button/index.tsx',
    apply: (d) => write(d, 'src/overrides/Button/index.tsx', `export { Button } from '../Button';\n`),
    build: F(/\[F4\] slot "Button" is claimed by 2 files/), check: F(/\[F4\]/),
    bare: bareRender(POSITIVE), testBare: OK, // R1: the previous shim (Button.tsx) keeps rendering
  },
  {
    id: 'F5', test: F(/\[F5\]/), dev: devErr(/\[F5\]/), what: 'wrong export: default instead of named Button',
    apply: (d) => {
      const f = path.join(d, 'src/overrides/Button.tsx');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('export function Button(', 'export default function Button('));
    },
    build: F(/\[F5\] src\/overrides\/Button\.tsx must export a named `Button` \(it exports: default\)/), check: F(/\[F5\]/),
    // Bun bundler: a missing named export is NOT a build error; the bundle crashes at render time (R1)
    // Bun bundler: `bun build` exits 0 and emits a reference to an undeclared binding -> crash at render.
    // Bun runtime (bun test): a link-time SyntaxError. Both runtime-only (R1): chain `stunt-double check &&`.
    bare: bareCrash(/ReferenceError: Button\d* is not defined/), testBare: F(/SyntaxError: export 'Button' not found in '\.\.\/\.\.\/src\/overrides\/Button\.tsx'/),
  },
  {
    id: 'F6a', test: F(/\[F6\] node_modules\/.*Checkout\.js/), dev: devErr(/\[F6\] node_modules\/.*Checkout\.js/), what: 'SDK file imports a slot default relatively (1.0.0-bad-relative)',
    apply: swapSdk('acme-core-1.0.0-bad-relative.tgz'),
    build: F(/\[F6\] node_modules\/.*Checkout\.js imports the default of slot "Button" directly/), check: F(/\[F6\]/),
    // R2: silent SDK default inside Checkout
    bare: bareRender({ sdk: { 'BRAND_BUTTON(dark)': 2, 'SDK_DEFAULT_BUTTON(in-cart)': 3 } }),
    testBare: F(/toHaveLength/), // only the example's own marker-count assertion notices
  },
  {
    id: 'F6b', what: 'a tool that was never wired: the `bun build` CLI / bun test without the preload, no link',
    bareTier: 'adapter', apply: null,
    build: OK, check: OK, test: OK, dev: devOk(),
    // RES: the registry placeholder answers the socket at resolve time — never a silent SDK default
    bare: F(/Could not resolve: "\.\/STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project/),
    testBare: F(/Cannot find module '\.\/STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project/),
  },
  {
    id: 'F6f', tier: 'universal', what: 'universal tier, link wired wrong: Bun "file:./sdk-slots" instead of "workspace:*"',
    apply: (d) => {
      const pkg = readJson(path.join(d, 'package.json'));
      delete pkg.workspaces;
      pkg.dependencies['@acme/core-slots'] = 'file:./sdk-slots';
      pkg.overrides = { '@acme/core-slots': `file:${packs}/acme-core-slots-0.0.1.tgz` }; // the registry stand-in
      writeJson(path.join(d, 'package.json'), pkg);
      bunInstall(d);
      // observed: Bun resolves the SDK's @acme/core-slots peer from the registry (here: the fixture's
      // "overrides" stand-in), never from the file: line, so the SDK sees the placeholder, not sdk-slots/
      const seen = path.join(fs.realpathSync(path.join(d, 'node_modules/@acme/core')), '..', 'core-slots', 'package.json');
      assert.equal(readJson(seen).stuntDouble?.placeholder, true);
    },
    build: F(/\[F6\] @acme\/core resolves @acme\/core-slots to node_modules\/@acme\/core-slots \(the registry placeholder.*not sdk-slots\/\. Use .*Bun "workspace:\*"/),
    check: F(/registry placeholder.*not sdk-slots/), test: F(/registry placeholder.*not sdk-slots/), dev: devErr(/registry placeholder/),
    // loud at resolve time (the placeholder), never a silent default
    bare: F(/STUNT-DOUBLE-NOT-WIRED/), testBare: F(/STUNT-DOUBLE-NOT-WIRED/),
  },
  {
    id: 'F6g', test: F(/\[F6\] src\/App\.tsx/), dev: devErr(/\[F6\] src\/App\.tsx/), what: 'bypass: app code imports @acme/core/original/Button',
    apply: (d) => {
      const f = path.join(d, 'src/App.tsx');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("import { Button, Checkout } from '@acme/core';", "import { Checkout } from '@acme/core';\nimport { Button } from '@acme/core/original/Button';"));
    },
    build: F(/\[F6\] src\/App\.tsx imports "@acme\/core\/original\/Button" outside src\/overrides/), check: F(/\[F6\] src\/App\.tsx/),
    // silent default at that call site (R1); only the example's own assertion notices
    bare: bareRender({ app: ['SDK_DEFAULT_BUTTON(none)'] }), testBare: F(/expect\(received\)\.toContain/),
  },
  {
    id: 'F6g-audit', what: 'a user plugin resolves the socket elsewhere (caught only by the AUD audit)',
    apply: (d) => {
      const f = path.join(d, 'build.ts');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('const sd = stuntDoubleBun();', `const sd = stuntDoubleBun();
const hijack = { name: 'hijack', setup(b: any) { b.onResolve({ filter: /^@acme\\/core-slots\\/Button$/ }, () => ({ path: require.resolve('@acme/core/original/Button', { paths: [require('node:path').dirname(require.resolve('@acme/core'))] }) })); } };`).replaceAll('plugins: [sd]', 'plugins: [hijack, sd]'));
    },
    build: (r, dir) => {
      fails(r, /\[F6\] .*imports the SDK default of slot "Button".*directly|\[F6\] @acme\/core imports @acme\/core-slots\/Button but \.stunt-double\/gen\/Button\.jsx is not in the bundle/);
      assert.ok(!fs.readdirSync(path.join(dir, 'dist')).some((f) => f.endsWith('.js')), 'the adapter removes the outputs of a failed audit');
    },
    check: OK, bare: null, testBare: null, // only a build-script plugin can do this
  },
  {
    id: 'F7', test: F(/\[F7\]/), dev: devErr(/\[F7\]/), what: 'override imports its own slot through the barrel',
    apply: (d) => write(d, 'src/overrides/PriceTag.tsx', `import { PriceTag as Base } from '@acme/core';
import type { SlotProps } from '@acme/core/contracts';
export function PriceTag(props: SlotProps['PriceTag']) {
  return <strong data-sd="BRAND_PRICE"><Base {...props} /></strong>;
}
`),
    build: F(/\[F7\]/), check: F(/\[F7\]/),
    // runtime infinite render (R1): Node runs out of heap, Bun (bun test) overflows the stack
    bare: bareCrash(/heap out of memory|Maximum call stack/), testBare: F(/RangeError: Maximum call stack size exceeded/),
  },
  {
    id: 'F8', test: F(/\[F8\] "react"/), dev: devErr(/\[F8\]/), what: 'duplicate React: the SDK bundles its own copy (1.0.0-nested-react)',
    apply: swapSdk('acme-core-1.0.0-nested-react.tgz'),
    build: F(/\[F8\] "react"/), check: F(/\[F8\]/),
    // runtime: two Reacts in one bundle / process (R1)
    bare: bareCrash(/Invalid hook call/), testBare: F(/dispatcher\.useContext/),
  },
  {
    id: 'F9b', test: F(/\[F9\]/), dev: devErr(/\[F9\]/), what: 'client-slot override imports "server-only"',
    apply: (d) => {
      // the real server-only@0.0.1 shape: throws unless resolved with the "react-server" condition
      write(d, 'node_modules/server-only/package.json', '{"name":"server-only","version":"0.0.1","main":"index.js","exports":{".":{"react-server":"./empty.js","default":"./index.js"}}}');
      write(d, 'node_modules/server-only/index.js', 'throw new Error("This module cannot be imported from a Client Component module. It should only be used from a Server Component.");\n');
      write(d, 'node_modules/server-only/empty.js', '');
      const f = path.join(d, 'src/overrides/Logo.tsx');
      fs.writeFileSync(f, `import 'server-only';\n` + fs.readFileSync(f, 'utf8'));
    },
    build: F(/\[F9\] src\/overrides\/Logo\.tsx imports "server-only"/), check: F(/\[F9\]/),
    bare: bareCrash(/cannot be imported from a Client Component/), testBare: F(/cannot be imported from a Client Component/),
  },
  {
    id: 'F9c', test: F(/\[F9\]/), dev: devOk(/\[F9\]/), what: 'async (server-shaped) override in a client slot',
    apply: (d) => write(d, 'src/overrides/Logo.tsx', `import type { SlotProps } from '@acme/core/contracts';
export async function Logo({ size = 32 }: SlotProps['Logo']) {
  await Promise.resolve();
  return <svg data-sd="BRAND_LOGO" width={size} />;
}
`),
    build: F(/\[F9\]/), check: F(/\[F9\]/),
    bare: bareCrash(/A component suspended while responding to synchronous input/), testBare: F(/A component suspended/),
  },
  {
    id: 'F6h', test: F(/Expected to not contain: "SDK_DEFAULT_PRICETAG"/), dev: devOk(null, /SDK_DEFAULT_PRICETAG/), what: 'stale shims: override removed without regenerating',
    apply: (d) => fs.rmSync(path.join(d, 'src/overrides/PriceTag.tsx')),
    // T1 regenerates at every Bun.build: the SDK default now renders, as declared
    build: (r, dir) => { passes(r); assertRender(cmd.probe(dir), { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } }); },
    check: OK,
    // the previous shim imports the deleted file: loud
    bare: F(/Could not resolve: "\.\.\/\.\.\/src\/overrides\/PriceTag\.tsx"/), testBare: F(/Cannot find module '\.\.\/\.\.\/src\/overrides\/PriceTag\.tsx'/),
  },
];

describe('mutations (Bun 1.4)', () => {
  for (const m of MUTATIONS) {
    if (!selected(m.id)) continue;
    describe(`${m.id}: ${m.what}`, () => {
      let dir;
      const uni = (cell) => m.tier === 'universal' || (['bare', 'testBare'].includes(cell) && m.bareTier !== 'adapter');
      before(() => { if (m.bare || m.testBare) dir = project(`m-${m.id}`, m.apply, { universal: uni('bare') }); });
      if (m.dev) test('dev', async () => {
        const s = devServer(project(`m-${m.id}-dev`, m.apply, { universal: uni('dev') }));
        try { await m.dev(s); } finally { s.stop(); }
      });
      for (const cell of ['build', 'check', 'bare', 'test', 'testBare']) {
        if (!m[cell]) continue;
        test(cell, () => {
          // `check` regenerates; run it on its own copy so it never "fixes" the stale cells
          const d = ['check', 'build', 'test'].includes(cell) ? project(`m-${m.id}-${cell}`, m.apply, { universal: uni(cell) }) : dir;
          m[cell](cmd[cell](d), d);
        });
      }
    });
  }
});
