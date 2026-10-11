// Next.js 16 suite: examples/customer-next built with Turbopack (default) and --webpack, in real Chromium, and
// under `stunt-double watch -- next dev`. Run `npm run setup` first. node --test tests/next.test.mjs
//
// Every expectation below was observed for real (see docs/tools/next.md). The app is installed ONCE from the
// .packs/ tarballs into a temp dir; every case works on a copy with hard-linked node_modules.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { summarize, compareRender } from './harness/markers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_SRC = path.join(REPO, 'examples/customer-next');
const PACKS = path.join(REPO, '.packs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-next-'));
const BASE = path.join(TMP, 'base');
const ENV = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
const BUNDLERS = ['turbopack', 'webpack'];
const KEEP = !!process.env.KEEP_TMP;
let nextPort = 3400 + (process.pid % 200) * 3;

// ---------------------------------------------------------------------------------------------------------
// fixtures

function copyApp(name) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  for (const f of fs.readdirSync(BASE)) {
    if (f === '.next') continue;
    if (f === 'node_modules') execFileSync('cp', ['-al', path.join(BASE, f), path.join(dir, f)]);
    else fs.cpSync(path.join(BASE, f), path.join(dir, f), { recursive: true, verbatimSymlinks: true });
  }
  const api = {
    dir,
    file: (f) => path.join(dir, f),
    read: (f) => fs.readFileSync(path.join(dir, f), 'utf8'),
    write: (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); },
    rm: (f) => fs.rmSync(path.join(dir, f), { recursive: true, force: true }),
    edit: (f, from, to) => { const s = api.read(f); assert.ok(s.includes(from), `${f} should contain ${from}`); api.write(f, s.replace(from, to)); },
  };
  return api;
}

function build(app, bundler) {
  fs.rmSync(app.file('.next'), { recursive: true, force: true });
  const t = Date.now();
  const r = spawnSync(process.execPath, [app.file('node_modules/next/dist/bin/next'), 'build', ...(bundler === 'webpack' ? ['--webpack'] : [])], { cwd: app.dir, env: ENV, encoding: 'utf8', timeout: 300_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}`, ms: Date.now() - t };
}

const page = (app, route) => fs.readFileSync(app.file(route === '/' ? '.next/server/app/index.html' : route === '/legacy' ? '.next/server/pages/legacy.html' : `.next/server/app${route}.html`), 'utf8');

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.join(d.parentPath ?? d.path, d.name));
}
const grepFiles = (dir, needle) => filesUnder(dir).filter((f) => /\.(js|html|rsc|json)$/.test(f) && fs.readFileSync(f, 'utf8').includes(needle));

function freePort() { return nextPort++; }

/** Start a long-running process in its own process group (next spawns children). */
function startProc(cwd, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...ENV, ...extraEnv }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return { child, get log() { return log; }, stop: () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} return new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); setTimeout(r, 3000); }); } };
}

async function get(port, route) {
  try { const r = await fetch(`http://localhost:${port}${route}`); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; }
}

async function until(port, route, pred, ms = 30_000) {
  const t = Date.now();
  let last;
  while (Date.now() - t < ms) {
    last = await get(port, route);
    if (pred(last)) return { ...last, ms: Date.now() - t };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ...last, ms: Date.now() - t, timedOut: true };
}

const markersOf = (text) => summarize(text).all;
const has = (...m) => (r) => r.status === 200 && m.every((x) => markersOf(r.text).some((t) => t.split('(')[0] === x));
const lacks = (...m) => (r) => r.status === 200 && m.every((x) => !markersOf(r.text).some((t) => t.split('(')[0] === x));
const both = (a, b) => (r) => a(r) && b(r);

function loadPlaywright() {
  const roots = [REPO, execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()];
  for (const r of roots) { try { return createRequire(path.join(r, 'noop.js'))('playwright'); } catch {} }
  throw new Error('playwright is required for the browser checks: npm i -g playwright (browsers: npx playwright install chromium)');
}

// ---------------------------------------------------------------------------------------------------------
// install once

before(() => {
  for (const t of ['stunt-double-0.1.0.tgz', 'acme-core-1.0.0.tgz'])
    assert.ok(fs.existsSync(path.join(PACKS, t)), `missing .packs/${t}: run npm run setup`);
  fs.mkdirSync(BASE);
  for (const f of fs.readdirSync(APP_SRC)) {
    if (['node_modules', '.next', 'package-lock.json', 'next-env.d.ts'].includes(f)) continue;
    fs.cpSync(path.join(APP_SRC, f), path.join(BASE, f), { recursive: true, filter: (s) => !/[\\/]sdk-slots[\\/]gen([\\/]|$)|stunt-double\.check\.ts$/.test(s) });
  }
  // file: specs relative to the example dir -> absolute (the copy lives elsewhere)
  const pkg = JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8'));
  for (const deps of [pkg.dependencies, pkg.devDependencies])
    for (const [k, v] of Object.entries(deps ?? {})) if (v.startsWith('file:../')) deps[k] = 'file:' + path.resolve(APP_SRC, v.slice(5));
  fs.writeFileSync(path.join(BASE, 'package.json'), JSON.stringify(pkg, null, 2));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: BASE, env: ENV, stdio: ['ignore', 'pipe', 'inherit'], timeout: 600_000 });
  assert.ok(fs.existsSync(path.join(BASE, 'sdk-slots/gen/Button.jsx')), 'postinstall should have generated the shims');
});

after(() => { if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true }); else console.log('kept', TMP); });

// ---------------------------------------------------------------------------------------------------------
// positive: prerendered HTML, client chunks, default elimination, Chromium hydration

const SSR_EXPECT = {
  '/': {
    app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
    sdk: { 'BRAND_BUTTON(dark)': 3, BRAND_PRICE: 3, BRAND_LOGO: 1, SDK_DEFAULT_PRICETAG: 0, 'SDK_DEFAULT_BUTTON(in-cart)': 3 },
  },
  '/client': { app: ['BRAND_BUTTON(light)', 'SDK_DEFAULT_BUTTON(none)'] },
  '/legacy': {
    app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
    sdk: { 'BRAND_BUTTON(dark)': 3, BRAND_PRICE: 3, BRAND_LOGO: 1, SDK_DEFAULT_PRICETAG: 0 },
  },
};

for (const bundler of BUNDLERS) {
  describe(`next build (${bundler}): customer-next`, () => {
    let app;
    let res;
    before(() => { app = copyApp(`ok-${bundler}`); res = build(app, bundler); });

    test('build succeeds and runs the slot contract gate', () => {
      assert.equal(res.code, 0, res.out);
      assert.match(res.out, /Completed runAfterProductionCompile/, 'the stunt-double type gate ran');
    });

    test('prerendered HTML carries the overrides (App Router server page, client page, Pages Router)', () => {
      for (const [route, expect] of Object.entries(SSR_EXPECT)) {
        const errors = compareRender(summarize(page(app, route)), expect);
        assert.deepEqual(errors, [], `${route}: ${errors.join('; ')}`);
      }
    });

    test('client chunks carry the overrides; the replaced default is in no output file', () => {
      const chunks = app.file('.next/static');
      for (const m of ['BRAND_BUTTON', 'BRAND_PRICE', 'BRAND_LOGO']) assert.ok(grepFiles(chunks, m).length > 0, `${m} in client chunks`);
      assert.deepEqual(grepFiles(app.file('.next'), 'SDK_DEFAULT_PRICETAG').map((f) => path.relative(app.dir, f)), []);
    });

    test('Chromium: hydrates without warnings, overrides stay, app and SDK buttons are interactive', async () => {
      const { chromium } = loadPlaywright();
      const port = freePort();
      const srv = startProc(app.dir, [app.file('node_modules/next/dist/bin/next'), 'start', '-p', String(port)]);
      const browser = await chromium.launch();
      try {
        assert.ok(!(await until(port, '/', (r) => r.status === 200)).timedOut, srv.log);
        for (const route of ['/', '/client', '/legacy']) {
          const p = await browser.newPage();
          const logs = [];
          p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
          p.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
          p.on('response', (r) => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`); });
          await p.goto(`http://localhost:${port}${route}`, { waitUntil: 'networkidle' });
          const html = await p.content();
          assert.deepEqual(compareRender(summarize(html), SSR_EXPECT[route]), [], `${route} after hydration`);
          if (route === '/client') {
            await p.click('[data-probe="app"] button');
            await p.click('[data-probe="app"] button');
            assert.equal(await p.textContent('[data-probe="clicks"]'), '2', 'app-level Button override is interactive');
          } else {
            assert.equal(await p.textContent('.acme-summary span'), '1 in cart');
            await p.click('[data-probe="sdk"] .acme-product:last-of-type button');
            await p.waitForFunction(() => document.querySelector('.acme-summary span')?.textContent === '2 in cart', null, { timeout: 5000 });
          }
          assert.deepEqual(logs, [], `${route}: console errors / hydration warnings`);
          await p.close();
        }
      } finally { await browser.close(); await srv.stop(); }
    });
  });
}

// ---------------------------------------------------------------------------------------------------------
// mistakes: per bundler, where each one fails and with what message

const CONFIG_LOAD = /Failed to load next\.config\.mjs/;
const TYPE_GATE = /Failed to run runAfterProductionCompile: stunt-double: \d+ injection errors? \(@acme\/core@1\.0\.0\)/;
const MUTATIONS = [
  {
    id: 'F1a', what: 'override needs a prop the SDK never passes',
    apply: (a) => a.edit('src/overrides/Button.tsx', "props: SlotProps['Button']", "props: SlotProps['Button'] & { tone: 'loud' }"),
    expect: { stage: TYPE_GATE, text: /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322 .*tone/ },
  },
  {
    id: 'F1b', what: 'override ignores contract props',
    apply: (a) => a.write('src/overrides/PriceTag.tsx', `export function PriceTag({ amount }: { amount: number }) { return <b data-sd="BRAND_PRICE">{amount}</b>; }\n`),
    expect: { stage: TYPE_GATE, text: /\[F1\] PriceTag \(src\/overrides\/PriceTag\.tsx\): override ignores these SDK props: "currency"/ },
  },
  {
    id: 'F2', what: 'typo / stray file in src/overrides',
    apply: (a) => a.write('src/overrides/Buton.tsx', 'export function Buton() { return null; }\n'),
    expect: { stage: CONFIG_LOAD, text: /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/ },
  },
  {
    id: 'F3', what: 'required slot not provided',
    apply: (a) => a.rm('src/overrides/Logo.tsx'),
    expect: { stage: CONFIG_LOAD, text: /\[F3\] required slot "Logo" has no implementation/ },
  },
  {
    id: 'F4', what: 'slot claimed by two files',
    apply: (a) => a.write('src/overrides/Button/index.tsx', "export { Button } from '../Button';\n"),
    expect: { stage: CONFIG_LOAD, text: /\[F4\] slot "Button" is claimed by 2 files/ },
  },
  {
    id: 'F5', what: 'default export instead of the named one',
    apply: (a) => a.write('src/overrides/PriceTag.tsx', a.read('src/overrides/PriceTag.tsx').replace('export const PriceTag', 'const PriceTag') + '\nexport default PriceTag;\n'),
    expect: { stage: CONFIG_LOAD, text: /\[F5\] src\/overrides\/PriceTag\.tsx must export a named `PriceTag` \(it exports: default\)/ },
  },
  {
    id: 'F6g', what: 'app code imports @acme/core/original/X',
    apply: (a) => a.write('src/app/page.tsx', "import { Button as B } from '@acme/core/original/Button';\n" + a.read('src/app/page.tsx').replace('<h1>', '<B>x</B><h1>')),
    expect: { stage: CONFIG_LOAD, text: /\[F6\] src\/app\/page\.tsx imports "@acme\/core\/original\/Button" outside src\/overrides/ },
  },
  {
    id: 'F6-audit', what: 'a later config wrapper re-aliases a socket to the SDK default',
    apply: (a) => a.write('next.config.mjs', [
      "import path from 'node:path';",
      "import { withStuntDouble } from 'stunt-double/next';",
      'const c = withStuntDouble({});',
      'const wp = c.webpack;',
      "c.webpack = (conf, ctx) => { const x = wp(conf, ctx); x.resolve.alias['@acme/core-slots/PriceTag$'] = path.resolve('node_modules/@acme/core/dist/original/PriceTag.js'); return x; };",
      'export default c;', ''].join('\n')),
    expect: {
      webpack: { stage: /Failed to compile/, text: /\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but sdk-slots\/gen\/PriceTag\.jsx is not in the bundle/ },
      // the mutation is webpack-only config; Turbopack is unaffected and stays correct
      turbopack: { ok: true, html: { sdk: { BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0 } } },
    },
  },
  {
    id: 'F7', what: 'override imports its own slot through the barrel',
    apply: (a) => a.write('src/overrides/PriceTag.tsx', "import { PriceTag as P } from '@acme/core';\nimport type { SlotProps } from '@acme/core/contracts';\nexport function PriceTag(props: SlotProps['PriceTag']) { return <P {...props} />; }\n"),
    expect: { stage: CONFIG_LOAD, text: /\[F7\] src\/overrides\/PriceTag\.tsx imports \{ PriceTag \} from "@acme\/core": that is slot "PriceTag" itself/ },
  },
  {
    id: 'F9a', what: 'the shims\' "use client" switched off ("rsc": false): hook-using override in a Server Component tree',
    apply: (a) => a.write('stunt-double.config.json', JSON.stringify({ sdk: '@acme/core', rsc: false })),
    expect: { stage: /Error occurred prerendering page "\/"/, text: /Attempted to call useTheme\(\) from the server/ },
  },
  {
    id: 'F9b', what: 'server-only imported by a client-slot override',
    apply: (a) => a.write('src/overrides/PriceTag.tsx', "import 'server-only';\n" + a.read('src/overrides/PriceTag.tsx')),
    expect: { stage: CONFIG_LOAD, text: /\[F9\] src\/overrides\/PriceTag\.tsx imports "server-only" but "PriceTag" is a client slot/ },
  },
  {
    id: 'F9b-transitive', what: 'server-only imported by a helper of a client-slot override',
    apply: (a) => {
      a.write('src/overrides/_secret.ts', "import 'server-only';\nexport const secret = 1;\n");
      a.write('src/overrides/PriceTag.tsx', "import { secret } from './_secret';\n" + a.read('src/overrides/PriceTag.tsx').replace('{currency}', '{currency}{secret}'));
    },
    expect: { stage: CONFIG_LOAD, text: /\[F9\] src\/overrides\/PriceTag\.tsx -> src\/overrides\/_secret\.ts imports "server-only"/ },
  },
  {
    id: 'F9c', what: 'async override in a client slot',
    apply: (a) => a.write('src/overrides/Logo.tsx', "import type { SlotProps } from '@acme/core/contracts';\nexport async function Logo({ size = 32 }: SlotProps['Logo']) { await Promise.resolve(); return <svg data-sd=\"BRAND_LOGO\" width={size} />; }\n"),
    expect: { stage: TYPE_GATE, text: /\[F9\] Logo \(src\/overrides\/Logo\.tsx\): client slot override must not be an async component/ },
  },
  {
    id: 'X1+F1b', what: 'typescript.ignoreBuildErrors does not switch off the slot contract gate',
    apply: (a) => {
      a.edit('next.config.mjs', 'reactStrictMode: true,', 'reactStrictMode: true, typescript: { ignoreBuildErrors: true },');
      a.write('src/overrides/PriceTag.tsx', `export function PriceTag({ amount }: { amount: number }) { return <b data-sd="BRAND_PRICE">{amount}</b>; }\n`);
    },
    expect: { stage: TYPE_GATE, text: /\[F1\] PriceTag \(src\/overrides\/PriceTag\.tsx\): override ignores these SDK props: "currency"/ },
  },
  {
    id: 'X2+F9c', what: 'the app tsconfig does not include the check file: the gate still runs',
    apply: (a) => {
      a.write('tsconfig.json', a.read('tsconfig.json').replace('"src/**/*.ts", ', '').replace(/,\s*"files": \[[^\]]*\]/, ''));
      a.write('src/overrides/Logo.tsx', "import type { SlotProps } from '@acme/core/contracts';\nexport async function Logo({ size = 32 }: SlotProps['Logo']) { await Promise.resolve(); return <svg data-sd=\"BRAND_LOGO\" width={size} />; }\n");
    },
    expect: { stage: TYPE_GATE, text: /\[F9\] Logo \(src\/overrides\/Logo\.tsx\): client slot override must not be an async component/ },
  },
  {
    id: 'TS7-api', what: 'TypeScript 7 with experimental.useTypeScriptCli: false',
    apply: (a) => a.edit('next.config.mjs', 'reactStrictMode: true,', 'reactStrictMode: true, experimental: { useTypeScriptCli: false },'),
    expect: { stage: /TypeScript 7\.\d+\.\d+ does not provide the compiler API required by Next\.js/, text: /useTypeScriptCli/ },
  },
];

for (const m of MUTATIONS) {
  describe(`mistake ${m.id}: ${m.what}`, () => {
    for (const bundler of BUNDLERS) {
      test(bundler, () => {
        const exp = m.expect[bundler] ?? m.expect;
        const app = copyApp(`m-${m.id}-${bundler}`);
        m.apply(app);
        const r = build(app, bundler);
        try {
          if (exp.ok) {
            assert.equal(r.code, 0, r.out);
            assert.deepEqual(compareRender(summarize(page(app, '/')), exp.html), []);
            return;
          }
          assert.notEqual(r.code, 0, `expected next build to fail:\n${r.out}`);
          assert.match(r.out, exp.stage);
          assert.match(r.out, exp.text);
          if (exp.stage === CONFIG_LOAD) assert.ok(r.ms < 30_000, 'config-load failures happen before compiling');
        } finally { if (!KEEP) fs.rmSync(app.dir, { recursive: true, force: true }); }
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------
// TypeScript 5.9 as the gate compiler (CLI default and Next's programmatic API)

describe('TypeScript 5.9.3', () => {
  let ts59;
  before(() => {
    ts59 = path.join(TMP, 'ts59');
    fs.mkdirSync(ts59);
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--prefix', ts59, 'typescript@5.9.3'], { env: ENV, stdio: ['ignore', 'pipe', 'inherit'] });
  });
  const withTs59 = (name) => {
    const app = copyApp(name);
    app.rm('node_modules/typescript');
    fs.cpSync(path.join(ts59, 'node_modules/typescript'), app.file('node_modules/typescript'), { recursive: true });
    for (const b of ['tsc', 'tsserver']) { app.rm(`node_modules/.bin/${b}`); fs.symlinkSync(`../typescript/bin/${b}`, app.file(`node_modules/.bin/${b}`)); }
    return app;
  };
  test('builds and renders the overrides', () => {
    const app = withTs59('ts59-ok');
    const r = build(app, 'turbopack');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(compareRender(summarize(page(app, '/')), SSR_EXPECT['/']), []);
  });
  test('F1a fails the type check (CLI)', () => {
    const app = withTs59('ts59-f1');
    MUTATIONS.find((x) => x.id === 'F1a').apply(app);
    const r = build(app, 'turbopack');
    assert.notEqual(r.code, 0);
    assert.match(r.out, TYPE_GATE);
    assert.match(r.out, /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322 .*\(tsc 5\.9\.3, \d+ ms\)/);
  });
  test('F9c fails the gate with Next on its programmatic TS API (useTypeScriptCli: false)', () => {
    const app = withTs59('ts59-f9c-api');
    MUTATIONS.find((x) => x.id === 'F9c').apply(app);
    app.edit('next.config.mjs', 'reactStrictMode: true,', 'reactStrictMode: true, experimental: { useTypeScriptCli: false },');
    const r = build(app, 'turbopack');
    assert.notEqual(r.code, 0);
    assert.match(r.out, TYPE_GATE);
    assert.match(r.out, /\[F9\] Logo \(src\/overrides\/Logo\.tsx\): client slot override must not be an async component.*\(tsc 5\.9\.3/);
  });
});

// ---------------------------------------------------------------------------------------------------------
// next dev / next start

describe('next dev', () => {
  test('a mistake present at startup fails `next dev` (exit 1, [F2] message)', () => {
    const app = copyApp('dev-start-fail');
    MUTATIONS.find((x) => x.id === 'F2').apply(app);
    const r = spawnSync(process.execPath, [app.file('node_modules/next/dist/bin/next'), 'dev', '-p', String(freePort())], { cwd: app.dir, env: ENV, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot/);
  });

  for (const [bundler, watch] of [['turbopack', true], ['webpack', true], ['webpack', false]]) {
    test(`${watch ? 'stunt-double watch -- ' : ''}next dev${bundler === 'webpack' ? ' --webpack' : ''}: add / remove / swap live; typo -> HTTP 500 with the poison text, cleared on fix`, async () => {
      const app = copyApp(`dev-${bundler}-${watch}`);
      const port = freePort();
      const next = [app.file('node_modules/next/dist/bin/next'), 'dev', '-p', String(port), ...(bundler === 'webpack' ? ['--webpack'] : [])];
      const srv = startProc(app.dir, watch ? [app.file('node_modules/stunt-double/bin/stunt-double.mjs'), 'watch', '--', process.execPath, ...next] : next);
      const step = async (label, route, pred, ms) => {
        const r = await until(port, route, pred, ms);
        assert.ok(!r.timedOut, `${label}: HTTP ${r.status} ${markersOf(r.text).join(' ')}\n--- log ---\n${srv.log.slice(-3000)}`);
        return r;
      };
      try {
        await step('cold start', '/', has('BRAND_PRICE', 'BRAND_LOGO'), 120_000);
        await step('cold start (pages router)', '/legacy', has('BRAND_PRICE'), 120_000);
        const price = app.read('src/overrides/PriceTag.tsx');
        app.rm('src/overrides/PriceTag.tsx');
        await step('remove PriceTag -> SDK default', '/', both(has('SDK_DEFAULT_PRICETAG'), lacks('BRAND_PRICE')));
        await step('remove PriceTag (pages router)', '/legacy', both(has('SDK_DEFAULT_PRICETAG'), lacks('BRAND_PRICE')));
        app.write('src/overrides/PriceTag.tsx', price);
        await step('add PriceTag back', '/', both(has('BRAND_PRICE'), lacks('SDK_DEFAULT_PRICETAG')));
        await step('add PriceTag back (pages router)', '/legacy', both(has('BRAND_PRICE'), lacks('SDK_DEFAULT_PRICETAG')));
        const btn = app.read('src/overrides/Button.tsx');
        app.rm('src/overrides/Button.tsx');
        app.write('src/overrides/Button/index.tsx', "import type { SlotProps } from '@acme/core/contracts';\nexport function Button({ children, onClick }: SlotProps['Button']) { return <button data-sd=\"SWAPPED_BUTTON\" onClick={onClick}>{children}</button>; }\n");
        await step('swap Button -> Button/index.tsx', '/', both(has('SWAPPED_BUTTON'), lacks('BRAND_BUTTON', 'SDK_DEFAULT_BUTTON')));
        app.rm('src/overrides/Button');
        app.write('src/overrides/Button.tsx', btn);
        await step('swap back', '/', both(has('BRAND_BUTTON'), lacks('SWAPPED_BUTTON')));
        app.write('src/overrides/Buton.tsx', 'export function Buton() { return null; }\n');
        const poisoned = (r) => r.status === 500 && /STUNT-DOUBLE-ERROR -- \[F2\] src overrides Buton\.tsx overrides unknown slot Buton/.test(r.text);
        await step('typo -> HTTP 500 with the poison text', '/', poisoned);
        app.rm('src/overrides/Buton.tsx');
        await step('typo fixed', '/', has('BRAND_BUTTON', 'BRAND_PRICE'));
        await step('typo fixed (pages router)', '/legacy', has('BRAND_BUTTON', 'BRAND_PRICE'));
      } finally { await srv.stop(); }
    });
  }

  test('known gap (Next 16.4 Turbopack dev): an error a Pages Router route saw sticks to App Router routes until that route is requested again', async () => {
    // Not specific to stunt-double: any compile error in a module shared by both routers does this. If this test
    // starts failing, Next fixed it: delete the test and the "Known gaps" entry in docs/tools/next.md.
    const app = copyApp('dev-turbopack-gap');
    const port = freePort();
    const srv = startProc(app.dir, [app.file('node_modules/stunt-double/bin/stunt-double.mjs'), 'watch', '--', process.execPath, app.file('node_modules/next/dist/bin/next'), 'dev', '-p', String(port)]);
    try {
      assert.ok(!(await until(port, '/', has('BRAND_PRICE'), 120_000)).timedOut, srv.log);
      app.write('src/overrides/Buton.tsx', 'export function Buton() { return null; }\n');
      assert.ok(!(await until(port, '/', (r) => r.status === 500)).timedOut);
      assert.ok(!(await until(port, '/legacy', (r) => r.status === 500)).timedOut);
      app.rm('src/overrides/Buton.tsx');
      const stuck = await until(port, '/', (r) => r.status === 200, 8000);
      assert.ok(stuck.timedOut && /STUNT-DOUBLE-ERROR/.test(stuck.text), `App Router recovered on its own (HTTP ${stuck.status}): Next fixed the gap`);
      assert.ok(!(await until(port, '/legacy', (r) => r.status === 200)).timedOut, 'requesting the Pages Router route recompiles it');
      assert.ok(!(await until(port, '/', has('BRAND_BUTTON'))).timedOut, 'and the App Router route recovers');
    } finally { await srv.stop(); }
  });
});

describe('next start', () => {
  test('serves the validated build; does not re-validate or rewrite shims (source changed after the build)', async () => {
    const app = copyApp('start');
    assert.equal(build(app, 'turbopack').code, 0);
    app.write('src/overrides/Buton.tsx', 'export function Buton() { return null; }\n');
    const shim = app.read('sdk-slots/gen/Button.jsx');
    const port = freePort();
    const srv = startProc(app.dir, [app.file('node_modules/next/dist/bin/next'), 'start', '-p', String(port)]);
    try {
      const r = await until(port, '/', (x) => x.status === 200, 30_000);
      assert.ok(!r.timedOut, srv.log);
      assert.deepEqual(compareRender(summarize(r.text), SSR_EXPECT['/']), []);
      assert.equal(app.read('sdk-slots/gen/Button.jsx'), shim);
    } finally { await srv.stop(); }
  });
});
