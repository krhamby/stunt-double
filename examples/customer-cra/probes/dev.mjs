#!/usr/bin/env node
// Dev-server probe: start `craco start`, open the page in headless Chromium and walk a scenario of file edits,
// waiting after each one for the dev overlay text or the rendered markers to match. Prints one
// STUNT-DOUBLE-DEV <json> line (per-step results) and exits 1 if any step did not reach its expected state.
// Every edited file is restored at the end, whatever happens.
//
//   node probes/dev.mjs            the standard scenario below
//   node probes/dev.mjs rapid      edits that overlap rebuilds
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ov = (f) => path.join(root, 'src/overrides', f);

/** Each step: a label, an edit (sync fs work), and what the page must show: overlay text, or markers. */
const SCENARIO = [
  { label: 'initial render', expect: { overlay: null, sdkHas: ['BRAND_PRICE', 'BRAND_LOGO'], appHas: ['BRAND_BUTTON(dark)'] } },
  { label: 'F2a typo Button.tsx -> Buton.tsx', edit: () => fs.renameSync(ov('Button.tsx'), ov('Buton.tsx')), expect: { overlay: '[F2] src/overrides/Buton.tsx overrides unknown slot "Buton"' } },
  { label: 'fix the typo', edit: () => fs.renameSync(ov('Buton.tsx'), ov('Button.tsx')), expect: { overlay: null, appHas: ['BRAND_BUTTON(dark)'] }, settle: 8_000 },
  { label: 'remove the PriceTag override', edit: () => fs.renameSync(ov('PriceTag.tsx'), path.join(root, 'PriceTag.tsx.off')), expect: { overlay: null, sdkHas: ['SDK_DEFAULT_PRICETAG'], sdkLacks: ['BRAND_PRICE'] } },
  { label: 'add the PriceTag override back', edit: () => fs.renameSync(path.join(root, 'PriceTag.tsx.off'), ov('PriceTag.tsx')), expect: { overlay: null, sdkHas: ['BRAND_PRICE'], sdkLacks: ['SDK_DEFAULT_PRICETAG'] } },
  { label: 'F1a extra required prop', edit: () => edit(ov('Button.tsx'), (s) => s.replace("props: SlotProps['Button'])", "props: SlotProps['Button'] & { tone: 'loud' })")), expect: { overlay: '[F1] Button (src/overrides/Button.tsx): TS2322' } },
  { label: 'fix the prop', edit: () => edit(ov('Button.tsx'), (s) => s.replace(" & { tone: 'loud' })", ')')), expect: { overlay: null, appHas: ['BRAND_BUTTON(dark)'] }, settle: 8_000 },
];

// Edits that land while the previous rebuild is still running (a fast typist, a branch switch).
const RAPID = [
  SCENARIO[0],
  { label: 'typo and fix within 300 ms, then remove PriceTag', edit: () => { fs.renameSync(ov('Button.tsx'), ov('Buton.tsx')); sleepSync(300); fs.renameSync(ov('Buton.tsx'), ov('Button.tsx')); sleepSync(300); fs.renameSync(ov('PriceTag.tsx'), path.join(root, 'PriceTag.tsx.off')); }, expect: { overlay: null, sdkHas: ['SDK_DEFAULT_PRICETAG'], appHas: ['BRAND_BUTTON(dark)'] }, settle: 10_000 },
  SCENARIO[4],
];
const scenario = process.argv[2] === 'rapid' ? RAPID : SCENARIO;
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

const originals = new Map();
function edit(file, fn) {
  if (!originals.has(file)) originals.set(file, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
}
function restore() {
  if (fs.existsSync(ov('Buton.tsx'))) fs.renameSync(ov('Buton.tsx'), ov('Button.tsx'));
  if (fs.existsSync(path.join(root, 'PriceTag.tsx.off'))) fs.renameSync(path.join(root, 'PriceTag.tsx.off'), ov('PriceTag.tsx'));
  for (const [f, s] of originals) fs.writeFileSync(f, s);
}

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const markers = (s) => [...s.matchAll(/data-sd="([A-Z0-9_]+)"(?: data-ctx="([^"]*)")?/g)].map((m) => (m[2] ? `${m[1]}(${m[2]})` : m[1]));
const section = (html, name) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';

async function state(page) {
  return page.evaluate(() => {
    const f = document.querySelector('#webpack-dev-server-client-overlay');
    const overlay = f && f.style.display !== 'none' ? (f.contentDocument?.body?.innerText ?? '') : null;
    return { overlay: overlay || null, html: document.getElementById('root')?.innerHTML ?? '' };
  }).catch(() => ({ overlay: null, html: '' }));
}

function matches(s, want) {
  const app = markers(section(s.html, 'app')), sdk = markers(section(s.html, 'sdk'));
  if (want.overlay === null && s.overlay) return false;
  if (typeof want.overlay === 'string' && !(s.overlay ?? '').includes(want.overlay)) return false;
  if (want.appHas?.some((m) => !app.includes(m))) return false;
  if (want.sdkHas?.some((m) => !sdk.includes(m))) return false;
  if (want.sdkLacks?.some((m) => sdk.includes(m))) return false;
  return true;
}

const port = await freePort();
const child = spawn(process.execPath, [path.join(root, 'node_modules/@craco/craco/dist/bin/craco.js'), 'start'], {
  cwd: root, env: { ...process.env, BROWSER: 'none', PORT: String(port), CI: 'true', FAST_REFRESH: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

const compileCount = () => (log.match(/Compiled successfully|Compiled with warnings|Failed to compile/g) ?? []).length;
const results = [];
let browser;
try {
  const t0 = Date.now();
  while (!/Compiled|Failed to compile|webpack compiled/i.test(log)) {
    if (child.exitCode != null) throw new Error(`craco start exited ${child.exitCode}:\n${log}`);
    if (Date.now() - t0 > 120_000) throw new Error(`craco start did not compile in 120 s:\n${log}`);
    await sleep(200);
  }
  const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch({ executablePath });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/`);
  for (const step of scenario) {
    const s0 = Date.now();
    const compiles = compileCount();
    step.edit?.();
    // wait for the rebuild this edit triggers (CRA prints one "Compiled" / "Failed to compile" per rebuild)
    while (step.edit && compileCount() === compiles && Date.now() - s0 < 45_000) await sleep(100);
    let s = await state(page), ok = matches(s, step.expect);
    while (!ok && Date.now() - s0 < 45_000) { await sleep(250); s = await state(page); ok = matches(s, step.expect); }
    // CRA reports ForkTsChecker results after the bundle: re-check once the type check had time to land
    if (ok && step.settle) { await sleep(step.settle); s = await state(page); ok = matches(s, step.expect); }
    const r = { step: step.label, ok, ms: Date.now() - s0, overlay: s.overlay?.slice(0, 2000) ?? null, app: markers(section(s.html, 'app')), sdk: markers(section(s.html, 'sdk')) };
    results.push(r);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${step.label} (${r.ms} ms)${r.overlay ? `\n     overlay: ${r.overlay.split('\n').slice(0, 3).join(' | ')}` : ''}\n     app: ${r.app.join(' > ')}\n     sdk: ${r.sdk.join(', ')}`);
    if (!ok) { console.log(`     full overlay:\n${s.overlay}`); break; }
  }
} finally {
  restore();
  await browser?.close();
  child.kill('SIGTERM');
}
console.log('STUNT-DOUBLE-DEV ' + JSON.stringify(results));
process.exit(results.length === scenario.length && results.every((r) => r.ok) ? 0 : 1);
