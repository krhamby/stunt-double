// Shared helpers for the framework suites (react-router, astro, init-templates). Each example app is installed
// ONCE from the .packs/ tarballs into a temp dir; every case works on a copy with hard-linked node_modules
// (source files are real copies, so a mutation never touches the base or the repository).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PACKS = path.join(REPO, '.packs');
export const KEEP = !!process.env.KEEP_TMP;

// Astro 7 and Vite detect AI-agent shells (AI_AGENT, CLAUDECODE, ...): `astro dev` then detaches into a
// background daemon with JSON logs. ASTRO_DEV_BACKGROUND=0 keeps it in the foreground, as for a person.
export const ENV = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ASTRO_TELEMETRY_DISABLED: '1', ASTRO_DEV_BACKGROUND: '0' };

export function requirePacks(...names) {
  for (const t of names) assert.ok(fs.existsSync(path.join(PACKS, t)), `missing .packs/${t}: run npm install && npm run setup at the repository root`);
}

export const tmpRoot = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `sd-${label}-`));

/** Copy an example into `dir` without build output / generated files, make file: specs absolute, npm install. */
export function installExample(exampleDir, dir, skip = []) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(exampleDir)) {
    if (['node_modules', 'package-lock.json', 'build', 'dist', '.astro', '.react-router', ...skip].includes(f)) continue;
    fs.cpSync(path.join(exampleDir, f), path.join(dir, f), { recursive: true, filter: (s) => !/[\\/]sdk-slots[\\/]gen([\\/]|$)|stunt-double\.check\.ts$/.test(s) });
  }
  const pkgFile = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  for (const deps of [pkg.dependencies, pkg.devDependencies])
    for (const [k, v] of Object.entries(deps ?? {})) if (v.startsWith('file:../')) deps[k] = 'file:' + path.resolve(exampleDir, v.slice(5));
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  npm(dir, ['install', '--no-audit', '--no-fund', '--loglevel=error']);
  assert.ok(fs.existsSync(path.join(dir, 'sdk-slots/gen/Button.jsx')), 'postinstall should have generated the shims');
}

export function npm(cwd, args, timeout = 600_000) {
  return execFileSync('npm', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
}

/** A working copy of `base`: node_modules hard-linked, everything else copied. */
export function copyApp(base, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(base)) {
    if (['build', 'dist', '.astro', '.react-router'].includes(f)) continue;
    if (f === 'node_modules') execFileSync('cp', ['-al', path.join(base, f), path.join(dir, f)]);
    else fs.cpSync(path.join(base, f), path.join(dir, f), { recursive: true, verbatimSymlinks: true });
  }
  const api = {
    dir,
    file: (f) => path.join(dir, f),
    exists: (f) => fs.existsSync(path.join(dir, f)),
    read: (f) => fs.readFileSync(path.join(dir, f), 'utf8'),
    write: (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); },
    rm: (f) => fs.rmSync(path.join(dir, f), { recursive: true, force: true }),
    edit: (f, from, to) => { const s = api.read(f); assert.ok(s.includes(from), `${f} should contain ${JSON.stringify(from)}`); api.write(f, s.replace(from, to)); },
    /** Replace the installed @acme/core with another variant tarball (what `npm i @acme/core@<v>` installs). */
    swapSdk: (version) => {
      const sdk = path.join(dir, 'node_modules/@acme/core');
      fs.rmSync(sdk, { recursive: true, force: true });
      fs.mkdirSync(sdk, { recursive: true });
      execFileSync('tar', ['xzf', path.join(PACKS, `acme-core-${version}.tgz`), '-C', sdk, '--strip-components=1']);
    },
  };
  return api;
}

/** Run a package bin with node (no npx), return { code, out, ms }. */
export function runBin(app, bin, args, { env = {}, timeout = 300_000 } = {}) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [app.file(bin), ...args], { cwd: app.dir, env: { ...ENV, ...env }, encoding: 'utf8', timeout });
  return { code: r.status, signal: r.signal, out: `${r.stdout}\n${r.stderr}`, ms: Date.now() - t };
}

/** Run an npm script, return { code, out, ms }. */
export function runScript(dir, script, { timeout = 300_000 } = {}) {
  const t = Date.now();
  const r = spawnSync('npm', ['run', '--silent', script], { cwd: dir, env: ENV, encoding: 'utf8', timeout });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}`, ms: Date.now() - t };
}

/** First stunt-double diagnostic line ("[F2] ...") in an output. */
export function firstDiagnostic(out) {
  return /^\s*(?:\S*Error: )?(\[(?:F\d+[a-z]?|W7|STALE|TS|SETUP|CFG|X\d)\][^\n]*)/m.exec(out)?.[1] ?? null;
}

export function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.join(d.parentPath ?? d.path, d.name));
}
export const grepFiles = (dir, needle, re = /\.(js|mjs|html)$/) => filesUnder(dir).filter((f) => re.test(f) && fs.readFileSync(f, 'utf8').includes(needle));

// ---------------------------------------------------------------------------------------------------------
// The mistake catalogue (F1-F9, DESIGN §2.3), applied to an app whose overrides live in `ov` and whose page
// component (rendering <Button> from '@acme/core') is `page`. Every app here has the reference overrides:
// Button wraps (useTheme from '../theme'), PriceTag replaces (memo), Logo is the required slot.

export const MISTAKES = [
  {
    id: 'F1', title: 'contract: extra required prop',
    apply: (a, { ov }) => a.edit(`${ov}/Button.tsx`, "props: SlotProps['Button']", "props: SlotProps['Button'] & { tone: 'loud' }"),
    line: /^\[F1\] Button \(\S+\/Button\.tsx\): TS2322 .*Property 'tone' is missing/,
  },
  {
    id: 'F2', title: 'typo: Buton.tsx',
    apply: (a, { ov }) => a.write(`${ov}/Buton.tsx`, a.read(`${ov}/PriceTag.tsx`)),
    line: /^\[F2\] \S+\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/,
  },
  {
    id: 'F3', title: 'required slot Logo missing',
    apply: (a, { ov }) => a.rm(`${ov}/Logo.tsx`),
    line: /^\[F3\] required slot "Logo" has no implementation: create \S+\/Logo\.tsx exporting `Logo`/,
  },
  {
    id: 'F4', title: 'two claims: Button.tsx + Button/index.tsx',
    apply: (a, { ov }) => a.write(`${ov}/Button/index.tsx`, a.read(`${ov}/Button.tsx`).replace("'../theme'", "'../../theme'")),
    line: /^\[F4\] slot "Button" is claimed by 2 files: /,
  },
  {
    id: 'F5', title: 'wrong export: default instead of named',
    apply: (a, { ov }) => a.write(`${ov}/PriceTag.tsx`, a.read(`${ov}/PriceTag.tsx`).replace('export const PriceTag = memo(', 'const PriceTag = memo(') + 'export default PriceTag;\n'),
    line: /^\[F5\] \S+\/PriceTag\.tsx must export a named `PriceTag` \(it exports: default\)/,
  },
  {
    id: 'F6g', title: 'bypass: page imports @acme/core/original/Button',
    apply: (a, { page }) => {
      a.write(page, `import { Button as RawButton } from '@acme/core/original/Button';\n${a.read(page)}`);
      a.edit(page, '<Button variant="primary">Sign in</Button>', '<Button variant="primary">Sign in</Button><RawButton>raw</RawButton>');
    },
    line: /^\[F6\] \S+ imports "@acme\/core\/original\/Button" outside \S+: that call site renders the SDK default/,
  },
  {
    id: 'F7', title: 'override imports its own slot through the barrel',
    apply: (a, { ov }) => a.edit(`${ov}/Button.tsx`, "import { Button as Original } from '@acme/core/original/Button';", "import { Button as Original } from '@acme/core';"),
    line: /^\[F7\] \S+\/Button\.tsx imports \{ Button \} from "@acme\/core": that is slot "Button" itself \(infinite render\)/,
  },
  {
    id: 'F8', title: 'duplicate React (@acme/core@1.0.0-nested-react)',
    apply: (a) => a.swapSdk('1.0.0-nested-react'),
    line: /^\[F8\] "react" resolves to 2 copies: .*node_modules\/@acme\/core\/node_modules\/react/,
  },
  {
    id: 'F6a', title: 'SDK imports a default directly (@acme/core@1.0.0-bad-relative)',
    apply: (a) => a.swapSdk('1.0.0-bad-relative'),
    line: /^\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the default of slot "Button" directly/,
  },
  {
    id: 'F2b', title: 'SDK upgrade renames PriceTag (@acme/core@2.0.0)',
    apply: (a) => a.swapSdk('2.0.0'),
    line: /^\[F2\] \S+\/PriceTag\.tsx: slot "PriceTag" was RENAMED to "Price" in @acme\/core@2\.0\.0/,
  },
];

// ---------------------------------------------------------------------------------------------------------
// long-running processes (dev servers)

let port = 5600 + (process.pid % 300) * 3;
export const freePort = () => port++;

export function startProc(cwd, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...ENV, ...extraEnv }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return {
    child,
    get log() { return log; },
    stop: () => new Promise((r) => {
      if (child.exitCode !== null) return r();
      child.once('exit', () => r());
      try { process.kill(-child.pid, 'SIGTERM'); } catch { r(); }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} r(); }, 4000);
    }),
  };
}

export async function get(url) {
  try { const r = await fetch(url); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; }
}

export async function until(url, pred, ms = 30_000) {
  const t = Date.now();
  let last;
  while (Date.now() - t < ms) {
    last = await get(url);
    if (pred(last)) return { ...last, ms: Date.now() - t };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ...last, ms: Date.now() - t, timedOut: true };
}

export const cleanup = (dir) => { if (!KEEP) fs.rmSync(dir, { recursive: true, force: true }); else console.log(`kept ${dir}`); };

// ---------------------------------------------------------------------------------------------------------
// browser (dev overlay checks)

export function loadPlaywright() {
  const roots = [REPO, ...(process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean)];
  try { roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()); } catch {}
  for (const r of roots) { try { return createRequire(path.join(r, 'noop.js'))('playwright'); } catch {} }
  throw new Error('playwright is required for the dev overlay checks: npm i -g playwright (browsers: npx playwright install chromium)');
}

/** Text of Vite's (or Astro's) error overlay, whitespace-collapsed; null when there is none. */
export async function overlayText(page) {
  return page.evaluate(() => {
    const t = document.querySelector('vite-error-overlay')?.shadowRoot?.textContent;
    return t == null ? null : t.replace(/\s+/g, ' ');
  });
}

export async function waitOverlay(page, pred, ms = 30_000) {
  const t = Date.now();
  let last = null;
  while (Date.now() - t < ms) {
    last = await overlayText(page).catch(() => null);
    if (pred(last)) return { text: last, ms: Date.now() - t };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { text: last, ms: Date.now() - t, timedOut: true };
}

/**
 * Dev scenario shared by the framework suites: start the dev server, load the page in Chromium, create a typo'd
 * override while it runs, observe the overlay (live, no reload) and the HTTP status, delete the file, observe
 * recovery. Returns observations; the suites assert on them.
 */
export async function devTypoScenario(a, { args, ov, url }) {
  const { chromium } = loadPlaywright();
  const dev = startProc(a.dir, process.execPath, args);
  const browser = await chromium.launch();
  const obs = { log: () => dev.log };
  try {
    obs.start = await until(url, (x) => x.status === 200 && x.text.includes('data-sd="BRAND_LOGO"'), 60_000);
    if (obs.start.timedOut) return obs;
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('[data-sd="BRAND_LOGO"]'), null, { timeout: 30_000 });
    obs.startOverlay = await overlayText(page);
    a.write(`${ov}/Buton.tsx`, 'export function Buton() { return null; }\n');
    obs.liveOverlay = await waitOverlay(page, (t) => !!t && t.includes('[F2]'));
    obs.http = await until(url, (x) => x.status === 500, 30_000);
    a.rm(`${ov}/Buton.tsx`);
    obs.fixed = await until(url, (x) => x.status === 200 && x.text.includes('data-sd="BRAND_LOGO"') && x.text.includes('data-sd="BRAND_PRICE"'), 30_000);
    // clearing the error sends a full-reload; a navigation racing it is retried
    for (let i = 0; i < 3; i++) { try { await page.goto(url); break; } catch (e) { if (i === 2) throw e; await new Promise((r) => setTimeout(r, 500)); } }
    await page.waitForFunction(() => document.querySelector('[data-sd="BRAND_LOGO"]'), null, { timeout: 30_000 });
    obs.fixedOverlay = await overlayText(page);
    obs.fixedMarkers = await page.evaluate(() => [...document.querySelectorAll('[data-sd]')].map((e) => e.getAttribute('data-sd')));
    return obs;
  } finally {
    await browser.close();
    await dev.stop();
  }
}

/**
 * Apply a catalogue mistake while the dev server runs (page open in Chromium), wait for the overlay to match
 * `overlay`, then restore the files and wait for recovery. Returns observations.
 */
export async function devLiveMistake(a, { args, url, ctx, mistake }) {
  const { chromium } = loadPlaywright();
  const watched = [...filesUnder(a.file(ctx.ov)), a.file(ctx.page)];
  const snap = new Map(watched.map((f) => [f, fs.readFileSync(f)]));
  const dev = startProc(a.dir, process.execPath, args);
  const browser = await chromium.launch();
  const obs = { log: () => dev.log };
  try {
    obs.start = await until(url, (x) => x.status === 200 && x.text.includes('data-sd="BRAND_LOGO"'), 60_000);
    if (obs.start.timedOut) return obs;
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('[data-sd="BRAND_LOGO"]'), null, { timeout: 30_000 });
    mistake.apply(a, ctx);
    obs.overlay = await waitOverlay(page, (t) => !!t && /\[F\d/.test(t));
    obs.http = await get(url);
    for (const f of filesUnder(a.file(ctx.ov))) if (!snap.has(f)) fs.rmSync(f);
    for (const [f, buf] of snap) fs.writeFileSync(f, buf);
    obs.fixed = await until(url, (x) => x.status === 200 && x.text.includes('data-sd="BRAND_LOGO"'), 30_000);
    const page2 = await browser.newPage();
    for (let i = 0; i < 3; i++) { try { await page2.goto(url); break; } catch (e) { if (i === 2) throw e; await new Promise((r) => setTimeout(r, 500)); } }
    await page2.waitForFunction(() => document.querySelector('[data-sd="BRAND_LOGO"]'), null, { timeout: 30_000 });
    obs.fixedOverlay = await overlayText(page2);
    return obs;
  } finally {
    await browser.close();
    await dev.stop();
  }
}
