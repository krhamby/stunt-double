// Create React App 5 (react-scripts 5.0.1) via craco 7.1.0: examples/customer-cra with stunt-double/webpack in
// craco.config.js. Same mistakes as the webpack family (tests/webpack-family/suite.mjs CASES), run through the
// REAL `craco build`; positive cases render the built bundle in headless Chromium (CRA has no SSR build).
//
// CRA specifics this suite pins down: the production config bails and prints only the FIRST error,
// TSC_COMPILE_ON_ERROR=true makes its build exit 0 on any error, ModuleScopePlugin rejects imports from src/ that
// resolve outside src/ (the shims live in .stunt-double/gen), its own type check (fork-ts-checker 6) sees src/**
// only, so not .stunt-double/check.ts, and it uses a filesystem cache.
//
// Every case runs on a fresh copy of one install (node_modules hard-linked; cases that run npm get a full copy).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRenderOutput, summarize, compareRender } from './harness/markers.mjs';
import { CASES, EXPECTED_RENDER } from './webpack-family/suite.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packs = path.join(repo, '.packs');
const example = path.join(repo, 'examples', 'customer-cra');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-cra-'));
const base = path.join(tmp, 'base');

const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const write = (d, f, s) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), s); };
const npmInstall = (d, ...args) => execFileSync('npm', ['install', '--no-audit', '--no-fund', ...args], { cwd: d, encoding: 'utf8', stdio: 'pipe' });
const NPM_CASES = new Set(['F2b', 'F6a', 'F8']); // they reinstall @acme/core: full copy, never write through hard links

let n = 0;
const made = [];
function fresh({ full = false } = {}) {
  const d = path.join(tmp, `case-${++n}`);
  fs.mkdirSync(d);
  for (const e of fs.readdirSync(base)) if (e !== 'node_modules') execFileSync('cp', ['-a', path.join(base, e), d]);
  execFileSync('cp', [full ? '-a' : '-al', path.join(base, 'node_modules'), path.join(d, 'node_modules')]);
  made.push(d);
  return d;
}
const done = (d) => { if (!process.env.KEEP_TMP) fs.rmSync(d, { recursive: true, force: true }); };

// CI=true is what CI servers set; CRA then also treats warnings as errors. The suite runs builds that way.
const ENV = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: 'true', BROWSER: 'none' };
function build(d, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(d, 'node_modules/@craco/craco/dist/bin/craco.js'), 'build'], { cwd: d, encoding: 'utf8', env: { ...ENV, ...env } });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, ms: Date.now() - t0 };
}
function render(d) {
  const r = spawnSync(process.execPath, ['probes/render.mjs', 'build'], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0, `render probe failed\n${r.stdout}${r.stderr}`);
  return summarize(parseRenderOutput(r.stdout));
}
const assertFails = (r, re) => {
  assert.notEqual(r.status, 0, `expected a non-zero exit, got ${r.status}\n${r.out.slice(-3000)}`);
  assert.match(r.out, re, `exit ${r.status} but the expected message is missing\n${r.out.slice(-3000)}`);
};
const assertRenders = (d, r, expect = EXPECTED_RENDER) => {
  assert.equal(r.status, 0, `build failed\n${r.out.slice(-3000)}`);
  const s = render(d);
  assert.deepEqual(compareRender(s, expect), [], `render: app=[${s.app}] sdk=[${s.sdk}]`);
};
const bundle = (d) => fs.readdirSync(path.join(d, 'build/static/js')).filter((f) => f.endsWith('.js')).map((f) => read(d, `build/static/js/${f}`)).join('\n');
const setCraco = (d, opts) => write(d, 'craco.config.js', read(d, 'craco.config.js').replace('root: __dirname }', `root: __dirname, ${opts} }`));

/** CRA's entry is src/index.tsx (the shared F6g case appends to src/main.tsx). */
const CRA_CASES = {
  ...CASES,
  F6g: { ...CASES.F6g, m: (d) => { write(d, 'src/legacy.tsx', "import { Button } from '@acme/core/original/Button';\nexport const Legacy = Button;\n"); write(d, 'src/index.tsx', `${read(d, 'src/index.tsx')}import { Legacy } from './legacy';\nconsole.log(Legacy);\n`); } },
};

before(() => {
  // Install the example exactly like a user would, from the .packs/ tarballs (no lockfile: the tarballs'
  // integrity changes whenever `npm run setup` re-packs them).
  execFileSync('cp', ['-a', example, base]);
  for (const x of ['node_modules', 'build', 'package-lock.json', '.stunt-double'])
    fs.rmSync(path.join(base, x), { recursive: true, force: true });
  const pj = JSON.parse(read(base, 'package.json'));
  for (const k of ['dependencies', 'devDependencies', 'overrides']) for (const [name, v] of Object.entries(pj[k] ?? {}))
    if (/^file:(\.\.\/)+\.packs\//.test(v)) pj[k][name] = `file:${path.join(packs, v.replace(/^file:(\.\.\/)+\.packs\//, ''))}`;
  write(base, 'package.json', JSON.stringify(pj, null, 2) + '\n');
  npmInstall(base);
});
after(() => { if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true }); });

test('cra: overrides apply in the app and inside the SDK; replaced default is not bundled', () => {
  const d = fresh();
  assertRenders(d, build(d));
  const js = bundle(d);
  assert.ok(js.includes('BRAND_PRICE') && !js.includes('SDK_DEFAULT_PRICETAG'), 'the SDK default PriceTag must not be in the bundle');
  done(d);
});

for (const [id, c] of Object.entries(CRA_CASES)) {
  test(`cra: ${id} ${c.what}`, () => {
    const d = fresh({ full: NPM_CASES.has(id) });
    c.m(d);
    const r = build(d);
    if (c.expect === 'ok') assertRenders(d, r);
    else assertFails(r, c.expect);
    done(d);
  });
}

// ---- CRA-specific cells -----------------------------------------------------------------------------------

test('cra: F2a a RENAMED override (stale shim target gone) still prints [F2] first, despite bail and first-error-only output', () => {
  const d = fresh();
  fs.renameSync(path.join(d, 'src/overrides/Button.tsx'), path.join(d, 'src/overrides/Buton.tsx'));
  const r = build(d);
  assertFails(r, /Failed to compile\.\s+stunt-double: 1 injection error[^\n]*\n\s+\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton"/);
  done(d);
});

test('cra: F3 a deleted required override prints [F3] first (not the stale shim\'s "Module not found")', () => {
  const d = fresh();
  fs.rmSync(path.join(d, 'src/overrides/Logo.tsx'));
  assertFails(build(d), /Failed to compile\.\s+stunt-double: 1 injection error[^\n]*\n\s+\[F3\] required slot "Logo"/);
  done(d);
});

test('cra: TSC_COMPILE_ON_ERROR=true (CRA then exits 0 on any error) still fails an injection error', () => {
  const d = fresh();
  CASES.F2a.m(d);
  assertFails(build(d, { TSC_COMPILE_ON_ERROR: 'true' }), CASES.F2a.expect);
  done(d);
});

test('cra: known gap: with typecheck:false nothing checks the contract (CRA\'s own type check does not see .stunt-double/check.ts)', () => {
  const d = fresh();
  setCraco(d, 'typecheck: false');
  CASES.F1a.m(d);
  const r = build(d);
  assert.equal(r.status, 0, `if F1a now fails with the gate off, update docs/tools/cra.md\n${r.out.slice(-3000)}`);
  done(d);
});

test('cra: CRA template tsconfig (moduleResolution "node") fails closed with TypeScript\'s own hint', () => {
  const d = fresh();
  write(d, 'tsconfig.json', read(d, 'tsconfig.json').replace('"moduleResolution": "bundler"', '"moduleResolution": "node"'));
  assertFails(build(d), /\[TS\] [^\n]*TS2307[^\n]*'@acme\/core\/(contracts|original\/Button)'[^\n]*Consider updating to 'node16', 'nodenext', or 'bundler'/);
  done(d);
});

test('cra: app code may import the public socket @acme/core-slots/X (ModuleScopePlugin allows the shims)', () => {
  const d = fresh();
  write(d, 'src/App.tsx', read(d, 'src/App.tsx')
    .replace("import { products } from './products';", "import { products } from './products';\nimport { PriceTag as Direct } from '@acme/core-slots/PriceTag';")
    .replace('<Button variant="primary">Sign in</Button>', '<Button variant="primary">Sign in</Button>\n          <Direct amount={1} />'));
  assertRenders(d, build(d), { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)', 'BRAND_PRICE'], sdk: EXPECTED_RENDER.sdk });
  done(d);
});

test('cra: F6b craco config without the adapter fails on the registry placeholder', () => {
  const d = fresh();
  assert.ok(fs.existsSync(path.join(d, 'node_modules/@acme/core-slots/not-wired.js')), 'the placeholder peer is installed');
  write(d, 'craco.config.js', 'module.exports = {}; // not wired\n');
  assertFails(build(d), /Module not found[^\n]*STUNT-DOUBLE-NOT-WIRED/);
  done(d);
});

test('cra: F6 audit: a plugin that resolves a socket elsewhere fails the build', () => {
  const d = fresh();
  write(d, 'craco.config.js', read(d, 'craco.config.js').replace(
    'configure: (config, { env }) => withStuntDouble(config, { mode: env, root: __dirname }),',
    "configure: (config, { env }) => {\n      config.plugins.unshift(new (require('webpack').NormalModuleReplacementPlugin)(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag'));\n      return withStuntDouble(config, { mode: env, root: __dirname });\n    },"));
  assert.match(read(d, 'craco.config.js'), /NormalModuleReplacementPlugin/);
  assertFails(build(d), /\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but [^\n]*PriceTag\.jsx is not in the bundle/);
  done(d);
});

test('cra: F6e/F6h warm filesystem cache: removing and re-adding an override is never served stale', () => {
  const d = fresh();
  const saved = read(d, 'src/overrides/PriceTag.tsx');
  assertRenders(d, build(d));
  fs.rmSync(path.join(d, 'src/overrides/PriceTag.tsx'));
  assertRenders(d, build(d), { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, BRAND_LOGO: 1 } });
  write(d, 'src/overrides/PriceTag.tsx', saved);
  assertRenders(d, build(d));
  done(d);
});

test('cra: SDK minor upgrade (1.1.0, new optional slot) builds and renders', () => {
  const d = fresh({ full: true });
  npmInstall(d, '--no-save', path.join(packs, 'acme-core-1.1.0.tgz'));
  assertRenders(d, build(d), { app: EXPECTED_RENDER.app, sdk: { ...EXPECTED_RENDER.sdk, SDK_DEFAULT_BADGE: '>=1' } });
  done(d);
});

test('cra: known gap: an implementation outside src/ (map.from) fails, but with webpack\'s parse error, not an [Fx] line', () => {
  const d = fresh();
  fs.mkdirSync(path.join(d, 'shared'));
  fs.renameSync(path.join(d, 'src/overrides/Logo.tsx'), path.join(d, 'shared/BrandLogo.tsx'));
  write(d, 'stunt-double.config.json', JSON.stringify({ sdk: '@acme/core', map: { Logo: { from: 'shared/BrandLogo.tsx' } } }, null, 2));
  const r = build(d);
  assertFails(r, /Module parse failed: Unexpected token/);
  assert.doesNotMatch(r.out, /\[F\d/, 'if this starts printing an [Fx] line, update docs/tools/cra.md');
  done(d);
});

test('cra: dev server (craco start): typo and contract overlays appear and clear, overrides added/removed live', { timeout: 300_000 }, () => {
  const d = fresh();
  for (const scenario of [[], ['rapid']]) {
    const r = spawnSync(process.execPath, ['probes/dev.mjs', ...scenario], { cwd: d, encoding: 'utf8', timeout: 240_000 });
    assert.equal(r.status, 0, `dev probe ${scenario.join(' ') || 'standard'} failed\n${r.stdout.split('\nSTUNT-DOUBLE-DEV')[0]}\n${r.stderr}`);
  }
  done(d);
});
