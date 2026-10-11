// Storybook 10.6 (builder-vite and builder-webpack5) x stunt-double.
//
//   npm run setup
//   (cd examples/customer-storybook-vite && npm install --no-package-lock)
//   (cd examples/customer-storybook-webpack && npm install --no-package-lock)
//   node --test tests/storybook.test.mjs
//
// Positive: every wired Storybook config builds, and its stories render the project's overrides in the app
// AND inside SDK components (headless Chromium on the built storybook-static). Negative: unwired configs fail
// on the registry placeholder, and every catalogue mistake makes `storybook build` exit non-zero with its [Fx]
// code, per builder.
//
// Each case runs in a temp copy of examples/customer-storybook-{vite,webpack}. Cases that need another
// @acme/core variant get their own `npm install`; the rest symlink the example's node_modules.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summarize, compareRender } from './harness/markers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = { vite: path.join(repo, 'examples', 'customer-storybook-vite'), webpack: path.join(repo, 'examples', 'customer-storybook-webpack') };
const packs = path.join(repo, '.packs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-storybook-'));
const KEEP = !!process.env.SD_KEEP_TMP;

/** The three wired configs. `gate`: does `storybook build` run the contract type gate (TYP)? */
const BUILDERS = {
  vite: { example: 'vite', configDir: '.storybook', gate: true },                     // plugin from the app's vite.config.ts
  'vite-final': { example: 'vite', configDir: '.storybook-vite-final', gate: true }, // separate config + viteFinal
  webpack: { example: 'webpack', configDir: '.storybook', gate: true },               // webpackFinal: withStuntDouble(c)
};

const EXPECT_RENDER = {
  'app-button--primary': { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'] },
  'sdk-checkout--default': { sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, SDK_DEFAULT_PRICETAG: 0, 'SDK_DEFAULT_BUTTON(in-cart)': 3 } },
  'app-page--page': { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'], sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, SDK_DEFAULT_PRICETAG: 0 } },
};

// ---- helpers ----------------------------------------------------------------------------------------------
const COPY_SKIP = new Set(['node_modules', 'sdk-slots', 'storybook-static']);
function copyProject(name, example) {
  const dir = path.join(work, name);
  fs.cpSync(EXAMPLES[example], dir, { recursive: true, filter: (src) => !COPY_SKIP.has(path.basename(src)) && !path.basename(src).startsWith('storybook-static') && !src.endsWith('stunt-double.check.ts') });
  return dir;
}

/** A temp copy sharing the example's node_modules (same SDK version). */
function project(name, example) {
  const dir = copyProject(name, example);
  fs.symlinkSync(path.join(EXAMPLES[example], 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

/** A temp copy with its own install of another @acme/core tarball. */
function projectWithSdk(name, example, tarball) {
  const dir = copyProject(name, example);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const [k, v] of Object.entries({ ...pj.dependencies, ...pj.devDependencies }))
    if (typeof v === 'string' && v.startsWith('file:../../')) {
      const field = pj.dependencies[k] ? 'dependencies' : 'devDependencies';
      pj[field][k] = `file:${path.join(repo, v.slice('file:../../'.length))}`;
    }
  pj.dependencies['@acme/core'] = `file:${path.join(packs, tarball)}`;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pj, null, 2));
  const r = spawnSync('npm', ['install', '--no-package-lock', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: dir, encoding: 'utf8', env: { ...process.env, npm_config_loglevel: 'error' } });
  assert.equal(r.status, 0, `npm install for ${tarball} failed:\n${r.stdout}\n${r.stderr}`);
  return dir;
}

const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\|\x1b\]8;;[^\x07]*\x07/g, '');

/** `storybook build` in dir, like a user's script. Returns { status, output, ms, outDir }. */
function storybookBuild(dir, configDir) {
  const outDir = path.join(dir, `storybook-static-${configDir.replace(/^\./, '')}`);
  const bin = path.join(dir, 'node_modules', 'storybook', 'dist', 'bin', 'dispatcher.js');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [bin, 'build', '-c', configDir, '-o', outDir, '--quiet'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 300_000,
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1', CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  return { status: r.status, output: strip(`${r.stdout}\n${r.stderr}`), ms: Date.now() - t0, outDir };
}

async function render(example, outDir) {
  const { renderStories } = await import(pathToFileURL(path.join(EXAMPLES[example], 'probes', 'render.mjs')).href);
  return renderStories(outDir, Object.keys(EXPECT_RENDER));
}

// Storybook's logger boxes and wraps messages at ~70 columns ("|  " prefixes): match on the unwrapped text.
const unwrap = (s) => s.replace(/\s*\n[\s|]*/g, ' ');
const tail = (s) => s.replace(/^\s*\|?\s*(at |\(file:|file:|<anonymous>).*\n/gm, '').slice(-3000);

function assertFails(res, codes, label) {
  assert.notEqual(res.status, 0, `${label}: storybook build exited 0 but must fail with ${codes.join(' / ')}\n${tail(res.output)}`);
  const flat = unwrap(res.output);
  for (const c of codes) assert.ok(flat.includes(c), `${label}: exit ${res.status} but the output does not mention ${c}\n${tail(res.output)}`);
}

before(() => {
  for (const example of Object.values(EXAMPLES))
    assert.ok(fs.existsSync(path.join(example, 'node_modules', 'storybook')), `${path.relative(repo, example)} is not installed: npm run setup && (cd ${path.relative(repo, example)} && npm install --no-package-lock)`);
});
after(() => { if (!KEEP) fs.rmSync(work, { recursive: true, force: true }); else console.log(`kept ${work}`); });

// ---- positive ----------------------------------------------------------------------------------------------
describe('wired Storybook renders the overrides (app + inside SDK components)', () => {
  for (const [builder, { example, configDir }] of Object.entries(BUILDERS)) {
    test(`${builder}: storybook build -c ${configDir} + Chromium render`, async () => {
      const dir = project(`ok-${builder}`, example);
      const res = storybookBuild(dir, configDir);
      assert.equal(res.status, 0, `storybook build failed:\n${tail(res.output)}`);
      const stories = await render(example, res.outDir);
      for (const [id, want] of Object.entries(EXPECT_RENDER)) {
        const r = stories[id];
        assert.ok(!r.html.startsWith('STORY-ERROR'), `${id}: ${r.html}`);
        assert.deepEqual(r.errors, [], `${id}: browser errors`);
        assert.deepEqual(compareRender(summarize(r.html), want), [], `${id}: ${r.html}`);
      }
      // the replaced default is eliminated from the bundle; the wrapped one is kept (it is rendered inside BRAND_BUTTON)
      const bundle = fs.readdirSync(res.outDir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(res.outDir, f), 'utf8')).join('\n');
      assert.ok(!bundle.includes('SDK_DEFAULT_PRICETAG'), 'replaced SDK default PriceTag is in the bundle');
      assert.ok(!bundle.includes('STUNT-DOUBLE-NOT-WIRED'), 'placeholder text is in the bundle');
    });
  }
});

// ---- F6b: unwired Storybooks fail on the registry placeholder ---------------------------------------------
describe('F6b: a Storybook nobody wired fails on the placeholder (never renders defaults)', () => {
  test('builder-vite without the plugin (separate vite config)', () => {
    const res = storybookBuild(project('unwired-vite', 'vite'), '.storybook-unwired');
    assertFails(res, ['STUNT-DOUBLE-NOT-WIRED', 'UNRESOLVED_IMPORT'], 'unwired vite');
  });
  test('builder-webpack5 without withStuntDouble()', () => {
    const res = storybookBuild(project('unwired-webpack', 'webpack'), '.storybook-unwired');
    assertFails(res, ['STUNT-DOUBLE-NOT-WIRED', 'Module not found'], 'unwired webpack');
  });
});

// ---- the mistake catalogue -----------------------------------------------------------------------------------
// apply(dir) mutates a fresh copy; sdk: another @acme/core tarball (own install); codes: what the output must contain.
const MUTATIONS = [
  { id: 'F1a', what: 'override requires an extra prop', codes: ['[F1]', 'TS2322'], gate: true,
    apply: (d) => write(d, 'src/overrides/Logo.tsx', `import type { SlotProps } from '@acme/core/contracts';\nexport function Logo({ size = 32, tone }: SlotProps['Logo'] & { tone: 'loud' }) {\n  return <svg data-sd="BRAND_LOGO" data-tone={tone} width={size} height={size} />;\n}\n`) },
  { id: 'F1b', what: 'override ignores SDK props', codes: ['[F1]', 'override ignores these SDK props'], gate: true,
    apply: (d) => write(d, 'src/overrides/PriceTag.tsx', `export function PriceTag({ amount }: { amount: number }) {\n  return <strong data-sd="BRAND_PRICE">{amount.toFixed(2)}</strong>;\n}\n`) },
  { id: 'F2', what: 'typo: src/overrides/Buton.tsx', codes: ['[F2]', 'did you mean "Button"'],
    apply: (d) => write(d, 'src/overrides/Buton.tsx', `export function Buton() { return null; }\n`) },
  { id: 'F3', what: 'required Logo missing', codes: ['[F3]', 'Logo'],
    apply: (d) => fs.rmSync(path.join(d, 'src/overrides/Logo.tsx')) },
  { id: 'F4', what: 'two claims for Button', codes: ['[F4]'],
    apply: (d) => write(d, 'src/overrides/Button/index.tsx', `import type { SlotProps } from '@acme/core/contracts';\nexport function Button(p: SlotProps['Button']) { return <button>{p.children}</button>; }\n`) },
  { id: 'F5', what: 'default export instead of named', codes: ['[F5]'],
    apply: (d) => write(d, 'src/overrides/PriceTag.tsx', `import type { SlotProps } from '@acme/core/contracts';\nexport default function PriceTag({ amount, currency = 'USD' }: SlotProps['PriceTag']) {\n  return <strong data-sd="BRAND_PRICE">{currency} {amount.toFixed(2)}</strong>;\n}\n`) },
  { id: 'F6a', what: 'installed SDK imports a slot default relatively', codes: ['[F6]', 'Checkout'], sdk: 'acme-core-1.0.0-bad-relative.tgz' },
  { id: 'F6g', what: 'app code imports @acme/core/original/Button', codes: ['[F6]', 'original/Button'],
    apply: (d) => {
      write(d, 'src/Legacy.tsx', `import { Button } from '@acme/core/original/Button';\nexport function Legacy() { return <Button>legacy</Button>; }\n`);
      write(d, 'src/stories/Legacy.stories.tsx', `import type { Meta, StoryObj } from '@storybook/react';\nimport { Legacy } from '../Legacy';\nconst meta = { title: 'App/Legacy', component: Legacy } satisfies Meta<typeof Legacy>;\nexport default meta;\nexport const Default: StoryObj<typeof meta> = {};\n`);
    } },
  { id: 'F7', what: 'override imports its own slot through the barrel', codes: ['[F7]'],
    apply: (d) => write(d, 'src/overrides/Button.tsx', `import { Button as Sdk } from '@acme/core';\nimport type { SlotProps } from '@acme/core/contracts';\nexport function Button(props: SlotProps['Button']) { return <span data-sd="BRAND_BUTTON"><Sdk {...props} /></span>; }\n`) },
  { id: 'F8', what: 'SDK resolves its own nested react', codes: ['[F8]', 'react'], sdk: 'acme-core-1.0.0-nested-react.tgz' },
  { id: 'F9c', what: 'async override in a client slot', codes: ['[F9]'], gate: true,
    apply: (d) => write(d, 'src/overrides/Logo.tsx', `import type { SlotProps } from '@acme/core/contracts';\nexport async function Logo({ size = 32 }: SlotProps['Logo']) {\n  return <svg data-sd="BRAND_LOGO" width={size} height={size} />;\n}\n`) },
];

describe('storybook build fails on every catalogue mistake', () => {
  const sdkProjects = new Map();
  const forSdk = (example, tarball) => {
    const key = `${example}|${tarball}`;
    if (!sdkProjects.has(key)) sdkProjects.set(key, projectWithSdk(`sdk-${example}-${tarball.replace(/\.tgz$/, '')}`, example, tarball));
    return sdkProjects.get(key);
  };
  for (const m of MUTATIONS) for (const [builder, b] of Object.entries(BUILDERS)) {
    test(`${m.id} ${m.what} — ${builder}`, () => {
      const dir = m.sdk ? forSdk(b.example, m.sdk) : project(`${m.id}-${builder}`, b.example);
      m.apply?.(dir);
      const res = storybookBuild(dir, b.configDir);
      if (m.gate && !b.gate) {
        assert.equal(res.status, 0, `${m.id} ${builder}: expected the documented gap (no type gate) but the build failed:\n${tail(res.output)}`);
        return;
      }
      assertFails(res, m.codes, `${m.id} ${builder}`);
    });
  }
});

// ---- dev: `storybook dev` with a mistake present at startup ------------------------------------------------
const freePort = () => new Promise((done) => { const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => done(port)); }); });

/** Start `storybook dev`; resolve when it listens or exits. */
async function storybookDev(dir, configDir, port) {
  const bin = path.join(dir, 'node_modules', 'storybook', 'dist', 'bin', 'dispatcher.js');
  const child = spawn(process.execPath, [bin, 'dev', '-c', configDir, '-p', String(port), '--ci', '--no-open', '--host', '127.0.0.1'], {
    cwd: dir, env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  const state = { child, port, output: '', exitCode: null };
  child.stdout.on('data', (d) => (state.output += d));
  child.stderr.on('data', (d) => (state.output += d));
  const exited = new Promise((done) => child.on('exit', (code) => { state.exitCode = code; done(); }));
  const listening = (async () => {
    for (let i = 0; i < 240 && state.exitCode === null; i++) {
      const ok = await fetch(`http://127.0.0.1:${port}/iframe.html`).then((r) => r.ok, () => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  await Promise.race([exited, listening]);
  state.output = strip(state.output);
  state.stop = () => { if (state.exitCode === null) child.kill('SIGTERM'); return exited; };
  return state;
}

describe('dev: storybook dev with an injection mistake', () => {
  test('builder-vite: the story shows an error with the [F2] text (poisoned shims + Vite overlay), never defaults', async (t) => {
    const dir = project('dev-F2-vite', 'vite');
    write(dir, 'src/overrides/Buton.tsx', 'export function Buton() { return null; }\n');
    const dev = await storybookDev(dir, '.storybook', await freePort());
    t.after(() => dev.stop());
    assert.equal(dev.exitCode, null, `storybook dev exited:\n${tail(dev.output)}`);
    const { chromium } = await import(pathToFileURL(path.join(EXAMPLES.vite, 'node_modules', 'playwright-core', 'index.mjs')).href);
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${dev.port}/iframe.html?id=sdk-checkout--default&viewMode=story`);
    await page.waitForFunction(() => document.querySelector('vite-error-overlay') || /sb-show-main/.test(document.body.className), null, { timeout: 60_000 });
    const r = await page.evaluate(() => ({ cls: document.body.className, overlay: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent ?? '', root: document.querySelector('#storybook-root')?.innerHTML ?? '' }));
    assert.ok(r.overlay.includes('[F2]') && r.overlay.includes('Buton'), `no [F2] overlay: ${JSON.stringify(r).slice(0, 1000)}`);
    assert.ok(!/data-sd=/.test(r.root), `the story rendered: ${r.root.slice(0, 500)}`);
    assert.ok(unwrap(strip(dev.output)).includes('[F2]'), 'the dev server log does not mention [F2]');
  });

  test('builder-webpack5: storybook dev exits non-zero at startup with [F2]', async (t) => {
    const dir = project('dev-F2-webpack', 'webpack');
    write(dir, 'src/overrides/Buton.tsx', 'export function Buton() { return null; }\n');
    const dev = await storybookDev(dir, '.storybook', await freePort());
    t.after(() => dev.stop());
    if (dev.exitCode === null) await new Promise((r) => dev.child.on('exit', r));
    assert.notEqual(dev.exitCode ?? dev.child.exitCode, 0, `storybook dev kept running:\n${tail(dev.output)}`);
    assert.ok(unwrap(strip(dev.output)).includes('[F2]'), `no [F2] in the output:\n${tail(dev.output)}`);
  });
});
