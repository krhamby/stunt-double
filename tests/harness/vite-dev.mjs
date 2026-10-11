// Vite dev-server probe for suites of the 'vite' family. Drives a real `vite` dev server (in a child process,
// in the fixture app, with the app's own vite.config) through a scenario of live edits WITHOUT restarting it:
//   1. initial          the standard overrides render; the browser's module graph loads cleanly; no project
//                       slot module was frozen into .vite/deps (F6d)
//   2. remove-override  delete PriceTag.tsx       -> the SDK default PriceTag renders
//   3. add-override     put PriceTag.tsx back     -> BRAND_PRICE renders again
//   4. typo             rename Button.tsx to Buton.tsx -> [F2] on the overlay channel, and slot modules fail
//                       to load (poisoned shims): the page can never silently render the SDK default Button
//   5. typo-fixed       rename it back            -> renders again, the browser graph loads cleanly
//   6. contract         an extra required prop    -> [F1] on the overlay channel (async, non-blocking)
//   7. contract-fixed   restore Button.tsx        -> standard render
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD_RENDER } from './expect.mjs';
import { writeJson, tail } from './util.mjs';

const PROBE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vite-dev-probe.mjs');

/**
 * @param {object} [o]
 * @param {string} [o.entry]   SSR entry exporting render(): string (default '/src/entry-server.tsx')
 * @param {object} [o.render]  the standard render (default STANDARD_RENDER)
 * @param {boolean} [o.crawl]  also crawl the browser module graph from index.html (default true)
 */
export function viteDevProbe({ entry = '/src/entry-server.tsx', render = STANDARD_RENDER, crawl = true, timeoutMs = 20000 } = {}) {
  return async (fx, t) => {
    const button = fx.override('Button.tsx');
    const priceTag = fx.override('PriceTag.tsx');
    const steps = [
      { label: 'initial', render, crawl },
      { label: 'remove-override (PriceTag)', remove: [priceTag], render: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, 'BRAND_BUTTON(dark)': 3 } } },
      { label: 'add-override (PriceTag)', write: { [priceTag]: fx.pristineText(priceTag) }, render: { sdk: { BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0 } } },
      { label: 'typo (Buton.tsx)', rename: { [button]: fx.override('Buton.tsx') }, wsError: String.raw`\[F2\][^\n]*Buton`, renderError: 'STUNT-DOUBLE-ERROR|Buton', crawl },
      { label: 'typo-fixed', rename: { [fx.override('Buton.tsx')]: button }, render, crawl },
      {
        label: 'contract mistake (extra required prop)',
        write: { [button]: `import { Button as Original } from '@acme/core/original/Button';\nimport type { SlotProps } from '@acme/core/contracts';\n\nexport function Button({ tone, ...props }: SlotProps['Button'] & { tone: 'loud' }) {\n  return <span data-sd="BRAND_BUTTON" data-ctx={tone}><Original {...props} /></span>;\n}\n` },
        wsError: String.raw`\[F1\] Button`,
      },
      { label: 'contract-fixed', write: { [button]: fx.pristineText(button) }, render },
    ];
    const file = path.join(fx.dir, 'dev-scenario.json');
    writeJson(file, { entry, timeoutMs, steps });
    const r = await fx.run(`node ${JSON.stringify(PROBE)} ${JSON.stringify(file)}`, { timeout: 300_000 });
    const line = r.stdout.split('\n').find((l) => l.startsWith('STUNT-DOUBLE-DEV '));
    assert.ok(line, `the dev probe printed no result (exit ${r.code})\n${tail(r.output)}`);
    const res = JSON.parse(line.slice('STUNT-DOUBLE-DEV '.length));
    assert.ok(res.started, `vite dev server did not start:\n${res.startError}\n${(res.terminal ?? []).join('\n')}`);
    const failures = [];
    for (const [i, s] of res.steps.entries()) {
      const want = steps[i];
      t.diagnostic(`dev ${s.label}: ${s.ok ? 'ok' : 'NOT REACHED'} in ${s.ms} ms${s.crawl ? `; browser graph ${s.crawl.modules} modules, ${s.crawl.errors.length} failed` : ''}`);
      const detail = `${JSON.stringify(s.observed)}${s.mismatch?.length ? ` mismatch: ${s.mismatch.join('; ')}` : ''}${s.wsErrors.length ? `\n      overlay: ${s.wsErrors.join(' || ')}` : ''}`;
      if (!s.ok) failures.push(`step "${s.label}" did not reach its expected state within ${timeoutMs} ms: ${detail}`);
      if (s.crawl) {
        if (want.render && s.crawl.errors.length) failures.push(`step "${s.label}": browser modules failed to load: ${JSON.stringify(s.crawl.errors)}`);
        if (want.render && !s.crawl.overrideModules.length) failures.push(`step "${s.label}": the browser graph contains no module from the overrides directory`);
        if (want.renderError && !s.crawl.errors.some((e) => /STUNT-DOUBLE-ERROR|Buton/.test(`${e.url} ${e.body}`)))
          failures.push(`step "${s.label}": the browser graph loaded without the poison error (it could render the SDK default): ${JSON.stringify(s.crawl.errors)}`);
        if (s.crawl.depsLeak.length) failures.push(`step "${s.label}": project slot modules were pre-bundled into .vite/deps (F6d): ${s.crawl.depsLeak.join(', ')}`);
      }
    }
    assert.deepEqual(failures, [], `${failures.join('\n')}\n  vite terminal (last lines):\n    ${(res.terminal ?? []).join('\n    ')}`);
  };
}
