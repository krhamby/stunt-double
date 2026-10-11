// Metro 0.87 (React Native) suite: examples/customer-metro, installed from .packs/ tarballs into a temp dir.
//
//   npm run setup && node --test tests/metro.test.mjs
//
// Three ways to bundle the same project, for every mistake in the F1-F9 catalogue:
//   adapter  metro build with metro.config.js = withStuntDouble(getDefaultConfig(__dirname))   (T1)
//   check    stunt-double check                                                                 (the CI gate)
//   bare     metro build with the SAME config minus withStuntDouble(), in the universal tier set up INSIDE THE
//            TEST WORKSPACE ONLY: a "file:./sdk-slots" dependency + stub, node_modules/@acme/core-slots linked
//            to it, shims from the last successful `stunt-double gen` (T0 bare: no stunt-double code at build)
// The example itself is the 3-step setup (stunt-double + one line in metro.config.js + src/overrides): npm
// installs the registry placeholder for @acme/core-slots (here via package.json "overrides" from .packs/).
// Generated paths come from the core's project object, never hard-coded.
// "bare" rows record what Metro does natively, so the docs table can say exactly where a mistake surfaces.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseRenderOutput, summarize, compareRender } from './harness/markers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(repo, 'examples/customer-metro');
const packs = path.join(repo, '.packs');
const tgz = (name) => path.join(packs, name);
let work;

const sh = (cmd, args, opts = {}) => {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: work, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 180_000, ...opts });
  return { code: r.status, signal: r.signal, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: Date.now() - t0 };
};
const metro = (args) => sh(process.execPath, [path.join(work, 'node_modules/metro/src/cli.js'), ...args]);
const build = (config = 'metro.config.js') => {
  fs.mkdirSync(path.join(work, 'dist'), { recursive: true });
  fs.rmSync(path.join(work, 'dist/main.js'), { force: true });
  return metro(['build', 'index.js', '--platform', 'ios', '--out', 'dist/main.js', '--dev', 'false', '--minify', 'false', '--config', config]);
};
const cli = (...args) => sh(process.execPath, [path.join(work, 'node_modules/stunt-double/bin/stunt-double.mjs'), ...args]);
// 64 MB heap: an infinite render (F7) dies in well under a second instead of minutes.
const probe = () => sh(process.execPath, ['--max-old-space-size=64', 'probes/render.mjs'], { timeout: 60_000 });
const render = () => {
  const r = probe();
  assert.equal(r.code, 0, `probe failed:\n${r.out.slice(0, 2000)}`);
  return summarize(parseRenderOutput(r.out));
};

const extract = (tarball, dest) => {
  const t = fs.mkdtempSync(path.join(work, '.x-'));
  const r = sh('tar', ['xzf', tarball, '-C', t]);
  assert.equal(r.code, 0, r.out);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(path.join(t, 'package'), dest);
  fs.rmSync(t, { recursive: true, force: true });
};
const sdkDir = () => path.join(work, 'node_modules/@acme/core');
const slotsLink = () => path.join(work, 'node_modules/@acme/core-slots');
const restoreProject = () => {
  fs.rmSync(path.join(work, 'src'), { recursive: true, force: true });
  fs.cpSync(path.join(example, 'src'), path.join(work, 'src'), { recursive: true });
};
// The core's view of the workspace (no writes): genDir, shimFile(), checkTsconfig, rel() ...
let core;
const project = () => core.generate({ root: work, write: false, onError: 'return' });
// As installed: baseline SDK + the registry placeholder answering @acme/core-slots.
const restoreInstall = () => {
  extract(tgz('acme-core-1.0.0.tgz'), sdkDir());
  extract(tgz('acme-core-slots-0.0.1.tgz'), slotsLink());
};
// Universal tier, test workspace only: declare + link the slot package; the core then generates INTO it.
const STUB = { name: '@acme/core-slots', version: '0.0.0', private: true, type: 'module', sideEffects: false,
  exports: { './package.json': './package.json', './*': { types: './gen/*.d.ts', default: './gen/*.jsx' } } };
let installedPkg;
const universalOn = () => {
  const pkg = JSON.parse(installedPkg);
  pkg.dependencies['@acme/core-slots'] = 'file:./sdk-slots';
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  write('sdk-slots/package.json', JSON.stringify(STUB, null, 2) + '\n');
  fs.rmSync(slotsLink(), { recursive: true, force: true });
  fs.symlinkSync(path.relative(path.dirname(slotsLink()), path.join(work, 'sdk-slots')), slotsLink(), 'junction');
};
const universalOff = () => {
  write('package.json', installedPkg);
  extract(tgz('acme-core-slots-0.0.1.tgz'), slotsLink());
};
// The universal tier's shims as the last successful `stunt-double gen` left them (postinstall / a previous run).
const universalBaseline = () => {
  universalOn();
  const r = cli('gen');
  assert.equal(r.code, 0, `baseline gen (universal tier):\n${r.out}`);
  const p = project();
  assert.equal(p.tier, 'universal');
  assert.equal(p.rel(p.genDir), 'sdk-slots/gen', 'the core generates into the linked package');
  assert.ok(fs.existsSync(p.shimFile('Button')));
  universalOff();
};
const edit = (rel, fn) => { const f = path.join(work, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
const write = (rel, text) => { const f = path.join(work, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

// The baseline render: overrides app-level AND inside the SDK <Checkout> (3 products in cart rows + summary).
const GOOD = {
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, BRAND_PRICE: 3, BRAND_LOGO: 1, SDK_DEFAULT_PRICETAG: 0 },
};

before(async () => {
  for (const f of ['acme-core-1.0.0.tgz', 'acme-core-1.0.0-bad-relative.tgz', 'acme-core-1.0.0-nested-react.tgz', 'acme-core-slots-0.0.1.tgz', 'stunt-double-0.1.0.tgz'])
    assert.ok(fs.existsSync(tgz(f)), `.packs/${f} is missing: run \`npm run setup\` at the repository root first`);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-metro-'));
  fs.cpSync(example, work, { recursive: true, filter: (s) => !/(^|[\\/])(node_modules|dist|\.stunt-double)([\\/]|$)/.test(path.relative(example, s)) });
  edit('package.json', (s) => s.replaceAll('../../.packs/', packs.split(path.sep).join('/') + '/'));
  const r = sh('npm', ['install', '--no-audit', '--no-fund'], { shell: process.platform === 'win32', timeout: 600_000 });
  assert.equal(r.code, 0, `npm install failed:\n${r.out}`);
  installedPkg = fs.readFileSync(path.join(work, 'package.json'), 'utf8');
  core = await import(pathToFileURL(path.join(work, 'node_modules/stunt-double/src/core/index.mjs')).href);
  assert.ok(fs.existsSync(path.join(slotsLink(), 'not-wired.js')), 'the example installs the registry placeholder');
  // T0 bare: the same config without the wrapper (resolution goes through the linked slot package only).
  write('metro.bare.config.js', fs.readFileSync(path.join(work, 'metro.config.js'), 'utf8')
    .replace(/^const \{ withStuntDouble \}.*\n/m, '')
    .replace(/module\.exports = withStuntDouble\((.*)\);/, 'module.exports = $1;'));
  assert.doesNotMatch(fs.readFileSync(path.join(work, 'metro.bare.config.js'), 'utf8'), /stunt-double\/metro|= withStuntDouble\(/);
});

after(() => { if (work && !process.env.KEEP_WORK) fs.rmSync(work, { recursive: true, force: true }); });

describe('positive', () => {
  test('installed versions: metro 0.87.x, @react-native/metro-config 0.87.x', () => {
    const v = (n) => JSON.parse(fs.readFileSync(path.join(work, 'node_modules', n, 'package.json'), 'utf8')).version;
    assert.match(v('metro'), /^0\.87\./);
    assert.match(v('@react-native/metro-config'), /^0\.87\./);
  });

  test('the CommonJS metro.config.js require()s the ES-module adapter and keeps Metro defaults', () => {
    const r = sh(process.execPath, ['-e', `
      const c = require('./metro.config.js');
      console.log(JSON.stringify({ rr: typeof c.resolver.resolveRequest, hook: typeof c.serializer.experimentalSerializerHook,
        exportsFlag: c.resolver.unstable_enablePackageExports ?? 'metro default', platforms: c.resolver.platforms,
        transformer: require('path').basename(require('path').dirname(c.transformer.babelTransformerPath)) }));`]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /ExperimentalWarning/);
    const j = JSON.parse(r.out.trim().split('\n').at(-1));
    assert.equal(j.rr, 'function');
    assert.equal(j.hook, 'function');
    assert.notEqual(j.exportsFlag, false);
    assert.deepEqual(j.platforms, ['android', 'ios']);
  });

  test('adapter: metro build renders the overrides app-level and inside the SDK <Checkout> (placeholder installed, no link)', () => {
    restoreInstall(); restoreProject();
    const r = build();
    assert.equal(r.code, 0, r.out);
    const s = render();
    assert.deepEqual(compareRender(s, GOOD), []);
    const bundle = fs.readFileSync(path.join(work, 'dist/main.js'), 'utf8');
    assert.doesNotMatch(bundle, /STUNT-DOUBLE-NOT-WIRED|STUNT-DOUBLE-ERROR/);
    // PriceTag is REPLACED: the SDK default is not even in the bundle. '@acme/core/original/Button' (package
    // exports subpath, the only way to reach dist/original/*) is, because the Button override wraps it.
    assert.doesNotMatch(bundle, /SDK_DEFAULT_PRICETAG/);
    assert.match(bundle, /SDK_DEFAULT_BUTTON/);
  });

  test('a passing build generates everything from scratch and runs the type gate (no init, no stale state)', () => {
    restoreProject();
    const p = project();
    assert.equal(p.tier, 'adapter');
    fs.rmSync(p.outDir, { recursive: true, force: true });
    const r = build();
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.existsSync(p.shimFile('Button')));
    assert.ok(fs.existsSync(p.checkFile));
    assert.ok(fs.existsSync(p.checkTsconfig), 'the type gate wrote its tsconfig');
    assert.ok(fs.existsSync(path.join(p.outDir, '.gitignore')), 'the output directory ignores itself');
  });

  test('T0 bare: Metro follows a linked slot package natively and renders the same', () => {
    restoreProject();
    universalBaseline();
    universalOn();
    try {
      const r = build('metro.bare.config.js');
      assert.equal(r.code, 0, r.out);
      assert.deepEqual(compareRender(render(), GOOD), []);
    } finally { universalOff(); }
  });

  test('stunt-double check passes', () => {
    restoreProject();
    const r = cli('check');
    assert.equal(r.code, 0, r.out);
  });
});

// ------------------------------------------------------------------------------------------------------------
// Mutation catalogue. Each case: apply() to a fresh copy of the project; expectations per mode:
//   adapter / check: a RegExp the output must match (and exit != 0)
//   bare: { build: RegExp } (exit != 0), or { render: GOOD-like expectation } (exit 0, renders that), or
//         { crash: RegExp } (exit 0, the RUNTIME render fails with that)
// ------------------------------------------------------------------------------------------------------------
const swapSdk = (name) => () => extract(tgz(name), sdkDir());
const MUTATIONS = [
  {
    id: 'F1', title: 'override props incompatible with the contract (extra required prop)',
    apply: () => edit('src/overrides/Button.tsx', (s) => s.replace("props: SlotProps['Button'])", "props: SlotProps['Button'] & { tone: 'loud' })")),
    adapter: /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/, check: /\[F1\] Button/,
    bare: { render: GOOD }, // no bundler type-checks: silent
  },
  {
    id: 'F2', title: 'typo: src/overrides/Buton.tsx',
    apply: () => write('src/overrides/Buton.tsx', 'export function Buton() { return null; }\n'),
    adapter: /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/, check: /\[F2\]/,
    bare: { render: GOOD }, // the stray file is simply unused
  },
  {
    id: 'F3', title: 'required slot Logo not provided',
    apply: () => fs.rmSync(path.join(work, 'src/overrides/Logo.tsx')),
    adapter: /\[F3\] required slot "Logo" has no implementation/, check: /\[F3\]/,
    bare: { build: /Unable to resolve module \.\.\/\.\.\/src\/overrides\/Logo\.tsx/ }, // RES backstop (shim from the last gen)
  },
  {
    id: 'F4', title: 'two claims: Button.tsx + Button/index.tsx',
    apply: () => write('src/overrides/Button/index.tsx', fs.readFileSync(path.join(example, 'src/overrides/Button.tsx'), 'utf8').replace("'../theme'", "'../../theme'")),
    adapter: /\[F4\] slot "Button" is claimed by 2 files/, check: /\[F4\]/,
    bare: { render: GOOD }, // the previous shim decides
  },
  {
    id: 'F5', title: 'wrong export: default instead of named Button',
    apply: () => edit('src/overrides/Button.tsx', (s) => s.replace('export function Button(', 'export default function Button(')),
    adapter: /\[F5\] src\/overrides\/Button\.tsx must export a named `Button` \(it exports: default\)/, check: /\[F5\]/,
    bare: { crash: /Minified React error #130|Element type is invalid/ }, // Metro does not check named imports: RUNTIME
  },
  {
    id: 'F6a', title: 'SDK imports a slot default relatively (variant 1.0.0-bad-relative)',
    apply: swapSdk('acme-core-1.0.0-bad-relative.tgz'),
    adapter: /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the default of slot "Button" directly/, check: /\[F6\]/,
    // silent: the Summary "Pay" button inside Checkout renders the SDK default, unwrapped
    bare: { render: { app: GOOD.app, sdk: { 'BRAND_BUTTON(dark)': 2, 'SDK_DEFAULT_BUTTON(in-cart)': 3, BRAND_PRICE: 3, BRAND_LOGO: 1 } } },
  },
  {
    id: 'F6b', title: 'unwired: the registry placeholder answers @acme/core-slots',
    apply: () => {}, // the as-installed state: the placeholder, no link
    bareLink: false,
    // not a mistake for the adapter: the socket never reaches the placeholder (adapter-only project)
    adapter: 'pass', check: 'pass',
    bare: { build: /Unable to resolve module \.\/STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project/ },
  },
  {
    id: 'F6g', title: 'bypass: app code imports @acme/core/original/Button outside overrides',
    apply: () => {
      write('src/Legacy.tsx', "import { Button } from '@acme/core/original/Button';\nexport function Legacy() { return <Button>legacy</Button>; }\n");
      edit('src/App.tsx', (s) => "import { Legacy } from './Legacy';\n" + s.replace('<Button variant="primary">Sign in</Button>', '<Button variant="primary">Sign in</Button><Legacy />'));
    },
    adapter: /\[F6\] src\/Legacy\.tsx imports "@acme\/core\/original\/Button" outside src\/overrides/, check: /\[F6\]/,
    bare: { render: { app: [...GOOD.app, 'SDK_DEFAULT_BUTTON(none)'] } }, // silent default at that call site
  },
  {
    id: 'F7', title: 'override imports its own slot through the barrel',
    apply: () => edit('src/overrides/Button.tsx', (s) => s.replace("from '@acme/core/original/Button'", "from '@acme/core'")),
    adapter: /\[F7\] src\/overrides\/Button\.tsx imports \{ Button \} from "@acme\/core": that is slot "Button" itself/, check: /\[F7\]/,
    bare: { crash: /heap out of memory|Maximum call stack/ }, // infinite render at RUNTIME
  },
  {
    id: 'F8', title: 'nested React inside the SDK (variant 1.0.0-nested-react)',
    apply: swapSdk('acme-core-1.0.0-nested-react.tgz'),
    adapter: /\[F8\] "react" resolves to 2 copies/, check: /\[F8\]/,
    bare: { crash: /Cannot read properties of null \(reading 'useContext'\)/ },
  },
];

describe('mutations', () => {
  for (const m of MUTATIONS) {
    describe(`${m.id}: ${m.title}`, () => {
      before(() => { restoreInstall(); restoreProject(); universalBaseline(); m.apply(); });
      after(() => { universalOff(); restoreInstall(); restoreProject(); });

      test(m.adapter === 'pass' ? 'adapter: metro build passes and renders the overrides' : 'adapter: metro build exits non-zero with the [Fx] line', () => {
        const r = build();
        if (m.adapter === 'pass') { assert.equal(r.code, 0, r.out.slice(-2000)); assert.deepEqual(compareRender(render(), GOOD), []); return; }
        assert.notEqual(r.code, 0, `metro build passed:\n${r.out.slice(-2000)}`);
        assert.match(r.out, m.adapter);
        assert.ok(!fs.existsSync(path.join(work, 'dist/main.js')), 'no bundle was written');
      });

      test(m.check === 'pass' ? 'stunt-double check passes' : 'stunt-double check exits non-zero', () => {
        const r = cli('check');
        if (m.check === 'pass') { assert.equal(r.code, 0, r.out); return; }
        assert.notEqual(r.code, 0, r.out);
        assert.match(r.out, m.check);
      });

      test(`T0 bare (no adapter): ${m.bare.build ? 'fails at resolve time' : m.bare.crash ? 'bundles, then crashes at RUNTIME' : 'bundles silently'}`, () => {
        // the adapter test above may have poisoned nothing (throw mode) but re-generation is part of the mutation
        // for F3: bare Metro sees the shims of the last successful gen, exactly like a CI without the chain.
        if (m.bareLink !== false) universalOn();
        const r = build('metro.bare.config.js');
        if (m.bare.build) {
          assert.notEqual(r.code, 0, r.out.slice(-2000));
          assert.match(r.out, m.bare.build);
          return;
        }
        assert.equal(r.code, 0, r.out.slice(-2000));
        if (m.bare.crash) {
          const p = probe();
          assert.notEqual(p.code, 0, `expected a runtime crash, got:\n${p.out.slice(0, 1000)}`);
          assert.match(p.out, m.bare.crash);
          return;
        }
        assert.deepEqual(compareRender(render(), m.bare.render), []);
      });
    });
  }
});

describe('metro-specific', () => {
  test('AUD: a resolver placed in front of the adapter sends the socket to the SDK default -> bundle fails', () => {
    restoreInstall(); restoreProject();
    write('metro.alias.config.js', `const sd = require('./metro.config.js');
module.exports = { ...sd, resolver: { ...sd.resolver, resolveRequest(ctx, name, platform) {
  if (name === '@acme/core-slots/Button') return ctx.resolveRequest(ctx, '@acme/core/original/Button', platform);
  return sd.resolver.resolveRequest(ctx, name, platform);
} } };
`);
    const r = build('metro.alias.config.js');
    assert.notEqual(r.code, 0, r.out.slice(-2000));
    assert.match(r.out, /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the SDK default of slot "Button"/);
    assert.ok(r.out.includes(`[F6] @acme/core imports @acme/core-slots/Button but ${project().rel(project().shimFile('Button'))} is not in the bundle`), r.out.slice(-2000));
  });

  test('chains a previous resolveRequest for every other specifier', () => {
    restoreInstall(); restoreProject();
    write('metro.chain.config.js', `const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withStuntDouble } = require('stunt-double/metro');
const seen = new Set();
const base = mergeConfig(getDefaultConfig(__dirname), { serializer: { getModulesRunBeforeMainModule: () => [] },
  resolver: { resolveRequest(ctx, name, platform) { seen.add(name); return ctx.resolveRequest(ctx, name, platform); } } });
process.on('exit', () => console.log('SEEN ' + JSON.stringify([...seen].sort())));
module.exports = withStuntDouble(base);
`);
    const r = build('metro.chain.config.js');
    assert.equal(r.code, 0, r.out.slice(-2000));
    const seen = JSON.parse(r.out.split('\n').find((l) => l.startsWith('SEEN ')).slice(5));
    assert.ok(seen.includes('react') && seen.includes('@acme/core/original/Button'), seen.join(', '));
    assert.ok(!seen.some((s) => s.startsWith('@acme/core-slots/')), 'sockets are answered by stunt-double first');
  });

  test('dev server (metro serve): an STA mistake is served as an error, fixing it recovers without a restart', async () => {
    restoreInstall(); restoreProject();
    write('src/overrides/Buton.tsx', 'export function Buton() { return null; }\n');
    const port = 18000 + Math.floor(Math.random() * 1000);
    const srv = spawn(process.execPath, [path.join(work, 'node_modules/metro/src/cli.js'), 'serve', '--port', String(port)], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    srv.stdout.on('data', (d) => (log += d));
    srv.stderr.on('data', (d) => (log += d));
    const url = `http://localhost:${port}/index.bundle?platform=ios&dev=true&minify=false`;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const get = async () => { const res = await fetch(url); return { status: res.status, text: await res.text() }; };
    const until = async (pred, ms = 20_000) => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { last = await get(); if (pred(last)) return last; } catch {} await wait(250); } return last; };
    try {
      let r = await until((x) => x);
      assert.ok(r, `metro serve did not answer:\n${log}`);
      assert.equal(r.status, 500);
      assert.match(r.text, /\[F2\] src overrides Buton\.tsx overrides unknown slot Buton/);
      assert.match(log, /\[F2\] src\/overrides\/Buton\.tsx/);
      fs.rmSync(path.join(work, 'src/overrides/Buton.tsx'));
      r = await until((x) => x.status === 200);
      assert.equal(r?.status, 200, `did not recover:\n${log}`);
      assert.match(r.text, /BRAND_BUTTON/);
      fs.rmSync(path.join(work, 'src/overrides/Logo.tsx'));
      r = await until((x) => x.status === 500);
      assert.match(r?.text ?? '', /\[F3\] required slot Logo has no implementation/);
    } finally {
      srv.kill();
      restoreProject();
      cli('gen');
    }
  });

  test('typecheck "auto" follows the CLI command: build/bundle/export block, start/serve do not', async () => {
    const { detectCommand } = await import(path.join(work, 'node_modules/stunt-double/src/adapters/metro.mjs'));
    const argv = (...a) => ['node', 'cli', ...a];
    assert.equal(detectCommand(argv('build', 'index.js')), 'build');
    assert.equal(detectCommand(argv('bundle', '--platform', 'ios')), 'build');
    assert.equal(detectCommand(argv('export:embed')), 'build');
    assert.equal(detectCommand(argv('export')), 'build');
    assert.equal(detectCommand(argv('start')), 'serve');
    assert.equal(detectCommand(argv('serve')), 'serve');
    assert.equal(detectCommand(argv('run:ios')), 'serve');
    assert.equal(detectCommand(['node', 'my-script.mjs']), 'unknown');
  });

  test('Metro JS API (no CLI command visible): STA throws, typecheck:true is needed for the type gate', () => {
    restoreInstall(); restoreProject();
    edit('src/overrides/Button.tsx', (s) => s.replace("props: SlotProps['Button'])", "props: SlotProps['Button'] & { tone: 'loud' })"));
    // A script FILE, never `node -e`: Metro's jest-worker forks inherit process.execArgv, and with -e every worker
    // would re-run the build script (a fork bomb).
    write('api-build.cjs', `const Metro = require('metro');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withStuntDouble } = require('stunt-double/metro');
const typecheck = JSON.parse(process.argv[2]);
const base = mergeConfig(getDefaultConfig(__dirname), { maxWorkers: 2, watchFolders: [__dirname], serializer: { getModulesRunBeforeMainModule: () => [] } });
Promise.resolve()
  .then(() => Metro.runBuild(withStuntDouble(base, { typecheck }), { entry: 'index.js', platform: 'ios', dev: false, minify: false, out: 'dist/api.js' }))
  .then(() => { console.log('BUILT'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
`);
    fs.mkdirSync(path.join(work, 'dist'), { recursive: true });
    let r = sh(process.execPath, ['api-build.cjs', '"auto"'], { timeout: 120_000 });
    assert.equal(r.code, 0, r.out.slice(-2000));
    assert.match(r.out, /BUILT/, 'auto: no gate outside a CLI build command (documented gap)');
    r = sh(process.execPath, ['api-build.cjs', 'true'], { timeout: 120_000 });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /\[F1\] Button/);
    restoreProject();
  });
});
