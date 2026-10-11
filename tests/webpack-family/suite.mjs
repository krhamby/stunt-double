// Shared suite for the webpack family (webpack 5, Rspack 2): one example app per tool, the same adapter
// (stunt-double/webpack), the same expectations. tests/webpack.test.mjs and tests/rspack.test.mjs call
// defineSuite() with the tool's commands.
//
// Every case runs on a fresh copy of an installed example (examples/customer-<tool>, installed once per run
// from the .packs/ tarballs), applies one mistake, runs the REAL build command and checks the exit code and the
// [Fx] message. Positive cases also render the built SSR bundle and check the markers (tests/harness/markers.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseRenderOutput, summarize, compareRender } from '../harness/markers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packs = path.join(repo, '.packs');
const sdkPack = (v) => path.join(packs, `acme-core-${v}.tgz`);

/** The render every positive case must produce (same overrides as customer-vite). */
export const EXPECTED_RENDER = {
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, SDK_DEFAULT_PRICETAG: 0, SDK_DEFAULT_BUTTON: 3 },
};

const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const write = (d, f, s) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), s); };
const npmInstall = (d, ...args) => execFileSync('npm', ['install', '--no-audit', '--no-fund', ...args], { cwd: d, encoding: 'utf8', stdio: 'pipe' });

/**
 * The shared mistakes. m(dir, ctx) applies the mistake; expect: RegExp = the build must exit non-zero with
 * output matching it; 'ok' = the build must succeed and render EXPECTED_RENDER (or `render`).
 */
export const CASES = {
  F1a: { what: 'override requires a prop the SDK never passes', m: (d) => write(d, 'src/overrides/Button.tsx', read(d, 'src/overrides/Button.tsx').replace("props: SlotProps['Button']", "props: SlotProps['Button'] & { tone: 'loud' }")), expect: /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322[^\n]*Property 'tone' is missing/ },
  F1b: { what: 'override ignores contract props', m: (d) => write(d, 'src/overrides/Button.tsx', "import type { ReactNode } from 'react';\nexport function Button({ children }: { children?: ReactNode }) {\n  return <button data-sd=\"BRAND_BUTTON\">{children}</button>;\n}\n"), expect: /\[F1\] Button \(src\/overrides\/Button\.tsx\): override ignores these SDK props/ },
  F1c: {
    what: 'forwardRef override must pass',
    m: (d) => write(d, 'src/overrides/Button.tsx', "import { forwardRef } from 'react';\nimport { Button as Original } from '@acme/core/original/Button';\nimport type { SlotProps } from '@acme/core/contracts';\nimport { useTheme } from '../theme';\n\nexport const Button = forwardRef<HTMLButtonElement, SlotProps['Button']>(function Button(props, _ref) {\n  return <span data-sd=\"BRAND_BUTTON\" data-ctx={useTheme()}><Original {...props} /></span>;\n});\n"),
    expect: 'ok',
  },
  F2a: { what: 'typo file in src/overrides', m: (d) => fs.copyFileSync(path.join(d, 'src/overrides/Button.tsx'), path.join(d, 'src/overrides/Buton.tsx')), expect: /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/ },
  F2b: { what: 'SDK 2.0.0 renamed PriceTag to Price', m: (d) => npmInstall(d, '--no-save', sdkPack('2.0.0')), expect: /\[F2\] src\/overrides\/PriceTag\.tsx: slot "PriceTag" was RENAMED to "Price"/ },
  F3: { what: 'required slot Logo missing', m: (d) => fs.rmSync(path.join(d, 'src/overrides/Logo.tsx')), expect: /\[F3\] required slot "Logo" has no implementation/ },
  F4: { what: 'two files claim Button', m: (d) => write(d, 'src/overrides/Button/index.tsx', read(d, 'src/overrides/Button.tsx').replaceAll("'../theme'", "'../../theme'")), expect: /\[F4\] slot "Button" is claimed by 2 files/ },
  F5: { what: 'default export instead of named', m: (d) => write(d, 'src/overrides/Button.tsx', read(d, 'src/overrides/Button.tsx').replace('export function Button', 'export default function Button')), expect: /\[F5\] src\/overrides\/Button\.tsx must export a named `Button` \(it exports: default\)/ },
  F6a: { what: 'installed SDK imports its own default (1.0.0-bad-relative)', m: (d) => npmInstall(d, '--no-save', sdkPack('1.0.0-bad-relative')), expect: /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the default of slot "Button" directly/ },
  F6g: { what: 'app code imports @acme/core/original/Button', m: (d) => { write(d, 'src/legacy.tsx', "import { Button } from '@acme/core/original/Button';\nexport const Legacy = Button;\n"); write(d, 'src/main.tsx', `${read(d, 'src/main.tsx')}import { Legacy } from './legacy';\nconsole.log(Legacy);\n`); }, expect: /\[F6\] src\/legacy\.tsx imports "@acme\/core\/original\/Button" outside src\/overrides/ },
  F6h: {
    what: 'override added after the last `stunt-double gen` (stale shims): regenerated by the adapter',
    m: (d) => { const saved = read(d, 'src/overrides/PriceTag.tsx'); fs.rmSync(path.join(d, 'src/overrides/PriceTag.tsx')); execFileSync('npx', ['stunt-double', 'gen'], { cwd: d, stdio: 'pipe' }); write(d, 'src/overrides/PriceTag.tsx', saved); },
    expect: 'ok',
  },
  F7: { what: 'override imports its own slot through the barrel', m: (d) => write(d, 'src/overrides/Button.tsx', "import { Button as B } from '@acme/core';\nimport type { SlotProps } from '@acme/core/contracts';\nexport function Button(props: SlotProps['Button']) {\n  return <B {...props} />;\n}\n"), expect: /\[F7\] src\/overrides\/Button\.tsx imports \{ Button \} from "@acme\/core": that is slot "Button" itself/ },
  F8: { what: 'SDK resolves a second React (1.0.0-nested-react)', m: (d) => npmInstall(d, '--no-save', sdkPack('1.0.0-nested-react')), expect: /\[F8\] "react" resolves to 2 copies/ },
  F9c: { what: 'async component in a client slot', m: (d) => write(d, 'src/overrides/Button.tsx', "import { Button as Original } from '@acme/core/original/Button';\nimport type { SlotProps } from '@acme/core/contracts';\nexport async function Button(props: SlotProps['Button']) {\n  return <Original {...props} />;\n}\n"), expect: /\[F9\] Button \(src\/overrides\/Button\.tsx\): client slot override must not be an async component/ },
};

/**
 * @param {object} t
 * @param {string} t.tool        'webpack' | 'rspack'
 * @param {string} t.configFile  'webpack.config.mjs'
 * @param {string[]} t.build     build command (argv, run with npx)
 * @param {string[]} t.dev       dev-server command (argv, run with npx; PORT env)
 * @param {string} t.overlay     CSS selector of the dev-server error overlay
 * @param {string} t.packageName the tool's package (for the module-replacement audit case)
 */
export function defineSuite(t) {
  const example = path.join(repo, 'examples', `customer-${t.tool}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sd-${t.tool}-`));
  const base = path.join(tmp, 'base');
  let n = 0;

  const fresh = () => {
    const d = path.join(tmp, `case-${++n}`);
    execFileSync('cp', ['-a', base, d]);
    return d;
  };
  const build = (d) => {
    const t0 = Date.now();
    const r = spawnSync('npx', t.build, { cwd: d, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, ms: Date.now() - t0 };
  };
  const render = (d) => {
    const out = execFileSync(process.execPath, ['probes/render.mjs', 'dist-ssr/entry-server.mjs'], { cwd: d, encoding: 'utf8' });
    return summarize(parseRenderOutput(out));
  };
  const assertFails = (r, re) => {
    assert.notEqual(r.status, 0, `expected a non-zero exit, got ${r.status}\n${r.out.slice(-3000)}`);
    assert.match(r.out, re, `exit ${r.status} but the expected message is missing\n${r.out.slice(-3000)}`);
  };
  const assertRenders = (d, r, expect = EXPECTED_RENDER) => {
    assert.equal(r.status, 0, `build failed\n${r.out.slice(-3000)}`);
    const s = render(d);
    assert.deepEqual(compareRender(s, expect), [], `render: app=[${s.app}] sdk=[${s.sdk}]`);
  };

  before(() => {
    // Install the example exactly like a user would, from the .packs/ tarballs (no lockfile: the tarballs'
    // integrity changes whenever `npm run setup` re-packs them).
    execFileSync('cp', ['-a', example, base]);
    for (const x of ['node_modules', 'dist', 'dist-ssr', 'package-lock.json', 'sdk-slots/gen', 'src/stunt-double.check.ts', '.stunt-double'])
      fs.rmSync(path.join(base, x), { recursive: true, force: true });
    // The copy lives outside the repo: point the relative file: specs at the repo's .packs/ tarballs.
    const pj = JSON.parse(read(base, 'package.json'));
    for (const k of ['dependencies', 'devDependencies']) for (const [n, v] of Object.entries(pj[k] ?? {}))
      if (/^file:(\.\.\/)+\.packs\//.test(v)) pj[k][n] = `file:${path.join(packs, v.replace(/^file:(\.\.\/)+\.packs\//, ''))}`;
    write(base, 'package.json', JSON.stringify(pj, null, 2) + '\n');
    npmInstall(base);
  });
  after(() => { if (!process.env.KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true }); });

  test(`${t.tool}: overrides apply in the app and inside the SDK; replaced default is not bundled`, () => {
    const d = fresh();
    const r = build(d);
    assertRenders(d, r);
    const client = fs.readdirSync(path.join(d, 'dist')).filter((f) => f.endsWith('.js')).map((f) => read(d, `dist/${f}`)).join('\n');
    assert.ok(client.includes('BRAND_PRICE') && !client.includes('SDK_DEFAULT_PRICETAG'), 'the SDK default PriceTag must not be in the client bundle');
  });

  for (const [id, c] of Object.entries(CASES)) {
    test(`${t.tool}: ${id} ${c.what}`, () => {
      const d = fresh();
      c.m(d);
      const r = build(d);
      if (c.expect === 'ok') assertRenders(d, r);
      else assertFails(r, c.expect);
    });
  }

  test(`${t.tool}: F6b a config without the adapter fails on the registry placeholder`, () => {
    const d = fresh();
    fs.rmSync(path.join(d, 'node_modules/@acme/core-slots'), { recursive: true, force: true });
    npmInstall(d, '--no-save', path.join(packs, 'acme-core-slots-0.0.1.tgz'));
    write(d, t.configFile, read(d, t.configFile).replace("import { withStuntDouble } from 'stunt-double/webpack';", 'const withStuntDouble = (config) => config; // not wired'));
    assertFails(build(d), /Module not found[^\n]*STUNT-DOUBLE-NOT-WIRED/);
  });

  test(`${t.tool}: F6 audit: a plugin that resolves a socket elsewhere fails the build`, () => {
    const d = fresh();
    // Wrap the exported config function: prepend a NormalModuleReplacementPlugin to the client compiler.
    write(d, 'audit.config.mjs', `import * as tool from '${t.packageName}';\nimport base from './${t.configFile}';\nconst lib = tool.rspack ?? tool.default;\nexport default (env, argv) => base(env, argv).map((c) => { c.plugins.unshift(new lib.NormalModuleReplacementPlugin(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag')); return c; });\n`);
    const r = spawnSync('npx', [...t.build, '-c', 'audit.config.mjs'], { cwd: d, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assertFails({ status: r.status, out: `${r.stdout}${r.stderr}` }, /\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but [^\n]*PriceTag\.jsx is not in the bundle/);
  });

  test(`${t.tool}: F6e warm persistent cache never serves an old decision`, () => {
    const d = fresh();
    const saved = read(d, 'src/overrides/PriceTag.tsx');
    assertRenders(d, build(d));
    fs.rmSync(path.join(d, 'src/overrides/PriceTag.tsx'));
    assertRenders(d, build(d), { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, BRAND_LOGO: 1 } });
    write(d, 'src/overrides/PriceTag.tsx', saved);
    assertRenders(d, build(d));
  });

  test(`${t.tool}: dev server: add/remove override in the same rebuild, overlays appear and clear`, { timeout: 240_000 }, async () => {
    const d = fresh();
    await devScenario(d, t);
  });
}

// ---- dev server, driven in a real browser -----------------------------------------------------------------
async function loadPlaywright() {
  const tries = [createRequire(path.join(repo, 'package.json'))];
  try { tries.push(createRequire(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'noop.js'))); } catch {}
  for (const req of tries) { try { return req('playwright'); } catch {} }
  throw new Error('playwright is required for the dev-server checks: npm i -g playwright@1.56.1 && npx playwright install chromium');
}

async function devScenario(d, t) {
  const { chromium } = await loadPlaywright();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const srv = spawn('npx', t.dev, { cwd: d, env: { ...process.env, PORT: String(port), NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  srv.stdout.on('data', (b) => { log += b; });
  srv.stderr.on('data', (b) => { log += b; });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (what, cond, ms = 30_000) => {
    const t0 = Date.now();
    for (;;) {
      if (await cond().catch(() => false)) { await sleep(1500); if (await cond().catch(() => false)) return; } // must hold for 1.5 s
      if (Date.now() - t0 > ms) throw new Error(`dev: timed out waiting for: ${what}\n--- server log (tail) ---\n${log.slice(-4000)}`);
      await sleep(150);
    }
  };
  const ov = (f) => path.join(d, 'src/overrides', f);
  const price = fs.readFileSync(ov('PriceTag.tsx'), 'utf8');
  const button = fs.readFileSync(ov('Button.tsx'), 'utf8');
  let browser;
  try {
    browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
    await until('dev server up', async () => (await fetch(`http://localhost:${port}/`)).ok, 120_000);
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/`);
    const html = () => page.evaluate(() => document.body.innerHTML);
    const overlay = () => page.evaluate((sel) => { const f = document.querySelector(sel); return f ? (f.contentDocument?.body?.innerText ?? '') : null; }, t.overlay);
    const clean = async () => (await overlay()) === null && (await html()).includes('BRAND_BUTTON');
    const shows = (re) => async () => re.test((await overlay()) ?? '');

    await until('initial render with overrides', async () => (await clean()) && (await html()).includes('BRAND_PRICE'));

    fs.rmSync(ov('PriceTag.tsx'));
    await until('PriceTag override removed -> SDK default renders', async () => (await html()).includes('SDK_DEFAULT_PRICETAG') && !(await html()).includes('BRAND_PRICE') && (await overlay()) === null);
    fs.writeFileSync(ov('PriceTag.tsx'), price);
    await until('PriceTag override re-added -> override renders', async () => (await html()).includes('BRAND_PRICE') && !(await html()).includes('SDK_DEFAULT_PRICETAG') && (await overlay()) === null);

    const mistakes = [
      ['F2a typo', () => fs.writeFileSync(ov('Buton.tsx'), button), () => fs.rmSync(ov('Buton.tsx')), /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot/],
      ['F3 required slot missing', () => fs.renameSync(ov('Logo.tsx'), ov('_Logo.tsx')), () => fs.renameSync(ov('_Logo.tsx'), ov('Logo.tsx')), /\[F3\] required slot "Logo"/],
      ['F5 wrong export', () => fs.writeFileSync(ov('Button.tsx'), button.replace('export function Button', 'export default function Button')), () => fs.writeFileSync(ov('Button.tsx'), button), /\[F5\] src\/overrides\/Button\.tsx must export a named `Button`/],
      ['F7 self import', () => fs.writeFileSync(ov('Button.tsx'), `import { Button as Self } from '@acme/core';\nconsole.log(Self);\n${button}`), () => fs.writeFileSync(ov('Button.tsx'), button), /\[F7\] src\/overrides\/Button\.tsx/],
      ['F1a contract', () => fs.writeFileSync(ov('Button.tsx'), button.replace("props: SlotProps['Button']", "props: SlotProps['Button'] & { tone: 'loud' }")), () => fs.writeFileSync(ov('Button.tsx'), button), /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/],
    ];
    for (const [name, make, fix, re] of mistakes) {
      make();
      await until(`${name}: overlay shows ${re}`, shows(re));
      fix();
      await until(`${name}: overlay clears after the fix`, clean);
    }
  } finally {
    await browser?.close().catch(() => {});
    try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
  }
}
