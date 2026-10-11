// `storybook dev` probe for the Storybook suites (builder-vite and builder-webpack5). Drives ONE real
// `storybook dev` server in the fixture app through live edits, without restarting it, and reads what the
// developer sees: the rendered story in headless Chromium (iframe.html, reloaded for every poll), the Vite
// overlay text, and the dev server's terminal.
//   1. initial          the standard overrides render
//   2. remove-override  delete PriceTag.tsx           -> the SDK default PriceTag renders
//   3. add-override     put PriceTag.tsx back         -> BRAND_PRICE renders again
//   4. typo             rename Button.tsx to Buton.tsx -> [F2] in the terminal (vite: also on the overlay),
//                       and the story renders NO slot at all (never the SDK default Button)
//   5. typo-fixed       rename it back                -> standard render
//   6. contract         (vite only) an extra required prop -> [F1] in the terminal (async type gate)
//   7. contract-fixed   (vite only) restore Button.tsx -> standard render
// builder-webpack5 runs no type gate in development mode (docs/tools/storybook.md, DESIGN §14 R3), so steps
// 6-7 are vite-only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STANDARD_RENDER } from './harness/expect.mjs';
import { summarize, compareRender } from './harness/markers.mjs';

const STORY = 'app-page--page';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\s*\n[\s|│]*/g, ' ');
const freePort = () => new Promise((done) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });

/** @param {{ configDir?: string, builder: 'vite' | 'webpack', timeoutMs?: number }} o */
export function storybookDevProbe({ configDir = '.storybook', builder, timeoutMs = 30_000 }) {
  return async (fx, t) => {
    const button = fx.override('Button.tsx');
    const priceTag = fx.override('PriceTag.tsx');
    const contract = `import { Button as Original } from '@acme/core/original/Button';\nimport type { SlotProps } from '@acme/core/contracts';\n\nexport function Button({ tone, ...props }: SlotProps['Button'] & { tone: 'loud' }) {\n  return <span data-sd="BRAND_BUTTON" data-ctx={tone}><Original {...props} /></span>;\n}\n`;
    const steps = [
      { label: 'initial', render: STANDARD_RENDER },
      { label: 'remove-override (PriceTag)', act: () => fx.remove(priceTag), render: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, 'BRAND_BUTTON(dark)': 3 } } },
      { label: 'add-override (PriceTag)', act: () => fx.write(priceTag, fx.pristineText(priceTag)), render: { sdk: { BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0 } } },
      { label: 'typo (Buton.tsx)', act: () => fx.rename(button, fx.override('Buton.tsx')), noSlots: true, terminal: /\[F2\][^|]*Buton/, overlay: builder === 'vite' ? /\[F2\][^|]*Buton/ : null },
      { label: 'typo-fixed', act: () => fx.rename(fx.override('Buton.tsx'), button), render: STANDARD_RENDER },
      ...(builder === 'vite' ? [
        { label: 'contract mistake (extra required prop)', act: () => fx.write(button, contract), terminal: /\[F1\] Button/ },
        { label: 'contract-fixed', act: () => fx.write(button, fx.pristineText(button)), render: STANDARD_RENDER },
      ] : []),
    ];

    const port = await freePort();
    const bin = path.join(fx.app, 'node_modules', 'storybook', 'dist', 'bin', 'dispatcher.js');
    const env = { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1', NO_COLOR: '1', CI: '1', PATH: `${path.join(fx.app, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}` };
    for (const k of Object.keys(env)) if (k.startsWith('npm_')) delete env[k];
    const server = spawn(process.execPath, [bin, 'dev', '-c', configDir, '-p', String(port), '--ci', '--no-open', '--host', '127.0.0.1'], { cwd: fx.app, env, detached: true });
    let terminal = '';
    server.stdout.on('data', (d) => (terminal += d));
    server.stderr.on('data', (d) => (terminal += d));
    let exited = null;
    server.on('exit', (code) => { exited = code; });
    const { chromium } = await import(pathToFileURL(path.join(fx.app, 'node_modules', 'playwright-core', 'index.mjs')).href);
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
    const failures = [];
    try {
      const url = `http://127.0.0.1:${port}/iframe.html?id=${STORY}&viewMode=story`;
      for (let i = 0; i < 240 && exited === null; i++) {
        if (await fetch(url).then((r) => r.ok, () => false)) break;
        await sleep(500);
      }
      assert.equal(exited, null, `storybook dev exited (${exited}) before serving:\n${flat(terminal).slice(-3000)}`);
      const page = await browser.newPage();
      const look = async () => {
        await page.goto(url).catch(() => {});
        await page.waitForFunction(() => document.querySelector('vite-error-overlay') || /sb-show-(errordisplay|nopreview)/.test(document.body.className)
          || document.querySelector('#storybook-root')?.childElementCount > 0, null, { timeout: 15_000 }).catch(() => {});
        await sleep(300);
        return page.evaluate(() => ({
          html: document.querySelector('#storybook-root')?.innerHTML ?? '',
          overlay: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent ?? '',
          error: /sb-show-errordisplay/.test(document.body.className) ? document.querySelector('#error-message')?.textContent ?? 'error' : '',
        }));
      };
      for (const s of steps) {
        const mark = terminal.length;
        s.act?.();
        const t0 = performance.now();
        let seen = null;
        let ok = false;
        while (performance.now() - t0 < timeoutMs) {
          await sleep(s.act ? 700 : 0);
          seen = await look();
          const sum = summarize(seen.html);
          const term = flat(terminal.slice(mark));
          const checks = [
            !s.render || (!seen.error && !seen.overlay && compareRender(sum, s.render).length === 0),
            !s.noSlots || sum.all.length === 0,
            !s.terminal || s.terminal.test(term),
            !s.overlay || s.overlay.test(flat(seen.overlay)),
          ];
          if (checks.every(Boolean)) { ok = true; break; }
        }
        const ms = Math.round(performance.now() - t0);
        t.diagnostic(`dev ${s.label}: ${ok ? 'ok' : 'NOT REACHED'} in ${ms} ms`);
        if (!ok) failures.push(`step "${s.label}" not reached within ${timeoutMs} ms: markers [${summarize(seen?.html ?? '').all.join(', ')}] error "${String(seen?.error).slice(0, 200)}" overlay "${flat(seen?.overlay ?? '').slice(0, 300)}"\n    terminal since the edit: ${flat(terminal.slice(mark)).slice(-1500)}`);
        if (exited !== null) { failures.push(`storybook dev exited (${exited}) during step "${s.label}"`); break; }
      }
    } finally {
      await browser.close();
      try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  };
}
