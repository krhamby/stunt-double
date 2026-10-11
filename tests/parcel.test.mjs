// Parcel 2.16: fixture examples/customer-parcel (the default Parcel setup: the stunt-double/parcel resolver
// plugin through a two-line local file in .parcelrc, package exports on, no link). Runs the shared catalogue
// against a BARE `parcel build`, a Parcel dev-server probe and the universal tier (`init --universal` link,
// no plugin, `stunt-double check && parcel build`). Extra cases below the suite: R5 ("use client" and duplicate
// React: bundle inspection + headless Chromium + the node isLibrary:false crash), warm .parcel-cache
// correctness, `stunt-double doctor`, dev servers in the universal tier and the residuals of a bare universal
// build. See tests/README.md and docs/tools/parcel.md.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  defineToolSuite, universalTransform, Fixture, byId, STANDARD_RENDER,
  assertFailed, assertPassed, assertMessages, assertRender, assertBundle,
} from './harness/index.mjs';

const FIXTURE = 'examples/customer-parcel';
// Parcel's CLI reporter wraps diagnostics at the terminal width (80 columns without a TTY), which would split
// the [Fx] lines the shared regexes match on one line. term-size reads COLUMNS/LINES.
const PARCEL = 'COLUMNS=1000 LINES=50 parcel';
const BUILD = `${PARCEL} build`;
// The same app without the plugin: Parcel's default config resolves the registry placeholder.
const UNWIRED_PARCELRC = '{ "extends": "@parcel/config-default" }\n';
const UNIVERSAL_FILES = { '.parcelrc': UNWIRED_PARCELRC };
const OUTPUTS = ['dist', 'dist-ssr', '.parcel-cache'];
const MINUTE = 60_000;

// ---- dev server ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start `cmd` (a Parcel dev server on `port`) in the fixture app; returns helpers to drive and stop it. */
async function startDev(fx, cmd, port) {
  let log = '';
  const child = spawn('sh', ['-c', cmd], {
    cwd: fx.app, detached: true,
    env: { ...process.env, PATH: `${path.join(fx.app, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}`, FORCE_COLOR: '0', NO_COLOR: '1', COLUMNS: '1000', LINES: '50' },
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const stop = async () => {
    // Parcel writes its cache on SIGTERM after sh has exited: wait for the whole process group.
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    const t = Date.now();
    while (Date.now() - t < 20_000) { try { process.kill(-child.pid, 0); } catch { return; } await sleep(100); }
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  };
  const waitFor = async (re, from, ms = 30_000) => {
    const t = Date.now();
    while (Date.now() - t < ms) { if (re.test(log.slice(from))) return; await sleep(100); }
    throw new Error(`dev: timed out waiting for ${re}; output since the change:\n${log.slice(from).slice(-3000)}`);
  };
  const base = `http://127.0.0.1:${port}`;
  const page = async () => (await (await fetch(`${base}/`)).text()).replaceAll('&quot;', '"').replaceAll('&#39;', "'");
  const bundle = async () => {
    const src = /<script[^>]*src="?\/([^"\s>]+\.js)/.exec(await page())?.[1];
    return src ? (await fetch(`${base}/${src}`)).text() : '';
  };
  try { await waitFor(/Built in/, 0, 90_000); } catch (e) { await stop(); throw e; }
  return { log: () => log, waitFor, page, bundle, stop };
}

const APP_PAGE = /<div id="?root"?><\/div>/;
const ERROR_PAGE = /Parcel encountered errors/;

/**
 * The developer's loop against a running dev server: add/remove an override switches what is served without a
 * restart (unless `switches: false`: nothing regenerates); then per mistake `expect[id]` is a RegExp (the build fails with it in the terminal AND on the dev
 * error page, and the next save after the fix is clean, no restart) or 'silent' (documented: nothing reported).
 */
async function devLoop(fx, t, { cmd, expect, switches = true }) {
  const port = 41000 + Math.floor(Math.random() * 4000);
  const dev = await startDev(fx, `${cmd} --target app --port ${port} --host 127.0.0.1`, port);
  try {
    const marks = async () => { const b = await dev.bundle(); return { brand: b.includes('BRAND_PRICE'), sdk: b.includes('SDK_DEFAULT_PRICETAG') }; };
    const change = async (fn, re = /Built in|Build failed/) => { const from = dev.log().length; await fn(); await dev.waitFor(re, from); await sleep(300); return from; };
    assert.deepEqual(await marks(), { brand: true, sdk: false }, 'initial dev bundle: the PriceTag override');
    if (switches) {
      await change(() => fx.remove(fx.override('PriceTag.tsx')));
      assert.deepEqual(await marks(), { brand: false, sdk: true }, 'override removed: the SDK default is served');
      await change(() => fx.restore(fx.override('PriceTag.tsx')));
      assert.deepEqual(await marks(), { brand: true, sdk: false }, 'override restored');
    }
    const mistakes = {
      F2a: { break: () => fx.write(fx.override('Buton.tsx'), fx.pristineText(fx.override('Button.tsx'))), fix: () => fx.remove(fx.override('Buton.tsx')) },
      F3a: { break: () => fx.remove(fx.override('Logo.tsx')), fix: () => fx.restore(fx.override('Logo.tsx')) },
      F1a: { break: () => fx.edit(fx.override('Button.tsx'), (s) => s.replace("props: SlotProps['Button'])", "props: SlotProps['Button'] & { tone: 'loud' })")), fix: () => fx.restore(fx.override('Button.tsx')) },
    };
    for (const [id, m] of Object.entries(mistakes)) {
      const want = expect[id];
      if (want === 'silent') {
        const from = dev.log().length;
        m.break();
        await sleep(3000);
        assert.doesNotMatch(dev.log().slice(from), /Build failed/, `${id}: expected no report (documented)`);
        assert.match(await dev.page(), APP_PAGE, `${id}: the page keeps serving`);
        m.fix();
        await sleep(2000);
      } else {
        const from = await change(m.break, /Build failed/);
        await dev.waitFor(want, from);
        assert.match(await dev.page(), want, `${id}: the dev error page shows it`);
        await change(m.fix, /Built in/);
        assert.doesNotMatch(await dev.page(), ERROR_PAGE, `${id}: cleared after the fix, no restart`);
      }
      t.diagnostic(`dev ${id}: ${want === 'silent' ? 'silent (documented)' : 'reported, then cleared'}`);
    }
    assert.match(await dev.page(), APP_PAGE);
  } finally {
    await dev.stop();
  }
}

// ---- the suite ---------------------------------------------------------------------------------------------
defineToolSuite({
  name: 'parcel',
  fixtureDir: FIXTURE,
  commands: {
    build: BUILD,
    render: 'node probes/render.mjs',
  },
  outputs: OUTPUTS,
  positive: {
    bundle: { files: 'dist/*.js' },
    alsoPass: ['check'],
  },
  unwired: { files: {}, command: `${BUILD} --config @parcel/config-default` },
  devProbe: (fx, t) => devLoop(fx, t, {
    cmd: `${PARCEL} serve`,
    expect: { F2a: /\[F2\][^\n]*Buton\.tsx[^\n]*did you mean "Button"/, F3a: /\[F3\][^\n]*required slot "Logo"/, F1a: /\[F1\] Button[^\n]*TS2322/ },
  }),
  typescript5: true,
  universal: {
    files: UNIVERSAL_FILES,
    build: `stunt-double check && ${BUILD}`,
    bare: BUILD,
    mutations: ['F1a', 'F1b', 'F2a', 'F3a', 'F4', 'F5a', 'F6a', 'F6g', 'F7b', 'F8', 'F9c'],
  },
});

// ---- extra cases on the same installs ---------------------------------------------------------------------
// Same name, fixture and dependencies as the suite's fixtures, so these reuse its installs (no extra npm install).
const adapterFx = () => new Fixture({ name: 'parcel', fixtureDir: FIXTURE, addDevDependencies: { typescript5: 'npm:typescript@5.9.3' } });
async function universalFx() {
  const transform = await universalTransform({ pm: 'npm', files: UNIVERSAL_FILES });
  return new Fixture({ name: 'parcel-universal', fixtureDir: FIXTURE, transform, transformKey: transform.key });
}

function playwrightAvailable(app) {
  for (const from of [() => path.join(app, 'package.json'), () => path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'x')]) {
    try { createRequire(from()).resolve('playwright'); return true; } catch {}
  }
  return false;
}

const rmDist = (fx) => fs.rmSync(path.join(fx.app, 'dist'), { recursive: true, force: true });

describe('parcel extras: adapter setup', { concurrency: 1 }, () => {
  const fx = adapterFx();
  before(() => fx.prepare(), { timeout: 15 * MINUTE });
  after(() => fx.finish(), { timeout: 15 * MINUTE });

  test('R5: browser and SSR bundles each carry ONE React although the SDK Checkout is "use client"', { timeout: 5 * MINUTE }, async () => {
    await fx.reset();
    assertPassed(await fx.run(BUILD), 'build: ');
    const r = await fx.run('node probes/bundles.mjs dist dist-ssr');
    assertPassed(r, 'bundles: ');
    const rep = JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('STUNT-DOUBLE-BUNDLES ')).slice('STUNT-DOUBLE-BUNDLES '.length));
    for (const dir of ['dist', 'dist-ssr']) {
      assert.equal(rep[dir].instances.react.length, 1, `${dir}: ${JSON.stringify(rep[dir])}`);
      assert.equal(rep[dir].instances['react-dom'].length, 1, `${dir}: ${JSON.stringify(rep[dir])}`);
      assert.deepEqual(rep[dir].duplicated, []);
    }
  });

  test('R5: the browser bundle renders the overrides in headless Chromium with no page errors', { timeout: 5 * MINUTE }, async (t) => {
    // CI installs Playwright's Chromium (.github/workflows/parcel.yml); locally a missing Playwright skips.
    if (!playwrightAvailable(fx.app)) {
      if (process.env.CI) assert.fail('playwright is not installed: npm i -g playwright@1.56.1 && npx playwright install --with-deps chromium');
      t.skip('playwright not installed (npm i -g playwright@1.56.1 && npx playwright install chromium)');
      return;
    }
    await fx.reset();
    assertPassed(await fx.run(BUILD), 'build: ');
    assertRender(await fx.run('node probes/browser.mjs dist'), STANDARD_RENDER, 'chromium: ');
  });

  test('R5 (node target, isLibrary:false): Parcel splits "use client" modules into a second bundle with a second React; the render crashes', { timeout: 5 * MINUTE }, async () => {
    // Pins why the fixture's "ssr" target sets isLibrary:true (docs/tools/parcel.md). Observed, not wanted.
    await fx.reset();
    fx.write('src/node-main.tsx', `import { renderToString } from 'react-dom/server';\nimport { App } from './App';\nconsole.log('NODE-APP ' + renderToString(<App />));\n`);
    fx.json('package.json', (j) => { j.targets = { nodeapp: { source: 'src/node-main.tsx', context: 'node', outputFormat: 'esmodule', includeNodeModules: true, distDir: 'out-node' } }; });
    assertPassed(await fx.run(BUILD), 'build: ');
    assertMessages(await fx.run('node probes/bundles.mjs out-node'), [/react instances=2/]);
    const run = await fx.run('node out-node/node-main.js');
    assertFailed(run, 'node app: ');
    assertMessages(run, [/Cannot read properties of null \(reading 'useContext'\)/]);
  });

  test('warm .parcel-cache: removing / restoring an override between builds never replays the old decision', { timeout: 5 * MINUTE }, async () => {
    await fx.reset();
    const build = async () => { rmDist(fx); assertPassed(await fx.run(BUILD), 'build: '); };
    const want = (brand) => assertBundle(fx.app, { files: 'dist/*.js', contains: [brand ? 'BRAND_PRICE' : 'SDK_DEFAULT_PRICETAG'], absent: [brand ? 'SDK_DEFAULT_PRICETAG' : 'BRAND_PRICE'] });
    await build(); want(true);
    fx.remove(fx.override('PriceTag.tsx'));
    await build(); want(false);
    fx.restore(fx.override('PriceTag.tsx'));
    await build(); want(true);
  });

  test('CFG: package exports off -> [CFG] naming the package.json Parcel reads', { timeout: 5 * MINUTE }, async () => {
    await fx.reset();
    fx.json('package.json', (j) => { delete j['@parcel/resolver-default']; });
    const r = await fx.run(BUILD);
    assertFailed(r);
    assertMessages(r, [/\[CFG\] Parcel resolves without package "exports", so "@acme\/core\/original\/\*" cannot resolve[^\n]*package\.json/]);
  });

  test('doctor: parcel scripts count as wired with the .parcelrc plugin, and as unwired without it', { timeout: 5 * MINUTE }, async () => {
    await fx.reset();
    const ok = await fx.run('stunt-double doctor');
    assertPassed(ok, 'doctor (plugin): ');
    assertMessages(ok, [], [/\[DOCTOR\] script/]);
    fx.write('.parcelrc', UNWIRED_PARCELRC);
    const bad = await fx.run('stunt-double doctor');
    assertFailed(bad, 'doctor (no plugin): ');
    assertMessages(bad, [/\[DOCTOR\] script "build" runs a tool without a stunt-double adapter/]);
  });
});

describe('parcel extras: universal tier (no plugin)', { concurrency: 1 }, () => {
  let fx;
  before(async () => { fx = await universalFx(); await fx.prepare(); }, { timeout: 15 * MINUTE });
  after(() => fx?.finish(), { timeout: 15 * MINUTE });

  test('warm .parcel-cache with `stunt-double check &&`: an override removed between builds is never replayed', { timeout: 5 * MINUTE }, async () => {
    await fx.reset();
    const chain = `stunt-double check && ${BUILD}`;
    assertPassed(await fx.run(chain));
    assertBundle(fx.app, { files: 'dist/*.js', contains: ['BRAND_PRICE'], absent: ['SDK_DEFAULT_PRICETAG'] });
    fx.remove(fx.override('PriceTag.tsx'));
    rmDist(fx);
    assertPassed(await fx.run(chain));
    assertBundle(fx.app, { files: 'dist/*.js', contains: ['SDK_DEFAULT_PRICETAG'], absent: ['BRAND_PRICE'] });
  });

  // R1 pinned: what a bare `parcel build` (no `stunt-double check &&`) does with each mistake, starting from the
  // shims a previous `stunt-double gen` left. "passes" cells are documented residuals (docs/tools/parcel.md).
  const BARE = [
    { id: 'F1a', outcome: 'pass', render: { sdk: { BRAND_BUTTON: 3, BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0 } } },
    // the catalogue's F2a RENAMES Button.tsx: the previous shim's target is gone (RES); a typo'd NEW file is the
    // harness's "T0 bare" residual (silently unused)
    { id: 'F2a', outcome: 'fail', messages: [/Failed to resolve '\.\.\/\.\.\/src\/overrides\/Button\.tsx'/] },
    { id: 'F4', outcome: 'pass', render: STANDARD_RENDER },
    { id: 'F6a', outcome: 'pass', render: { sdk: { 'SDK_DEFAULT_BUTTON(in-cart)': '>=1' } } },
    { id: 'F6g', outcome: 'pass' },
    { id: 'F3a', outcome: 'fail', messages: [/Failed to resolve '\.\.\/\.\.\/src\/overrides\/Logo\.tsx'/] },
    { id: 'F5a', outcome: 'fail', messages: [/Logo/] },
    { id: 'F7b', outcome: 'runtime', messages: [/heap out of memory|Maximum call stack size exceeded/] },
    { id: 'F8', outcome: 'runtime', messages: [/Cannot read properties of null \(reading 'use(Context|State|Memo|Ref)'\)|Invalid hook call/] },
    { id: 'F9c', outcome: 'runtime', messages: [/A component suspended while responding to synchronous input/] },
  ];
  for (const c of BARE) {
    const m = byId(c.id);
    const label = c.outcome === 'fail' ? 'build fails (RES)' : c.outcome === 'runtime' ? 'build passes, RUNTIME crash [residual R1]' : 'build passes [residual R1]';
    test(`bare universal build, ${c.id}: ${m.title} -> ${label}`, { timeout: 5 * MINUTE }, async () => {
      await fx.reset();
      await fx.useSdk();
      assertPassed(await fx.run('stunt-double gen'), 'gen (the previous decision): ');
      if (m.sdk) await fx.useSdk(m.sdk); // an SDK upgrade without regenerating
      await m.apply(fx, {});
      const b = await fx.run(BUILD);
      if (c.outcome === 'fail') { assertFailed(b); assertMessages(b, c.messages); return; }
      assertPassed(b, 'bare build: ');
      // A capped heap turns F7's unbounded render (~700 MB in 10 s) into a crash in seconds.
      const r = await fx.run('node --max-old-space-size=256 probes/render.mjs', { timeout: 60_000 });
      if (c.outcome === 'runtime') { assertFailed(r, 'render: '); assertMessages(r, c.messages); return; }
      if (c.render) assertRender(r, c.render); else assertPassed(r);
    });
  }

  test('dev, `stunt-double watch -- parcel serve`: F2a/F3a reported via poisoned shims and cleared on fix; F1a silent', { timeout: 5 * MINUTE }, async (t) => {
    await fx.reset();
    await fx.useSdk();
    await devLoop(fx, t, {
      cmd: 'stunt-double watch -- parcel serve', // COLUMNS/LINES come from the environment (watch execs directly)
      expect: { F2a: /STUNT-DOUBLE-ERROR -- \[F2\] src overrides Buton\.tsx overrides unknown slot Buton/, F3a: /STUNT-DOUBLE-ERROR -- \[F3\] required slot Logo has no implementation/, F1a: 'silent' },
    });
  });

  test('dev, bare `parcel serve` (after `stunt-double gen`): F2a/F1a silent [R1]; F3a fails resolving the stale shim, cleared on fix', { timeout: 5 * MINUTE }, async (t) => {
    await fx.reset();
    await fx.useSdk();
    assertPassed(await fx.run('stunt-double gen'));
    await devLoop(fx, t, {
      cmd: `${PARCEL} serve`,
      switches: false, // nothing regenerates: removing an override fails on the stale shim (as F3a shows)
      expect: { F2a: 'silent', F3a: /Failed to resolve '\.\.\/\.\.\/src\/overrides\/Logo\.tsx' from '\.\/sdk-slots\/gen\/Logo\.jsx'/, F1a: 'silent' },
    });
  });
});
