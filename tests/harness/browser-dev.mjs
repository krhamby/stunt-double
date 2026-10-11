// Browser dev-server probe for tools whose dev server has its own error overlay (Rsbuild, Gatsby, ...). Starts
// the tool's REAL dev command in the fixture app, opens the page in Chromium (Playwright) and plays live edits
// WITHOUT restarting the server. After each edit it waits until the expected state holds for 1.5 s:
//   initial            the standard overrides render, no overlay
//   remove-override    delete PriceTag.tsx      -> the SDK default PriceTag renders, no overlay
//   add-override       put PriceTag.tsx back    -> BRAND_PRICE renders again, no overlay
//   <mistake>          F2a typo, F3 missing Logo, F5 wrong export, F7 self import, F1a contract
//                      -> the overlay shows the [Fx] line
//   <mistake> fixed    -> the overlay clears and the standard render is back
// Playwright is not a repo dependency: it is resolved from the repo or the global npm root
// (CI: `npm i -g playwright@1.56.1 && playwright install --with-deps chromium`).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { STANDARD_RENDER } from './expect.mjs';
import { summarize, compareRender } from './markers.mjs';
import { REPO_ROOT, childEnv } from './util.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  const roots = [path.join(REPO_ROOT, 'package.json')];
  try { roots.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'noop.js')); } catch {}
  for (const r of roots) {
    try { return createRequire(r)('playwright'); } catch {}
  }
  throw new Error('the dev-server probe needs Playwright: npm i -g playwright@1.56.1 && playwright install chromium');
}

async function launch(chromium) {
  const args = ['--no-proxy-server'];
  try { return await chromium.launch({ args }); } catch (e) {
    for (const executablePath of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium']) {
      try { return await chromium.launch({ args, executablePath }); } catch {}
    }
    throw e;
  }
}

/**
 * @param {object} o
 * @param {string} o.command      dev command; "{port}" is replaced by a free port (PORT is also set)
 * @param {string} o.overlay      CSS selector of the error overlay element (iframe or shadow-root host)
 * @param {number} [o.startTimeoutMs]  wait for the first good render (default 180 s)
 * @param {number} [o.stepTimeoutMs]   wait for each step (default 60 s)
 * @param {object} [o.render]     the standard render (default STANDARD_RENDER)
 */
export function browserDevProbe({ command, overlay, startTimeoutMs = 180_000, stepTimeoutMs = 60_000, render = STANDARD_RENDER }) {
  return async (fx, t) => {
    const { chromium } = loadPlaywright();
    const port = 20000 + Math.floor(Math.random() * 20000);
    const cmd = command.replaceAll('{port}', String(port));
    const srv = spawn('sh', ['-c', cmd], { cwd: fx.app, env: childEnv(fx.app, { PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '';
    srv.stdout.on('data', (b) => { log += b; });
    srv.stderr.on('data', (b) => { log += b; });
    let browser;
    const ov = (f) => fx.override(f);
    const button = fx.pristineText(ov('Button.tsx'));
    const price = fx.pristineText(ov('PriceTag.tsx'));
    try {
      browser = await launch(chromium);
      const page = await browser.newPage();
      const state = async () => page.evaluate((sel) => {
        const o = document.querySelector(sel);
        const overlayText = o ? ((o.shadowRoot ? o.shadowRoot.textContent : o.contentDocument?.body?.innerText) ?? '') : null;
        return { html: document.body.innerHTML, overlay: overlayText };
      }, overlay).catch(() => ({ html: '', overlay: null }));
      const renders = (expect) => async () => { const s = await state(); return s.overlay === null && compareRender(summarize(s.html), expect).length === 0; };
      const shows = (re) => async () => re.test((await state()).overlay ?? '');
      const until = async (label, cond, ms) => {
        const t0 = performance.now();
        for (;;) {
          if (await cond()) { await sleep(1500); if (await cond()) { t.diagnostic(`dev ${label}: ok in ${Math.round(performance.now() - t0)} ms`); return; } }
          if (performance.now() - t0 > ms) {
            const s = await state();
            const sum = summarize(s.html);
            assert.fail(`dev ${label}: not reached within ${ms} ms\n  overlay: ${s.overlay === null ? '(none)' : s.overlay.replace(/\s+/g, ' ').slice(0, 600)}\n  app: ${sum.app.join(' > ')}\n  sdk: ${sum.sdk.join(', ')}\n--- dev server (tail) ---\n${log.slice(-4000)}`);
          }
          await sleep(200);
        }
      };

      const t0 = performance.now();
      for (;;) {
        try { await page.goto(`http://localhost:${port}/`, { timeout: 10_000 }); if ((await state()).html.includes('data-probe')) break; } catch {}
        if (performance.now() - t0 > startTimeoutMs) assert.fail(`dev server did not serve the app within ${startTimeoutMs} ms\n${log.slice(-4000)}`);
        await sleep(1000);
      }
      await until('initial', renders(render), startTimeoutMs);

      fx.remove(ov('PriceTag.tsx'));
      await until('remove-override (PriceTag)', renders({ sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, 'BRAND_BUTTON(dark)': 3 } }), stepTimeoutMs);
      fx.write(ov('PriceTag.tsx'), price);
      await until('add-override (PriceTag)', renders(render), stepTimeoutMs);

      const mistakes = [
        ['F2a typo', () => fx.write(ov('Buton.tsx'), button), () => fx.remove(ov('Buton.tsx')), /\[F2\][^\n]*Buton\.tsx overrides unknown slot/],
        ['F3 required slot missing', () => fx.rename(ov('Logo.tsx'), ov('_Logo.tsx')), () => fx.rename(ov('_Logo.tsx'), ov('Logo.tsx')), /\[F3\] required slot "Logo"/],
        ['F5 wrong export', () => fx.write(ov('Button.tsx'), button.replace('export function Button', 'export default function Button')), () => fx.write(ov('Button.tsx'), button), /\[F5\][^\n]*must export a named `Button`/],
        ['F7 self import', () => fx.write(ov('Button.tsx'), `import { Button as Self } from '@acme/core';\nconsole.log(Self);\n${button}`), () => fx.write(ov('Button.tsx'), button), /\[F7\][^\n]*Button\.tsx/],
        ['F1a contract', () => fx.write(ov('Button.tsx'), button.replace("props: SlotProps['Button']", "props: SlotProps['Button'] & { tone: 'loud' }")), () => fx.write(ov('Button.tsx'), button), /\[F1\] Button \([^)]*Button\.tsx\): TS2322/],
      ];
      for (const [name, make, fix, re] of mistakes) {
        make();
        await until(`${name}: overlay shows ${re}`, shows(re), stepTimeoutMs);
        fix();
        await until(`${name}: overlay clears after the fix`, renders(render), stepTimeoutMs);
      }
    } finally {
      await browser?.close().catch(() => {});
      try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
      await sleep(500);
      try { process.kill(-srv.pid, 'SIGKILL'); } catch {}
    }
  };
}
