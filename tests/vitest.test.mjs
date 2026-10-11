// Vitest 5 beyond the reference suite (tests/vite.test.mjs already checks that Vitest refuses mistakes at
// startup through customer-vite's vite.config.ts): examples/customer-vitest runs node AND jsdom `projects`,
// browser mode in Chromium, an opt-in type gate (globalSetup), configs and projects WITHOUT the plugin, the
// Vitest config guards, watch mode, and the universal tier. For a test runner the "build" is the test run: the
// node and jsdom tests render <App/> and write the HTML that probes/render.mjs prints. See docs/tools/vitest.md.
//
// Browser mode needs Chromium: `npx playwright install chromium`, or SD_CHROMIUM_PATH=/path/to/chrome.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { defineToolSuite, STANDARD_RENDER } from './harness/index.mjs';

// A second Vitest config that forgot the plugin.
const UNWIRED_CONFIG = `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A second Vitest config without stuntDouble() (e.g. an IDE runner's own config).
export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.node.test.tsx'] },
});
`;

// Universal tier: no plugin. The SDK must be inlined (Node cannot load the .jsx shims); Vite then resolves the
// socket through the package link to the generated shims.
const UNIVERSAL_CONFIG = `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    server: { deps: { inline: ['@acme/core'] } },
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include: ['src/**/*.node.test.tsx'] } },
      { extends: true, test: { name: 'jsdom', environment: 'jsdom', include: ['src/**/*.dom.test.tsx'] } },
    ],
  },
});
`;

const MIXED_CONFIG = `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

export default defineConfig({
  plugins: [react(), stuntDouble()],
  test: {
    projects: [
      { test: { name: 'inline-no-extends', environment: 'node', include: ['src/**/*.node.test.tsx'] } },
      './vitest.unwired.config.ts',
    ],
  },
});
`;

const EXTRA = [
  {
    id: 'F6b-project',
    title: 'a `projects` entry that is a config file WITHOUT the plugin fails; the inline project next to it still renders',
    catches: 'RES (registry placeholder)',
    tags: ['res'],
    apply: (fx) => { fx.write('vitest.unwired.config.ts', UNWIRED_CONFIG); fx.write('vitest.mixed.config.ts', MIXED_CONFIG); },
    expect: { outcome: 'fail', run: 'vitest run -c vitest.mixed.config.ts', messages: [/STUNT-DOUBLE-NOT-WIRED/, /Tests\s+1 passed/] },
  },
  {
    id: 'V-external',
    title: 'must pass: server.deps.external / ssr.external naming the SDK are inert under Vitest (the plugin inlines @acme/core)',
    catches: 'prevented (server.deps.inline wins)',
    tags: ['must-pass'],
    apply: (fx) => fx.edit('vite.config.ts', (s) => s.replace('test: {', "ssr: { external: ['@acme/core'] },\n  test: {\n    server: { deps: { external: ['@acme/core'] } },")),
    expect: { outcome: 'pass', command: 'build', render: STANDARD_RENDER },
  },
];

defineToolSuite({
  name: 'vitest',
  family: 'vite',
  fixtureDir: 'examples/customer-vitest',
  toolConfig: 'vite.config.ts',
  commands: {
    build: 'vitest run',
    render: 'node probes/render.mjs',
    test: 'vitest run',
    gated: 'vitest run -c vitest.typecheck.config.ts',
    browser: 'vitest run -c vitest.browser.config.ts',
    typecheck: 'tsc -b',
  },
  outputs: ['dist'],
  positive: { alsoPass: ['check', 'gated', 'browser', 'typecheck'] },
  unwired: {
    files: { 'vitest.unwired.config.ts': UNWIRED_CONFIG },
    command: 'vitest run -c vitest.unwired.config.ts',
  },
  mutations: (list) => [...list, ...EXTRA],
  expectations: (m, exp) => {
    if (m.id === 'F6c-ssr') return 'customer-vitest has no SSR build; the Vite SSR guard is covered by tests/vite.test.mjs';
    // Vitest never type-checks: contract mistakes are caught by the CLI gate (`stunt-double check && vitest run`,
    // the fixture's "ci" script) or by the opt-in globalSetup gate (vitest.typecheck.config.ts).
    if (m.tags?.includes('typegate') && exp.outcome === 'fail') return { command: 'checkThenBuild', also: [{ command: 'gated' }] };
    return undefined;
  },
  devProbe: watchProbe,
  universal: {
    files: { 'vitest.universal.config.ts': UNIVERSAL_CONFIG },
    build: 'stunt-double check && vitest run -c vitest.universal.config.ts',
    bare: 'vitest run -c vitest.universal.config.ts',
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});

/**
 * `vitest` (watch mode): the plugin watches src/overrides. A typo mid-session poisons the shims (the re-run
 * fails with the [F2] text); fixing it goes green; removing an override switches what renders, no restart.
 */
async function watchProbe(fx) {
  const child = spawn(path.join(fx.app, 'node_modules/.bin/vitest'), ['--watch', '--project', 'node'], {
    cwd: fx.app,
    env: { ...process.env, CI: '', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const waitFor = async (re, from, ms = 60_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = out.slice(from).search(re);
      if (i >= 0) return from + i + 1;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`vitest --watch: timed out waiting for ${re}:\n${out.slice(-3000)}`);
  };
  try {
    let at = await waitFor(/Tests\s+1 passed/, 0);
    fx.write(fx.override('Buton.tsx'), fx.pristineText(fx.override('Button.tsx')));
    at = await waitFor(/STUNT-DOUBLE-ERROR -- \[F2\]|\[F2\] src\/overrides\/Buton\.tsx/, at);
    await waitFor(/Tests\s+[^\n]*failed|FAIL/, at - 1);
    fx.remove(fx.override('Buton.tsx'));
    at = await waitFor(/Tests\s+1 passed/, at);
    fx.remove(fx.override('PriceTag.tsx'));
    await waitFor(/Tests\s+1 passed/, at);
    for (let len = -1; len !== out.length;) { len = out.length; await new Promise((r) => setTimeout(r, 2000)); }
    const html = fx.read('dist/render.node.html');
    assert.match(html, /SDK_DEFAULT_PRICETAG/, 'the removed override falls back to the SDK default live');
    assert.doesNotMatch(html, /BRAND_PRICE/);
  } finally {
    child.kill();
  }
}
