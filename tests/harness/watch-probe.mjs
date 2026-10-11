// Watch-mode probe for bundlers with a `--watch` build (webpack, Rspack). Starts the watcher once in the fixture
// app and edits the overrides WITHOUT restarting it; after each edit it waits for the rebuilds to settle and checks
// the last status of every compiler, then renders the result:
//   1. typo        rename Button.tsx to Buton.tsx -> the rebuild fails with [F2]
//   2. typo-fixed  rename it back                 -> every compiler succeeds
//   3. remove      delete PriceTag.tsx            -> succeeds, the SDK default PriceTag renders
//   4. re-add      put PriceTag.tsx back          -> succeeds, BRAND_PRICE renders again (webpack once cached the
//                  exports of the stale shim here and failed with "module has no exports" until restart)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { STANDARD_RENDER, assertRender } from './expect.mjs';
import { childEnv, tail } from './util.mjs';

/** "client (webpack 5.111.1) compiled successfully in 75 ms" / "ssr compiled with 2 errors in 9 ms" */
const STATUS = /^\s*(\S+)\b.*\bcompiled (successfully|with \d+ errors?)/gm;

/**
 * @param {object} o
 * @param {string} o.command   the watch command, e.g. 'webpack --mode development --watch'
 * @param {number} [o.settleMs]  quiet time after the last status line that ends a rebuild (default 1500)
 */
export function watchProbe({ command, settleMs = 1500, timeoutMs = 60_000 }) {
  return async (fx, t, suite) => {
    const child = spawn('sh', ['-c', command], { cwd: fx.app, env: childEnv(fx.app), detached: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /** Wait until the output since `from` has a status line and then stays quiet; the last status per compiler. */
    const settle = async (from) => {
      const t0 = Date.now();
      let seen = -1;
      let quietSince = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        await sleep(100);
        const chunk = out.slice(from);
        if (chunk.length !== seen) { seen = chunk.length; quietSince = Date.now(); continue; }
        const status = {};
        for (const m of chunk.matchAll(STATUS)) status[m[1]] = m[2];
        if (Object.keys(status).length && Date.now() - quietSince >= settleMs) return { status, chunk };
      }
      throw new Error(`no settled rebuild within ${timeoutMs} ms\n${tail(out.slice(from))}`);
    };
    const priceTag = fx.override('PriceTag.tsx');
    const button = fx.override('Button.tsx');
    const steps = [
      { label: 'typo (Buton.tsx)', edit: () => fx.rename(button, fx.override('Buton.tsx')), fails: /\[F2\][^\n]*Buton/ },
      { label: 'typo-fixed', edit: () => fx.rename(fx.override('Buton.tsx'), button), render: suite.positive.render ?? STANDARD_RENDER },
      { label: 'remove-override (PriceTag)', edit: () => fx.remove(priceTag), render: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } } },
      { label: 're-add-override (PriceTag)', edit: () => fx.restore(priceTag), render: { sdk: { BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0 } } },
    ];
    try {
      const first = await settle(0);
      assert.ok(Object.values(first.status).every((s) => s === 'successfully'), `the initial watch build failed\n${tail(first.chunk)}`);
      for (const s of steps) {
        const from = out.length;
        s.edit();
        const { status, chunk } = await settle(from);
        t.diagnostic(`watch ${s.label}: ${JSON.stringify(status)}`);
        if (s.fails) {
          assert.match(chunk, s.fails, `watch ${s.label}: the rebuild did not report the mistake\n${tail(chunk)}`);
          assert.ok(Object.values(status).some((x) => x !== 'successfully'), `watch ${s.label}: the rebuild succeeded\n${tail(chunk)}`);
        } else {
          assert.ok(Object.values(status).every((x) => x === 'successfully'), `watch ${s.label}: a compiler did not recover\n${tail(chunk)}`);
          assertRender(await fx.run(suite.commands.render), s.render, `watch ${s.label}: `);
        }
      }
    } finally {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  };
}
