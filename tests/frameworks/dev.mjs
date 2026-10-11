// Dev-server probe for framework suites that run their own dev command (react-router dev, astro dev) instead of
// a bare Vite server. Drives the real dev server in the installed fixture, with the page open in Chromium
// (Playwright), through live edits WITHOUT a restart:
//   1. initial     the SSR page renders the overrides; no overlay
//   2. typo        Buton.tsx appears   -> overlay names [F2] + the file, the page request is HTTP 500; removing
//                                         the file restores the overrides and the overlay is gone after reload
//   3. contract    an extra required prop (catalogue F1a) -> overlay [F1] Button, non-blocking (HTTP 200);
//                                         restoring the file clears it
//   4. bypass      app code imports @acme/core/original/Button (catalogue F6g) -> overlay [F6] + the file,
//                                         HTTP 500; removing the file restores the overrides
// Steps 3 and 4 are regressions of adapter fixes (F1 replayed from the type gate memo; F6g only checked at start).
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { childEnv, REPO_ROOT, tail } from '../harness/util.mjs';
import { byId } from '../mutations/index.mjs';

let nextPort = 5600 + (process.pid % 300) * 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  const roots = [REPO_ROOT, ...(process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean)];
  try { roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()); } catch {}
  for (const r of roots) { try { return createRequire(path.join(r, 'noop.js'))('playwright'); } catch {} }
  throw new Error('the dev probe needs playwright with Chromium: npm i -g playwright && npx playwright install chromium');
}

async function get(url) {
  try { const r = await fetch(url); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; }
}

async function until(fn, pred, ms) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (pred(last)) return { value: last, ms: Date.now() - t0 };
    await sleep(200);
  }
  return { value: last, ms: Date.now() - t0, timedOut: true };
}

/** Vite's (or Astro's) error overlay text, whitespace-collapsed; null when there is none. */
const overlayText = (page) => page.evaluate(() => {
  const t = document.querySelector('vite-error-overlay')?.shadowRoot?.textContent;
  return t == null ? null : t.replace(/\s+/g, ' ');
}).catch(() => null);

async function gotoRetry(page, url) {
  // clearing an error sends a full-reload; a navigation racing it is retried
  for (let i = 0; ; i++) {
    try { await page.goto(url); return; } catch (e) { if (i === 3) throw e; await sleep(500); }
  }
}

/**
 * @param {object} o
 * @param {string} o.command        dev command run in the app (node_modules/.bin first on PATH); `--port <n>` is appended
 * @param {object} [o.env]          extra environment for the dev server
 * @param {RegExp} [o.forbidLog]    must never appear in the dev server's terminal (e.g. a false positive)
 */
export function frameworkDevProbe({ command, env = {}, forbidLog = null, timeoutMs = 30_000 }) {
  return async (fx, t, suite) => {
    const { chromium } = loadPlaywright();
    const port = nextPort++;
    const url = `http://localhost:${port}/`;
    const child = spawn('sh', ['-c', `exec ${command} --port ${port}`], { cwd: fx.app, env: childEnv(fx.app, env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const browser = await chromium.launch();
    const failures = [];
    const step = (label, ok, detail) => { t.diagnostic(`dev ${label}: ${ok ? 'ok' : 'FAILED'}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(`${label}: ${detail}`); };
    const rendersOverrides = (r) => r.status === 200 && r.text.includes('data-sd="BRAND_LOGO"') && r.text.includes('data-sd="BRAND_PRICE"') && !r.text.includes('data-sd="SDK_DEFAULT_PRICETAG"');
    const recovered = async (label, page) => {
      const r = await until(() => get(url), rendersOverrides, timeoutMs);
      await gotoRetry(page, url);
      await sleep(1000); // let the page hydrate and its HMR socket connect before the next edit
      const o = await overlayText(page);
      step(`${label} fixed`, !r.timedOut && o === null, r.timedOut ? `HTTP ${r.value.status}, overrides not rendered` : o ? `overlay still shows: ${o.slice(0, 160)}` : `${r.ms} ms`);
    };
    try {
      const start = await until(() => get(url), rendersOverrides, 60_000);
      assert.ok(!start.timedOut, `dev server never rendered the overrides (last HTTP ${start.value?.status}):\n${tail(log)}`);
      const page = await browser.newPage();
      await gotoRetry(page, url);
      await sleep(1000);
      step('initial', (await overlayText(page)) === null, `${start.ms} ms`);

      const scenarios = [
        { label: 'typo (Buton.tsx)', apply: () => fx.write(fx.override('Buton.tsx'), 'export function Buton() { return null; }\n'), overlay: /\[F2\][^\n]*Buton/, status: 500, undo: () => fx.remove(fx.override('Buton.tsx')) },
        { label: 'contract (F1a)', apply: () => byId('F1a').apply(fx, suite), overlay: /\[F1\] Button/, status: 200, undo: () => fx.write(fx.override('Button.tsx'), fx.pristineText(fx.override('Button.tsx'))) },
        { label: 'bypass (F6g)', apply: () => byId('F6g').apply(fx, suite), overlay: /\[F6\][^\n]*legacy[ /]LegacyBanner\.tsx/, status: 500, undo: () => fx.remove(fx.src('legacy')) },
      ];
      for (const s of scenarios) {
        s.apply();
        const o = await until(() => overlayText(page), (x) => !!x && s.overlay.test(x), timeoutMs);
        step(`${s.label} overlay`, !o.timedOut, o.timedOut ? `overlay: ${JSON.stringify(o.value)}; page ${page.url()}: ${(await page.content().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}` : `${o.ms} ms: ${o.value.slice(Math.max(0, o.value.search(/\[F\d/) - 40), o.value.search(/\[F\d/) + 120)}`);
        const r = await until(() => get(url), (x) => x.status === s.status, timeoutMs);
        step(`${s.label} HTTP ${s.status}`, !r.timedOut, r.timedOut ? `got ${r.value.status}` : '');
        s.undo();
        await recovered(s.label, page);
      }
      if (forbidLog) step('terminal free of false positives', !forbidLog.test(log), (log.match(forbidLog) ?? [''])[0]);
    } finally {
      await browser.close().catch(() => {});
      await new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); try { process.kill(-child.pid, 'SIGTERM'); } catch { r(); } setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} r(); }, 4000); });
    }
    assert.deepEqual(failures, [], `dev probe:\n  ${failures.join('\n  ')}\n--- dev server terminal ---\n${tail(log, 60)}`);
  };
}
