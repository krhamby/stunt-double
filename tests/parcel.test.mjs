// Parcel 2.16 suite: examples/customer-parcel installed from .packs/ into a temp dir, then
//   positive checks (SSR render of the built node-library bundle, live DOM in headless Chromium, bundle
//   inspection: one React, no SDK default PriceTag), the persistent-cache check, and the mistake catalogue in
//   three tiers, every expectation observed for real:
//     T1     stunt-double/parcel resolver plugin in .parcelrc, BARE `parcel build`
//     chain  universal tier (no .parcelrc): `stunt-double check && parcel build`
//     bare   universal tier, bare `parcel build` (R1: what a project gets without the chain)
//   plus `parcel serve` (T1) for F2 / F3 / F1 in dev: error page + recovery after the fix.
//
//   npm run setup && node --test tests/parcel.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseRenderOutput, summarize, compareRender } from './harness/markers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packs = path.join(repo, '.packs');
const example = path.join(repo, 'examples/customer-parcel');
// Outside the repo on purpose: Parcel takes the nearest lockfile / .git above the entry as its project root.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-parcel-'));
const app = path.join(work, 'app');
const pristine = path.join(work, 'pristine');
const KEEP_WORK = !!process.env.KEEP_WORK;

const SKIP_COPY = new Set(['node_modules', 'dist', 'dist-ssr', '.parcel-cache', 'package-lock.json']);
const copyTree = (from, to, skip = SKIP_COPY) => fs.cpSync(from, to, { recursive: true, filter: (src) => !skip.has(path.basename(src)) || path.dirname(src) !== from });

function sh(cmd, { cwd = app, env = {}, timeout = 180_000 } = {}) {
  const t0 = Date.now();
  const r = spawnSync('sh', ['-c', cmd], { cwd, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', COLUMNS: '500', LINES: '50', ...env }, encoding: 'utf8', timeout, maxBuffer: 1 << 26 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: Date.now() - t0 };
}

const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); fs.writeFileSync(path.join(app, rel), text); };
const read = (rel) => fs.readFileSync(path.join(app, rel), 'utf8');
const rm = (rel) => fs.rmSync(path.join(app, rel), { recursive: true, force: true });
const editJson = (rel, fn) => { const j = JSON.parse(read(rel)); fn(j); write(rel, JSON.stringify(j, null, 2) + '\n'); };

/** Swap the installed SDK for another .packs variant without npm (a bundled react comes along). */
function installSdk(variant) {
  const dir = path.join(app, 'node_modules/@acme/core');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['xzf', path.join(packs, `acme-core-${variant}.tgz`), '-C', dir, '--strip-components=1']);
}

/** Restore the pristine project (sources, configs, SDK 1.0.0, the sdk-slots link) and regenerate. */
function reset() {
  for (const e of fs.readdirSync(app)) if (!['node_modules', '.parcel-cache'].includes(e)) rm(e);
  copyTree(pristine, app, new Set());
  installSdk('1.0.0');
  const link = path.join(app, 'node_modules/@acme/core-slots');
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync('../../sdk-slots', link, 'dir');
  const g = sh('npx stunt-double gen');
  assert.equal(g.code, 0, g.out);
}

const TIERS = {
  T1: { prepare() {}, build: 'npx parcel build' },
  chain: { prepare: () => rm('.parcelrc'), build: 'npx stunt-double check && npx parcel build' },
  bare: { prepare: () => rm('.parcelrc'), build: 'npx parcel build' },
};

function build(tier) {
  TIERS[tier].prepare();
  rm('dist'); rm('dist-ssr');
  return sh(TIERS[tier].build);
}

// A capped heap turns F7's unbounded render (it allocates until OOM, ~700 MB in 10 s) into a crash in seconds.
const probe = () => {
  const r = sh('node --max-old-space-size=256 probes/render.mjs', { timeout: 60_000 });
  const html = parseRenderOutput(r.out);
  return { ...r, summary: html == null ? null : summarize(html) };
};
const bundleText = (dir) => fs.readdirSync(path.join(app, dir)).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(app, dir, f), 'utf8')).join('\n');

// The fixture contract (same as customer-vite): app-level wrapped Button, SDK-internal overrides, app context.
const POSITIVE = {
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, SDK_DEFAULT_PRICETAG: 0 },
};

function playwright() {
  for (const from of [path.join(app, 'package.json'), () => path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'x')]) {
    try { createRequire(typeof from === 'function' ? from() : from).resolve('playwright'); return true; } catch {}
  }
  return false;
}

before(() => {
  assert.ok(fs.existsSync(path.join(packs, 'acme-core-1.0.0.tgz')), 'run `npm run setup` first');
  copyTree(example, app, new Set([...SKIP_COPY, '.gitignore']));
  for (const g of ['sdk-slots/gen', 'src/stunt-double.check.ts']) rm(g);
  editJson('package.json', (j) => {
    for (const deps of [j.dependencies, j.devDependencies]) for (const [k, v] of Object.entries(deps)) if (v.startsWith('file:../../.packs/')) deps[k] = `file:${path.join(packs, v.slice('file:../../.packs/'.length))}`;
  });
  copyTree(app, pristine, new Set());
  const r = sh('npm install --package-lock=false --no-audit --no-fund', { timeout: 300_000 });
  assert.equal(r.code, 0, r.out);
  const versions = sh('npx parcel --version && node -p "require(\'typescript/package.json\').version + \' typescript\'"');
  console.log(`parcel suite: ${work} (parcel ${versions.out.trim().replace(/\n/g, ', ')}, node ${process.version})`);
});

after(() => { if (!KEEP_WORK) fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); });

// -------------------------------------------------------------------------------------------------------------
describe('positive', () => {
  for (const tier of ['T1', 'chain']) {
    test(`${tier}: build renders the overrides in app and SDK positions (SSR bundle)`, () => {
      reset();
      const b = build(tier);
      assert.equal(b.code, 0, b.out);
      const p = probe();
      assert.equal(p.code, 0, p.out);
      assert.deepEqual(compareRender(p.summary, POSITIVE), []);
      for (const dir of ['dist', 'dist-ssr']) {
        const text = bundleText(dir);
        assert.match(text, /BRAND_PRICE/);
        assert.doesNotMatch(text, /SDK_DEFAULT_PRICETAG/, `${dir}: the replaced default must not be bundled`);
      }
    });
  }

  test('R5: the browser bundle carries ONE React (the SDK Checkout is "use client")', () => {
    // continues from the chain build above
    const r = sh('node probes/bundles.mjs dist dist-ssr');
    assert.equal(r.code, 0, r.out);
    const rep = JSON.parse(r.out.split('\n').find((l) => l.startsWith('STUNT-DOUBLE-BUNDLES ')).slice(21));
    for (const dir of ['dist', 'dist-ssr']) {
      assert.equal(rep[dir].instances.react.length, 1, `${dir}: ${JSON.stringify(rep[dir])}`);
      assert.equal(rep[dir].instances['react-dom'].length, 1, `${dir}: ${JSON.stringify(rep[dir])}`);
      assert.deepEqual(rep[dir].duplicated, []);
    }
  });

  test('R5: the browser bundle renders in headless Chromium without errors', { skip: !playwright() && 'playwright not installed (npm i -g playwright@1.56.1 && npx playwright install chromium)' }, () => {
    const r = sh('node probes/browser.mjs dist');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(compareRender(summarize(parseRenderOutput(r.out)), POSITIVE), []);
  });

  test('R5 (node, isLibrary:false): Parcel moves "use client" modules into a second bundle with a second React and the render crashes', () => {
    // The reason examples/customer-parcel's "ssr" target sets isLibrary:true. Observed, not wanted.
    reset();
    write('src/node-main.tsx', `import { renderToString } from 'react-dom/server';\nimport { App } from './App';\nconsole.log('NODE-APP ' + renderToString(<App />));\n`);
    editJson('package.json', (j) => { j.targets = { nodeapp: { source: 'src/node-main.tsx', context: 'node', outputFormat: 'esmodule', includeNodeModules: true, distDir: 'out-node' } }; });
    const b = sh('npx parcel build');
    assert.equal(b.code, 0, b.out);
    const rep = sh('node probes/bundles.mjs out-node');
    assert.match(rep.out, /react instances=2/);
    const run = sh('node out-node/node-main.js');
    assert.notEqual(run.code, 0);
    assert.match(run.out, /Cannot read properties of null \(reading 'useContext'\)/);
    rm('out-node');
  });

  test('T1: a warm .parcel-cache never replays an old override decision', () => {
    reset();
    const marks = () => { const t = bundleText('dist'); return { brand: /BRAND_PRICE/.test(t), sdk: /SDK_DEFAULT_PRICETAG/.test(t) }; };
    assert.equal(build('T1').code, 0);
    assert.deepEqual(marks(), { brand: true, sdk: false });
    rm('src/overrides/PriceTag.tsx');
    const b = build('T1');
    assert.equal(b.code, 0, b.out);
    assert.deepEqual(marks(), { brand: false, sdk: true });
    write('src/overrides/PriceTag.tsx', fs.readFileSync(path.join(pristine, 'src/overrides/PriceTag.tsx'), 'utf8'));
    assert.equal(build('T1').code, 0);
    assert.deepEqual(marks(), { brand: true, sdk: false });
  });

  test('chain: a warm .parcel-cache never replays an old override decision', () => {
    reset();
    const sdkDefault = () => /SDK_DEFAULT_PRICETAG/.test(bundleText('dist'));
    assert.equal(build('chain').code, 0);
    assert.equal(sdkDefault(), false);
    rm('src/overrides/PriceTag.tsx');
    assert.equal(build('chain').code, 0);
    assert.equal(sdkDefault(), true);
  });
});

// -------------------------------------------------------------------------------------------------------------
// The mistake catalogue. Per tier: { fails: RegExp } = exit non-zero with that text; { passes: true, render? }
// = exit 0 (and what the built SSR bundle then renders); { runtime: RegExp } = build exit 0, the render probe
// crashes with that text. Every cell is what Parcel 2.16.4 + TypeScript 7.0.2 actually do.
const orig = (rel) => fs.readFileSync(path.join(pristine, rel), 'utf8');
const BTN = 'src/overrides/Button.tsx';
const MUTATIONS = [
  {
    id: 'F1a', title: 'override props incompatible (extra required prop)',
    apply: () => write(BTN, orig(BTN).replace("props: SlotProps['Button'])", "props: SlotProps['Button'] & { tone: 'loud' })")),
    T1: { fails: /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/ }, chain: { fails: /\[F1\] Button/ },
    bare: { passes: true, render: POSITIVE }, // R1: no bundler type-checks
  },
  {
    id: 'F1b', title: 'override ignores contract props',
    apply: () => write('src/overrides/PriceTag.tsx', `export function PriceTag({ amount }: { amount: number }) {\n  return <strong data-sd="BRAND_PRICE">{amount}</strong>;\n}\n`),
    T1: { fails: /\[F1\] PriceTag .*ignores these SDK props/ }, chain: { fails: /\[F1\] PriceTag .*ignores these SDK props/ },
    bare: { passes: true },
  },
  {
    id: 'F2a', title: 'typo file Buton.tsx',
    apply: () => write('src/overrides/Buton.tsx', orig(BTN)),
    T1: { fails: /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/ }, chain: { fails: /\[F2\]/ },
    bare: { passes: true, render: POSITIVE }, // R1: the stray file is simply unused
  },
  {
    id: 'F2b', title: 'SDK upgrade renames PriceTag -> Price (2.0.0, also adds required Footer)',
    apply: () => installSdk('2.0.0'),
    T1: { fails: /RENAMED to "Price"[\s\S]*\[F3\] required slot "Footer"|\[F3\] required slot "Footer"[\s\S]*RENAMED to "Price"/ }, chain: { fails: /RENAMED to "Price"/ },
    bare: { fails: /Failed to resolve '@acme\/core-slots\/(Price|Footer)'/ }, // RES: no shim for the new slots
  },
  {
    id: 'F3', title: 'required slot Logo not provided',
    apply: () => rm('src/overrides/Logo.tsx'),
    T1: { fails: /\[F3\] required slot "Logo" has no implementation/ }, chain: { fails: /\[F3\] required slot "Logo"/ },
    bare: { fails: /Failed to resolve '\.\.\/\.\.\/src\/overrides\/Logo\.tsx'/ }, // RES: the stale shim's target is gone
  },
  {
    id: 'F4', title: 'two claims: Button.tsx + Button/index.tsx',
    apply: () => write('src/overrides/Button/index.tsx', orig(BTN).replaceAll("'../theme'", "'../../theme'")),
    T1: { fails: /\[F4\] slot "Button" is claimed by 2 files/ }, chain: { fails: /\[F4\]/ },
    bare: { passes: true, render: POSITIVE }, // R1: uses the previous shim
  },
  {
    id: 'F5', title: 'wrong export: default instead of named Logo',
    apply: () => write('src/overrides/Logo.tsx', orig('src/overrides/Logo.tsx').replace('export function Logo', 'export default function Logo')),
    T1: { fails: /\[F5\] src\/overrides\/Logo\.tsx must export a named `Logo`/ }, chain: { fails: /\[F5\]/ },
    bare: { fails: /does not export 'Logo'|Logo.*not exported|export.*Logo/i }, // native Parcel symbol check
  },
  {
    id: 'F6a', title: 'SDK file imports a default relatively (1.0.0-bad-relative)',
    apply: () => installSdk('1.0.0-bad-relative'),
    T1: { fails: /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the default of slot "Button" directly/ }, chain: { fails: /\[F6\].*Checkout\.js/ },
    bare: { passes: true, render: { sdk: { SDK_DEFAULT_BUTTON: '>=1' } } }, // R2: silent default inside Checkout
  },
  {
    id: 'F6b', title: 'tool not wired: the registry placeholder instead of the link',
    apply: () => {
      const link = path.join(app, 'node_modules/@acme/core-slots');
      fs.rmSync(link, { recursive: true, force: true });
      fs.mkdirSync(link);
      execFileSync('tar', ['xzf', path.join(packs, 'acme-core-slots-0.0.1.tgz'), '-C', link, '--strip-components=1']);
    },
    T1: { fails: /\[F6\] @acme\/core resolves @acme\/core-slots to/ }, chain: { fails: /\[F6\] @acme\/core resolves @acme\/core-slots/ },
    bare: { fails: /STUNT-DOUBLE-NOT-WIRED/ },
  },
  {
    id: 'F6f', title: 'link wired wrong: a copy of sdk-slots instead of a symlink',
    apply: () => {
      const link = path.join(app, 'node_modules/@acme/core-slots');
      fs.rmSync(link, { recursive: true, force: true });
      fs.cpSync(path.join(app, 'sdk-slots'), link, { recursive: true });
    },
    T1: { fails: /\[F6\] @acme\/core resolves @acme\/core-slots to/ }, chain: { fails: /\[F6\]/ },
    bare: { fails: /Failed to resolve '\.\.\/\.\.\/src\/overrides\/(Button|PriceTag|Logo)\.tsx' from '\.\/node_modules\/@acme\/core-slots\/gen\// }, // the copied shims' relative paths break
  },
  {
    id: 'F6g', title: 'bypass: app code imports @acme/core/original/Button',
    apply: () => {
      write('src/Legacy.tsx', `import { Button } from '@acme/core/original/Button';\nexport const Legacy = () => <Button>legacy</Button>;\n`);
      write('src/App.tsx', orig('src/App.tsx').replace("import { ThemeProvider } from './theme';", "import { ThemeProvider } from './theme';\nimport { Legacy } from './Legacy';").replace('<Button variant="primary">Sign in</Button>', '<Button variant="primary">Sign in</Button><Legacy />'));
    },
    T1: { fails: /\[F6\] src\/Legacy\.tsx imports "@acme\/core\/original\/Button" outside src\/overrides/ }, chain: { fails: /\[F6\] src\/Legacy\.tsx/ },
    bare: { passes: true, render: { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)', 'SDK_DEFAULT_BUTTON(none)'] } }, // R1: silent at that call site
  },
  {
    id: 'F6h', title: 'stale shims: override removed without regenerating',
    apply: () => rm('src/overrides/PriceTag.tsx'),
    T1: { passes: true, render: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } } }, // regenerated in loadConfig
    chain: { passes: true, render: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } } },
    bare: { fails: /Failed to resolve '\.\.\/\.\.\/src\/overrides\/PriceTag\.tsx'/ }, // RES on the stale shim
  },
  {
    id: 'F7', title: 'override imports its own slot through the barrel',
    apply: () => write(BTN, orig(BTN).replace("import { Button as Original } from '@acme/core/original/Button';", "import { Button as Original } from '@acme/core';")),
    T1: { fails: /\[F7\] src\/overrides\/Button\.tsx/ }, chain: { fails: /\[F7\]/ },
    bare: { runtime: /heap out of memory|Maximum call stack size exceeded/ }, // R1: unbounded render
  },
  {
    id: 'F8', title: 'duplicate React: the SDK bundles its own copy (1.0.0-nested-react)',
    apply: () => installSdk('1.0.0-nested-react'),
    T1: { fails: /\[F8\] "react" resolves to 2 copies/ }, chain: { fails: /\[F8\] "react"/ },
    bare: { runtime: /Cannot read properties of null \(reading 'use(Context|State|Memo|Ref)'\)|Invalid hook call/ },
  },
  {
    id: 'F9c', title: 'async override in a client slot',
    apply: () => write('src/overrides/Logo.tsx', orig('src/overrides/Logo.tsx').replace('export function Logo', 'export async function Logo')),
    T1: { fails: /\[F9\]|client slot override must not be an async component/ }, chain: { fails: /\[F9\]|must not be an async component/ },
    bare: { runtime: /A component suspended while responding to synchronous input/ }, // renderToString of an async component
  },
  {
    id: 'CFG-exports', title: '"@parcel/resolver-default": { "packageExports": true } missing',
    apply: () => editJson('package.json', (j) => { delete j['@parcel/resolver-default']; }),
    T1: { fails: /Failed to resolve '@acme\/core\/original\/Button'/ }, // the plugin resolves sockets; originals need exports
    chain: { fails: /Failed to resolve '@acme\/core-slots\/(Button|PriceTag|Logo)'/ },
    bare: { fails: /Failed to resolve '@acme\/core-slots\/(Button|PriceTag|Logo)'/ },
  },
];

describe('mistake catalogue', () => {
  for (const m of MUTATIONS) {
    for (const tier of ['T1', 'chain', 'bare']) {
      const want = m[tier];
      test(`${m.id} ${tier}: ${m.title} -> ${want.fails ? 'build fails' : want.runtime ? 'RUNTIME crash' : 'build passes'}`, () => {
        reset();
        m.apply();
        const b = build(tier);
        if (want.fails) {
          assert.notEqual(b.code, 0, `expected the build to fail:\n${b.out}`);
          assert.match(b.out, want.fails);
          return;
        }
        assert.equal(b.code, 0, `expected the build to pass:\n${b.out}`);
        const p = probe();
        if (want.runtime) {
          assert.notEqual(p.code, 0, `expected the render to crash:\n${p.out.slice(0, 2000)}`);
          assert.match(p.out, want.runtime);
          return;
        }
        assert.equal(p.code, 0, p.out);
        if (want.render) assert.deepEqual(compareRender(p.summary, want.render), []);
      });
    }
  }
});

// -------------------------------------------------------------------------------------------------------------
// `parcel serve` in three set-ups: with the plugin (T1), universal tier under `stunt-double watch --` (poisoned
// shims) and bare universal tier. Per case: { error: RegExp } = the build fails with that text in the terminal
// AND on the dev error page, and the next build after the fix is clean (no restart); { silent: true } = nothing
// is reported (the page keeps serving the previous decision).
const DEV_CASES = {
  F2a: { break: () => write('src/overrides/Buton.tsx', orig(BTN)), fix: () => rm('src/overrides/Buton.tsx') },
  F3: { break: () => rm('src/overrides/Logo.tsx'), fix: () => write('src/overrides/Logo.tsx', orig('src/overrides/Logo.tsx')) },
  F1a: { break: () => write(BTN, orig(BTN).replace("props: SlotProps['Button'])", "props: SlotProps['Button'] & { tone: 'loud' })")), fix: () => write(BTN, orig(BTN)) },
};
const DEV_MODES = [
  { name: 'T1 plugin: parcel serve', cmd: ['npx', 'parcel', 'serve'], prepare() {},
    expect: { F2a: { error: /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton"/ }, F3: { error: /\[F3\] required slot "Logo" has no implementation/ }, F1a: { error: /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/ } } },
  { name: 'universal: stunt-double watch -- parcel serve', cmd: ['npx', 'stunt-double', 'watch', '--', 'npx', 'parcel', 'serve'], prepare: () => rm('.parcelrc'),
    expect: { F2a: { error: /STUNT-DOUBLE-ERROR -- \[F2\] src overrides Buton\.tsx overrides unknown slot Buton/ }, F3: { error: /STUNT-DOUBLE-ERROR -- \[F3\] required slot Logo has no implementation/ }, F1a: { silent: true } } },
  { name: 'universal: bare parcel serve', cmd: ['npx', 'parcel', 'serve'], prepare: () => rm('.parcelrc'),
    expect: { F2a: { silent: true }, F3: { error: /Failed to resolve '\.\.\/\.\.\/src\/overrides\/Logo\.tsx' from '\.\/sdk-slots\/gen\/Logo\.jsx'/ }, F1a: { silent: true } } },
];

for (const mode of DEV_MODES) {
  describe(`dev server, ${mode.name}`, () => {
    let srv, log = '', port;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (re, from, ms = 30_000) => {
      const t = Date.now();
      while (Date.now() - t < ms) { if (re.test(log.slice(from))) return true; await sleep(100); }
      throw new Error(`timed out waiting for ${re} in:\n${log.slice(from)}`);
    };
    const page = async () => (await (await fetch(`http://127.0.0.1:${port}/`)).text()).replaceAll('&quot;', '"').replaceAll('&#39;', "'");
    const APP_PAGE = /<div id=root><\/div>|<div id="root"><\/div>/;

    before(async () => {
      reset();
      mode.prepare();
      port = 41000 + Math.floor(Math.random() * 4000);
      srv = spawn(mode.cmd[0], [...mode.cmd.slice(1), '--target', 'app', '--port', String(port), '--host', '127.0.0.1'], { cwd: app, env: { ...process.env, FORCE_COLOR: '0', COLUMNS: '500', LINES: '50' }, detached: true });
      srv.stdout.on('data', (d) => { log += d; });
      srv.stderr.on('data', (d) => { log += d; });
      await waitFor(/Built in/, 0, 60_000);
    });
    after(async () => {
      // Parcel writes its cache on SIGTERM after npx has exited: wait for the whole process group.
      try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
      const t = Date.now();
      while (Date.now() - t < 20_000) { try { process.kill(-srv.pid, 0); } catch { return; } await sleep(100); }
      try { process.kill(-srv.pid, 'SIGKILL'); } catch {}
    });

    for (const [id, c] of Object.entries(DEV_CASES)) {
      const want = mode.expect[id];
      test(`${id}: ${want.error ? 'error in terminal and on the dev error page, cleared on fix' : 'SILENT (nothing reported)'}`, async () => {
        assert.match(await page(), APP_PAGE);
        let from = log.length;
        c.break();
        if (want.silent) {
          await sleep(3000);
          assert.doesNotMatch(log.slice(from), /Build failed/);
          assert.match(await page(), APP_PAGE);
        } else {
          await waitFor(/Build failed/, from);
          await waitFor(want.error, from);
          await sleep(300);
          assert.match(await page(), want.error);
        }
        from = log.length;
        c.fix();
        if (want.error) await waitFor(/Built in/, from);
        else await sleep(2000);
        await sleep(300);
        assert.match(await page(), APP_PAGE);
      });
    }
  });
}
