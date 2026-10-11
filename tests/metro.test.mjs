// Metro 0.87 (React Native bundler): fixture examples/customer-metro (the 3-step setup: stunt-double, one line
// in metro.config.js, src/overrides). The bundle is built with the real `metro build` (platform ios, through
// @react-native/metro-config) and rendered by evaluating it in a V8 context with react-dom/server.
//
// The shared catalogue runs with the default expectations: every mistake fails `metro build` while Metro loads
// metro.config.js (the adapter throws there; Metro has no build-start hook). Below the suite: Metro-only checks
// (dev server, the post-bundle audit against a user resolver, resolver chaining, the JS API) and the pinned
// runtime residuals of BARE Metro (universal tier without the `stunt-double check &&` prefix). See
// tests/README.md and docs/tools/metro.md.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, test, before, after } from 'node:test';
import { defineToolSuite, universalTransform, Fixture, byId, assertFailed, assertPassed, assertMessages, assertRender, STANDARD_RENDER } from './harness/index.mjs';

const FIXTURE = 'examples/customer-metro';
const METRO_BUILD = 'mkdir -p dist && metro build index.js --platform ios --out dist/main.js --dev false --minify false';

// The same project config WITHOUT withStuntDouble(): a forgotten second config, or the universal tier.
const NO_ADAPTER_CONFIG = `const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The fixture has no react-native package: skip RN's setup-env prelude (as metro.config.js does).
module.exports = mergeConfig(getDefaultConfig(__dirname), { serializer: { getModulesRunBeforeMainModule: () => [] } });
`;
const UNWIRED = 'metro.unwired.config.js';
const UNIVERSAL = 'metro.universal.config.js';
const BARE_BUILD = `${METRO_BUILD} --config ${UNIVERSAL}`;
// 64 MB heap: an infinite render (F7) dies in well under a second instead of minutes.
const RENDER_SMALL_HEAP = 'node --max-old-space-size=64 probes/render.mjs';

defineToolSuite({
  name: 'metro',
  fixtureDir: FIXTURE,
  commands: {
    build: METRO_BUILD,
    render: 'node probes/render.mjs',
  },
  outputs: ['dist'],
  positive: { bundle: { files: 'dist/main.js' }, alsoPass: ['check'] },
  unwired: {
    files: { [UNWIRED]: NO_ADAPTER_CONFIG },
    command: `${METRO_BUILD} --config ${UNWIRED}`,
  },
  typescript5: true,
  devProbe: metroDevProbe,
  universal: {
    files: { [UNIVERSAL]: NO_ADAPTER_CONFIG },
    build: `stunt-double check && ${BARE_BUILD}`,
    bare: BARE_BUILD,
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});

// ---- dev server: `metro serve` -----------------------------------------------------------------------------
// The adapter poisons the shims instead of throwing when the CLI command is a dev server: Metro starts, every
// bundle request answers HTTP 500 with the [Fx] text (the red box), and a watcher regenerates on override edits.
async function metroDevProbe(fx) {
  fx.write(fx.override('Buton.tsx'), 'export function Buton() { return null; }\n');
  const port = 18000 + Math.floor(Math.random() * 1000);
  // A developer's machine: Metro turns its file watcher OFF when CI is set (metro createFileMap: watch ?? !CI).
  const { CI: _ci, ...env } = process.env;
  const srv = spawn(process.execPath, [path.join(fx.app, 'node_modules/metro/src/cli.js'), 'serve', '--port', String(port)], { cwd: fx.app, stdio: ['ignore', 'pipe', 'pipe'], env });
  let log = '';
  srv.stdout.on('data', (d) => (log += d));
  srv.stderr.on('data', (d) => (log += d));
  const url = `http://localhost:${port}/index.bundle?platform=ios&dev=true&minify=false`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (pred, ms = 30_000) => {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < ms) {
      try { const res = await fetch(url); last = { status: res.status, text: await res.text() }; if (pred(last)) return last; } catch {}
      await wait(250);
    }
    return last;
  };
  try {
    let r = await until((x) => x);
    assert.ok(r, `metro serve did not answer:\n${log}`);
    assert.equal(r.status, 500, 'a typo in src/overrides is served as an error, never as the SDK default');
    assert.match(r.text, /\[F2\] src overrides Buton\.tsx overrides unknown slot Buton/);
    assert.match(log, /\[F2\] src\/overrides\/Buton\.tsx/);
    fx.remove(fx.override('Buton.tsx'));
    r = await until((x) => x.status === 200);
    assert.equal(r?.status, 200, `the fix did not recover the dev server without a restart:\n${log}`);
    assert.match(r.text, /BRAND_BUTTON/);
    fx.remove(fx.override('Logo.tsx'));
    r = await until((x) => x.status === 500);
    assert.match(r?.text ?? '', /\[F3\] required slot Logo has no implementation/);
  } finally {
    srv.kill();
  }
}

// ---- Metro-only checks (adapter tier; reuses the suite's install) ------------------------------------------
describe('metro: adapter specifics', { concurrency: 1 }, () => {
  const fx = new Fixture({ name: 'metro', fixtureDir: FIXTURE });
  before(() => fx.prepare(), { timeout: 900_000 });
  after(() => fx.finish(), { timeout: 900_000 });

  test('metro 0.87.x and @react-native/metro-config 0.87.x; the CommonJS config require()s the ES-module adapter without warnings', async () => {
    await fx.reset();
    const r = await fx.run(`node -e "
      const c = require('./metro.config.js');
      console.log('VERSIONS', require('metro/package.json').version, require('@react-native/metro-config/package.json').version);
      console.log('SHAPE', typeof c.resolver.resolveRequest, typeof c.serializer.experimentalSerializerHook, c.resolver.unstable_enablePackageExports !== false);"`);
    assertPassed(r);
    assert.match(r.output, /VERSIONS 0\.87\.\d+ 0\.87\.\d+/);
    assert.match(r.output, /SHAPE function function true/);
    assert.doesNotMatch(r.output, /ExperimentalWarning/);
  });

  test('AUD: a resolver placed IN FRONT of the adapter aims the Button socket at the SDK default -> the bundle fails', async () => {
    await fx.reset();
    fx.write('metro.alias.config.js', `const sd = require('./metro.config.js');
module.exports = { ...sd, resolver: { ...sd.resolver, resolveRequest(ctx, name, platform) {
  if (name === '@acme/core-slots/Button') return ctx.resolveRequest(ctx, '@acme/core/original/Button', platform);
  return sd.resolver.resolveRequest(ctx, name, platform);
} } };
`);
    const r = await fx.run(`${METRO_BUILD} --config metro.alias.config.js`);
    assertFailed(r);
    const core = await fx.core();
    const p = core.generate({ root: fx.app, write: false });
    assertMessages(r, [
      /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the SDK default of slot "Button"/,
      new RegExp(`\\[F6\\] @acme/core imports @acme/core-slots/Button but ${p.rel(p.shimFile('Button')).replace(/\./g, '\\.')} is not in the bundle`),
    ]);
  });

  test('a previous resolveRequest is chained for every other specifier; sockets are answered by the adapter first', async () => {
    await fx.reset();
    fx.write('metro.chain.config.js', `const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withStuntDouble } = require('stunt-double/metro');
const seen = new Set();
const base = mergeConfig(getDefaultConfig(__dirname), { serializer: { getModulesRunBeforeMainModule: () => [] },
  resolver: { resolveRequest(ctx, name, platform) { seen.add(name); return ctx.resolveRequest(ctx, name, platform); } } });
process.on('exit', () => console.log('SEEN ' + JSON.stringify([...seen].sort())));
module.exports = withStuntDouble(base);
`);
    const r = await fx.run(`${METRO_BUILD} --config metro.chain.config.js`);
    assertPassed(r);
    const seen = JSON.parse(r.output.split('\n').find((l) => l.startsWith('SEEN ')).slice(5));
    assert.ok(seen.includes('react') && seen.includes('@acme/core/original/Button'), seen.join(', '));
    assert.ok(!seen.some((s) => s.startsWith('@acme/core-slots/')), 'sockets never reach the previous resolver');
  });

  test('typecheck "auto" follows the CLI command: build / bundle / export block, start / serve do not', async () => {
    const { detectCommand } = await import(path.join(fx.app, 'node_modules/stunt-double/src/adapters/metro.mjs'));
    const argv = (...a) => ['node', 'cli', ...a];
    for (const c of ['build', 'bundle', 'export', 'export:embed']) assert.equal(detectCommand(argv(c, '--platform', 'ios')), 'build', c);
    for (const c of ['start', 'serve', 'run:ios', 'run-android']) assert.equal(detectCommand(argv(c)), 'serve', c);
    assert.equal(detectCommand(['node', 'my-script.cjs']), 'unknown');
  });

  test('Metro JS API (no CLI command in argv): no type gate under "auto" [documented gap]; typecheck: true gates it', async () => {
    await fx.reset();
    await byId('F1a').apply(fx);
    // A script FILE, never `node -e`: Metro's jest-worker forks inherit process.execArgv, so with -e every
    // worker would re-run the build script (a fork bomb).
    fx.write('api-build.cjs', `const Metro = require('metro');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withStuntDouble } = require('stunt-double/metro');
const typecheck = JSON.parse(process.argv[2]);
const base = mergeConfig(getDefaultConfig(__dirname), { maxWorkers: 2, watchFolders: [__dirname], serializer: { getModulesRunBeforeMainModule: () => [] } });
Promise.resolve()
  .then(() => Metro.runBuild(withStuntDouble(base, { typecheck }), { entry: 'index.js', platform: 'ios', dev: false, minify: false, out: 'dist/api.js' }))
  .then(() => { console.log('BUILT'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
`);
    const auto = await fx.run(`mkdir -p dist && node api-build.cjs '"auto"'`);
    assertPassed(auto, 'auto (gap: the JS API shows no command): ');
    assert.match(auto.output, /BUILT/);
    const on = await fx.run(`node api-build.cjs true`);
    assertFailed(on, 'typecheck: true: ');
    assertMessages(on, [/\[F1\] Button/]);
  });
});

// ---- bare Metro (universal tier WITHOUT `stunt-double check &&`): pinned runtime residuals (R1) -----------
// Metro itself never validates: these mistakes bundle (exit 0) and only show at RUNTIME, which is why a project
// without the adapter must chain `stunt-double check &&`. Each case pins the observed behaviour, so a change is
// noticed. The shims are the last successful `stunt-double gen` (postinstall or a previous run).
describe('metro: bare Metro without the adapter or the prefix (documented residuals, R1)', { concurrency: 1 }, () => {
  let fx;
  before(async () => {
    const transform = await universalTransform({ files: { [UNIVERSAL]: NO_ADAPTER_CONFIG } });
    fx = new Fixture({ name: 'metro-universal', fixtureDir: FIXTURE, transform, transformKey: transform.key });
    await fx.prepare();
  }, { timeout: 900_000 });
  after(() => fx?.finish(), { timeout: 900_000 });

  const CASES = [
    { id: 'F5a', why: 'Metro does not check named imports: the Logo slot is undefined at runtime', crash: /Minified React error #130|Element type is invalid/ },
    { id: 'F7b', why: 'the override renders itself: infinite render until out of memory', crash: /heap out of memory|Maximum call stack/ },
    { id: 'F8', why: 'two Reacts in one bundle: the SDK hooks see a null dispatcher', crash: /Cannot read properties of null \(reading 'useContext'\)/ },
    { id: 'F6a', why: 'the SDK imports its default relatively: silently NOT overridden inside Checkout', render: { app: STANDARD_RENDER.app, sdk: { 'BRAND_BUTTON(dark)': 2, 'SDK_DEFAULT_BUTTON(in-cart)': 3, BRAND_PRICE: 3, BRAND_LOGO: 1 } } },
  ];
  for (const c of CASES) {
    test(`${c.id} bare: bundles (exit 0), then ${c.crash ? 'crashes at RUNTIME' : 'renders the SDK default silently'}: ${c.why}`, { timeout: 300_000 }, async () => {
      const m = byId(c.id);
      await fx.reset();
      await fx.useSdk();
      assertPassed(await fx.run('stunt-double gen'), 'baseline gen (default SDK): ');
      await fx.useSdk(m.sdk ?? fx.sdk.version);
      await m.apply(fx);
      assertPassed(await fx.run(BARE_BUILD), 'bare metro build (residual: nothing validates): ');
      const r = await fx.run(RENDER_SMALL_HEAP, { timeout: 60_000 });
      if (c.crash) { assertFailed(r, 'runtime: '); assertMessages(r, [c.crash]); }
      else { assertPassed(r); assertRender(r, c.render); }
      const chained = await fx.run(`stunt-double check && ${BARE_BUILD}`);
      assertFailed(chained, 'with the prefix: ');
      assertMessages(chained, m.expect.messages);
    });
  }
});
