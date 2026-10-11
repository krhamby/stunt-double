// Vitest 5 suite (beyond tests/vite.test.mjs): examples/customer-vitest with node + jsdom `projects`, browser
// mode in Chromium, an unwired second config, the Vitest config guards, watch mode, and every injection
// mistake with Vitest's observed behaviour.
//
//   npm run setup && node --test tests/vitest.test.mjs
//   Browser mode needs Chromium: `npx playwright install chromium`, or SD_CHROMIUM_PATH=/path/to/chrome.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createWorkspace } from './runners/workspace.mjs';
import { MISTAKES, NOT_WIRED } from './runners/mistakes.mjs';

let ws;
before(() => { ws = createWorkspace('customer-vitest'); });
after(() => ws?.dispose());

const vitest = (...args) => ws.run('vitest', ['run', '--reporter=verbose', ...args]);
const check = () => ws.run('stunt-double', ['check']);
const explain = (r) => `exit ${r.code} in ${r.ms} ms\n${r.out.slice(-4000)}`;
const passes = (r, tests = 4) => {
  assert.equal(r.code, 0, explain(r));
  assert.match(r.out, new RegExp(`Tests\\s+${tests} passed \\(${tests}\\)`), explain(r));
};
/** Startup error: the [Fx] message is printed and no test ran. */
const failsAtStartup = (r, code) => {
  assert.notEqual(r.code, 0, explain(r));
  assert.ok(r.out.includes(`[${code}]`), `expected [${code}] in:\n${explain(r)}`);
  assert.doesNotMatch(r.out, /Tests\s+\d+ passed/, explain(r));
};
const config = (name, body) => ws.write(name, `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';
export default defineConfig(${body});
`);

describe('positive: overrides render in app code and inside SDK components', () => {
  it('`vitest run`: node and jsdom projects (vite.config.ts test.projects)', () => {
    const r = vitest();
    passes(r);
    assert.match(r.out, /\|node\| src\/__tests__\/app\.node\.test\.tsx/);
    assert.match(r.out, /\|jsdom\| src\/__tests__\/app\.dom\.test\.tsx/);
  });
  it('browser mode: the same DOM tests in real Chromium, and no project module in the optimizer cache', () => {
    const r = ws.run('vitest', ['run', '--reporter=verbose', '-c', 'vitest.browser.config.ts'], { env: { SD_CHROMIUM_PATH: process.env.SD_CHROMIUM_PATH ?? '' }, timeout: 300_000 });
    passes(r, 2);
    assert.match(r.out, /chromium/i);
    const vite = path.join(ws.dir, 'node_modules/.vite');
    const files = fs.existsSync(vite) ? fs.readdirSync(vite, { recursive: true }).map(String).filter((f) => f.endsWith('.js')) : [];
    for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(vite, f), 'utf8'), /BRAND_(BUTTON|PRICE|LOGO)|sdk-slots\/gen/, `F6d: ${f} froze a project module`);
  });
  it('opt-in type gate (globalSetup) passes on correct overrides', () => passes(vitest('-c', 'vitest.typecheck.config.ts')));
  it('stunt-double check and tsc -b pass', () => {
    assert.equal(check().code, 0);
    const r = ws.run('tsc', ['-b']);
    assert.equal(r.code, 0, explain(r));
  });
});

describe('static mistakes fail `vitest run` at startup (the plugin generates with onError "throw" under Vitest)', () => {
  for (const id of ['F2a', 'F2b', 'F3', 'F4', 'F5', 'F6a', 'F6g', 'F7', 'F8']) {
    it(`${id}: ${MISTAKES[id].title}`, () => {
      MISTAKES[id].apply(ws);
      try {
        failsAtStartup(vitest(), id.slice(0, 2));
        assert.notEqual(check().code, 0);
      } finally { ws.reset(); }
    });
  }
});

describe('contract mistakes (TYP): Vitest never type-checks', () => {
  it('F1a: plain `vitest run` passes but PRINTS the [F1] diagnostic (plugin dev gate); the opt-in globalSetup gate and `stunt-double check` fail', () => {
    MISTAKES.F1a.apply(ws);
    try {
      const r = vitest();
      passes(r);
      assert.match(r.out, /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/);
      failsAtStartup(vitest('-c', 'vitest.typecheck.config.ts'), 'F1');
      assert.notEqual(check().code, 0);
      assert.notEqual(ws.run('npm', ['run', '-s', 'ci']).code, 0);
    } finally { ws.reset(); }
  });
  it('F1b: plain `vitest run` passes; the opt-in gate and `stunt-double check` fail', () => {
    MISTAKES.F1b.apply(ws);
    try {
      passes(vitest());
      failsAtStartup(vitest('-c', 'vitest.typecheck.config.ts'), 'F1');
      const c = check();
      assert.match(c.out, /\[F1\] PriceTag .*override ignores these SDK props/);
    } finally { ws.reset(); }
  });
  it('F9c: plain `vitest run` fails at React RUNTIME inside the tests (and prints [F9]); the opt-in gate fails at startup', () => {
    MISTAKES.F9c.apply(ws);
    try {
      const r = vitest();
      assert.notEqual(r.code, 0, explain(r));
      assert.match(r.out, /<Logo> is an async Client Component|suspended while responding to synchronous input/);
      failsAtStartup(vitest('-c', 'vitest.typecheck.config.ts'), 'F9');
    } finally { ws.reset(); }
  });
});

describe('wiring and graph mistakes (F6)', () => {
  it('not a mistake: the registry placeholder is installed (what a real install gets) and the plugin aliases around it', () => {
    assert.ok(ws.exists('node_modules/@acme/core-slots/not-wired.js'));
    passes(vitest());
  });
  it('F6b: a second vitest config without the plugin, universal-tier link installed: Node refuses the .jsx shim, never renders defaults', () => {
    ws.linkSlots();
    try {
      const r = vitest('-c', 'vitest.unwired.config.ts');
      assert.notEqual(r.code, 0, explain(r));
      assert.match(r.out, /Unknown file extension "\.jsx" for .*sdk-slots\/gen\/Button\.jsx/, explain(r));
    } finally { ws.reset(); }
  });
  it('F6b: the same config with jsdom: fails the same way', () => {
    ws.linkSlots();
    ws.edit('vitest.unwired.config.ts', (s) => s.replace("environment: 'node', include: ['src/**/*.node.test.tsx']", "environment: 'jsdom', include: ['src/**/*.dom.test.tsx']"));
    try {
      const r = vitest('-c', 'vitest.unwired.config.ts');
      assert.notEqual(r.code, 0, explain(r));
      assert.match(r.out, /Unknown file extension "\.jsx"/, explain(r));
    } finally { ws.reset(); }
  });
  it('F6b: config without the plugin, placeholder installed (the default install): the poisoned import names the fix', () => {
    try {
      const r = vitest('-c', 'vitest.unwired.config.ts');
      assert.notEqual(r.code, 0, explain(r));
      assert.ok(r.out.includes(`${NOT_WIRED} -- @acme core-slots is not provided by this project`), explain(r));
    } finally { ws.reset(); }
  });
  it('F6b: a `projects` entry pointing at a config file without the plugin fails; inline projects inherit the root plugins', () => {
    config('vitest.mixed.config.ts', `{ plugins: [react(), stuntDouble()], test: { projects: [
      { test: { name: 'inline-no-extends', environment: 'node', include: ['src/**/*.node.test.tsx'] } },
      './vitest.unwired.config.ts',
    ] } }`);
    try {
      const r = vitest('-c', 'vitest.mixed.config.ts');
      assert.notEqual(r.code, 0, explain(r));
      assert.ok(r.out.includes(NOT_WIRED), explain(r));
      assert.match(r.out, /Tests\s+2 passed \(2\)/, 'the inline project (no `extends`) still gets the plugin in Vitest 5: with only the placeholder installed it could not render otherwise');
    } finally { ws.reset(); }
  });
  for (const env of ['client', 'ssr']) {
    it(`F6c: test.deps.optimizer.${env} including @acme/core is refused at startup`, () => {
      config('vitest.bad.config.ts', `{ plugins: [react(), stuntDouble()], test: { deps: { optimizer: { ${env}: { enabled: true, include: ['@acme/core'] } } } } }`);
      try {
        const r = vitest('-c', 'vitest.bad.config.ts');
        failsAtStartup(r, 'F6');
        assert.match(r.out, new RegExp(`Vitest deps\\.optimizer\\.${env} pre-bundles @acme/core`));
      } finally { ws.reset(); }
    });
  }
  it('not mistakes in Vitest: server.deps.external / ssr.external of the SDK and an enabled optimizer without the SDK still render the overrides (the plugin inlines @acme/core)', () => {
    for (const extra of [
      "test: { include: ['src/**/*.node.test.tsx'], server: { deps: { external: ['@acme/core'] } } }",
      "ssr: { external: ['@acme/core'] }, test: { include: ['src/**/*.node.test.tsx'] }",
      "test: { include: ['src/**/*.dom.test.tsx'], environment: 'jsdom', deps: { optimizer: { client: { enabled: true } } } }",
    ]) {
      config('vitest.ok.config.ts', `{ plugins: [react(), stuntDouble()], ${extra} }`);
      try { passes(vitest('-c', 'vitest.ok.config.ts'), 2); } finally { ws.reset(); }
    }
  });
  it('F6h: an override added without regenerating: the plugin regenerates at startup', () => {
    ws.remove('src/overrides/PriceTag.tsx');
    assert.equal(ws.run('stunt-double', ['gen']).code, 0);
    ws.reset();
    assert.match(ws.read('sdk-slots/gen/PriceTag.jsx'), /@acme\/core\/original\/PriceTag/);
    passes(vitest());
    assert.match(ws.read('sdk-slots/gen/PriceTag.jsx'), /src\/overrides\/PriceTag\.tsx/);
  });
});

describe('vitest watch mode', () => {
  it('a typo mid-session poisons the shims: the re-run fails with the [F2] text; fixing it goes green', async () => {
    const child = spawn(path.join(ws.dir, 'node_modules/.bin/vitest'), ['--watch', '--project', 'node'], { cwd: ws.dir, env: { ...process.env, CI: '', FORCE_COLOR: '0', NO_COLOR: '1' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const waitFor = async (re, from, ms = 60_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (re.test(out.slice(from))) return out.length; await new Promise((r) => setTimeout(r, 100)); }
      throw new Error(`timed out waiting for ${re}:\n${out.slice(-3000)}`);
    };
    try {
      let at = await waitFor(/Tests\s+2 passed/, 0);
      MISTAKES.F2a.apply(ws);
      at = await waitFor(/STUNT-DOUBLE-ERROR -- \[F2\]|\[F2\] src\/overrides\/Buton\.tsx/, at);
      await waitFor(/Tests\s+.*failed|FAIL/, at - 2000 > 0 ? at - 2000 : 0);
      ws.reset();
      await waitFor(/Tests\s+2 passed/, at);
    } finally {
      ws.reset();
      child.kill();
    }
  });
});
