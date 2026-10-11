// Jest 30 suite: examples/customer-jest with stunt-double/jest (babel-jest and @swc/jest, jsdom + node test
// environments), the universal tier (no mapper), and every injection mistake with Jest's observed behaviour.
//
//   npm run setup && node --test tests/jest.test.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from './runners/workspace.mjs';
import { MISTAKES, NOT_WIRED } from './runners/mistakes.mjs';

let ws;
before(() => { ws = createWorkspace('customer-jest'); });
after(() => ws?.dispose());

const jest = (...args) => ws.run('jest', args);
const check = () => ws.run('stunt-double', ['check']);
const explain = (r) => `exit ${r.code} in ${r.ms} ms\n${r.out.slice(-4000)}`;
const passes = (r, tests = 4) => {
  assert.equal(r.code, 0, explain(r));
  assert.match(r.out, new RegExp(`Tests:\\s+${tests} passed, ${tests} total`), explain(r));
};
/** Exit non-zero at CONFIG LOAD: the [Fx] message is printed and no test file ran. */
const failsAtConfig = (r, code) => {
  assert.notEqual(r.code, 0, explain(r));
  assert.ok(r.out.includes(`[${code}]`), `expected [${code}] in:\n${explain(r)}`);
  assert.doesNotMatch(r.out, /Tests:\s+\d/, `tests ran although the config should have failed:\n${explain(r)}`);
};

describe('positive: overrides render in app code and inside SDK components', () => {
  it('babel-jest, jsdom + node environments (jest.config.mjs)', () => passes(jest()));
  it('@swc/jest (jest.swc.config.mjs)', () => passes(jest('-c', 'jest.swc.config.mjs')));
  it('universal tier: no mapper, jest-resolve follows a node_modules/@acme/core-slots -> sdk-slots link (chained after stunt-double check)', () => {
    ws.linkSlots();
    try {
      passes(ws.run('sh', ['-c', 'stunt-double check && jest -c jest.universal.config.mjs']));
      assert.ok(ws.exists('sdk-slots/gen/Button.jsx'), 'universal tier: the link target is the outDir');
    } finally { ws.reset(); }
  });
  it('opt-in type gate at config load passes on correct overrides', () => passes(jest('-c', 'jest.typecheck.config.mjs')));
  it('stunt-double check and tsc pass', () => {
    assert.equal(check().code, 0);
    const r = ws.run('tsc', ['--noEmit']);
    assert.equal(r.code, 0, explain(r));
  });
});

describe('static mistakes fail `jest` at config load (babel-jest and @swc/jest)', () => {
  for (const id of ['F2a', 'F2b', 'F3', 'F4', 'F5', 'F6a', 'F6g', 'F7', 'F8']) {
    it(`${id}: ${MISTAKES[id].title}`, () => {
      MISTAKES[id].apply(ws);
      try {
        const code = id.slice(0, 2);
        failsAtConfig(jest(), code);
        failsAtConfig(jest('-c', 'jest.swc.config.mjs'), code);
        const c = check();
        assert.notEqual(c.code, 0, explain(c));
      } finally { ws.reset(); }
    });
  }
  it('F2b names the rename', () => {
    MISTAKES.F2b.apply(ws);
    try { assert.match(jest().out, /slot "PriceTag" was RENAMED to "Price"/); } finally { ws.reset(); }
  });
});

describe('contract mistakes (TYP): babel-jest / @swc/jest never type-check', () => {
  // plain `jest`: F1a/F1b pass (gate-only cells, documented in docs/tools/jest.md); F9c is a React RUNTIME error
  // inside the tests ("<Logo> is an async Client Component"), not a stunt-double diagnostic.
  for (const [id, code, plain] of [['F1a', 'F1', 'passes'], ['F1b', 'F1', 'passes'], ['F9c', 'F9', 'react-runtime-error']]) {
    it(`${id}: ${MISTAKES[id].title}: plain \`jest\` ${plain}; \`stunt-double check\` and the opt-in gate fail`, () => {
      MISTAKES[id].apply(ws);
      try {
        const r = jest();
        if (plain === 'passes') passes(r);
        else {
          assert.notEqual(r.code, 0, explain(r));
          assert.match(r.out, /<Logo> is an async Client Component/, explain(r));
          assert.ok(!r.out.includes('[F9]'), 'plain jest has no stunt-double type gate');
        }
        const c = check();
        assert.notEqual(c.code, 0, explain(c));
        assert.ok(c.out.includes(`[${code}]`), explain(c));
        failsAtConfig(jest('-c', 'jest.typecheck.config.mjs'), code);
        assert.notEqual(ws.run('npm', ['run', '-s', 'ci']).code, 0);
      } finally { ws.reset(); }
    });
  }
});

describe('wiring and graph mistakes (F6)', () => {
  it('not a mistake: the registry placeholder is installed (what a real install gets) and the adapter maps around it', () => {
    assert.ok(ws.exists('node_modules/@acme/core-slots/not-wired.js'));
    passes(jest());
  });
  it('F6b: unwired tool (no adapter, no chain, placeholder installed): every test file fails on the poisoned import, never renders defaults', () => {
    try {
      const r = jest('-c', 'jest.universal.config.mjs');
      assert.notEqual(r.code, 0, explain(r));
      assert.ok(r.out.includes(NOT_WIRED), explain(r));
      assert.match(r.out, /Cannot find module '\.\/STUNT-DOUBLE-NOT-WIRED -- /, explain(r));
      assert.doesNotMatch(r.out, /Tests:.*passed/);
    } finally { ws.reset(); }
  });
  it('F6b: same, with transformIgnorePatterns that skip the placeholder: still fails loudly (ESM not-wired.js cannot load), naming @acme/core-slots/not-wired.js', () => {
    ws.edit('jest.universal.config.mjs', (s) => s.replace('@acme/core(-slots)?/', '@acme/core/'));
    try {
      const r = jest('-c', 'jest.universal.config.mjs');
      assert.notEqual(r.code, 0, explain(r));
      assert.match(r.out, /Must use import to load ES Module: .*node_modules\/@acme\/core-slots\/not-wired\.js/, explain(r));
      assert.doesNotMatch(r.out, /Tests:.*passed/);
    } finally { ws.reset(); }
  });
  it('F6c: a transformIgnorePatterns entry that would skip the SDK is refused at config load', () => {
    ws.write('jest.bad.config.mjs', `import { withStuntDouble } from 'stunt-double/jest';
export default withStuntDouble({ testEnvironment: 'jsdom', transformIgnorePatterns: ['/node_modules/'] });
`);
    try {
      const r = jest('-c', 'jest.bad.config.mjs');
      failsAtConfig(r, 'F6');
      assert.match(r.out, /transformIgnorePatterns entry "\/node_modules\/" skips node_modules\/@acme\/core/);
    } finally { ws.reset(); }
  });
  it('F6h: an override added without regenerating: the adapter regenerates at config load; the bare universal tier keeps the previous decision', () => {
    ws.linkSlots();
    const priceTag = ws.read('src/overrides/PriceTag.tsx');
    ws.remove('src/overrides/PriceTag.tsx');
    assert.equal(ws.run('stunt-double', ['gen']).code, 0);
    ws.write('src/overrides/PriceTag.tsx', priceTag);   // back, but the shim still says "SDK default"
    try {
      assert.match(ws.read('sdk-slots/gen/PriceTag.jsx'), /@acme\/core\/original\/PriceTag/);
      const bare = jest('-c', 'jest.universal.config.mjs');
      assert.notEqual(bare.code, 0, 'the stale shim renders the SDK default; the app test notices');
      assert.match(bare.out, /SDK_DEFAULT_PRICETAG|BRAND_PRICE/);
      passes(jest());   // the adapter regenerated at config load
      assert.match(ws.read('sdk-slots/gen/PriceTag.jsx'), /src\/overrides\/PriceTag\.tsx/);
    } finally { ws.reset(); }
  });
});

describe('universal tier, bare `jest` (no wrapper, no `stunt-double check &&`): what is left to native resolution', () => {
  // universal tier, generated once (as a postinstall or an earlier `stunt-double gen` would), then the mistake
  const universal = () => { ws.linkSlots(); assert.equal(ws.run('stunt-double', ['gen']).code, 0); };
  const bare = () => jest('-c', 'jest.universal.config.mjs');
  it('F2a: silent: the stray file is simply unused and the tests pass', () => {
    universal();
    MISTAKES.F2a.apply(ws);
    try { passes(bare()); } finally { ws.reset(); }
  });
  it('F3: loud: the stale Logo shim points at a file that no longer exists', () => {
    universal();
    MISTAKES.F3.apply(ws);
    try {
      const r = bare();
      assert.notEqual(r.code, 0, explain(r));
      assert.match(r.out, /Cannot find module '\.\.\/\.\.\/src\/overrides\/Logo\.tsx' from 'sdk-slots\/gen\/Logo\.jsx'/, explain(r));
    } finally { ws.reset(); }
  });
  it('F5: RUNTIME only: babel/swc CommonJS interop turns the missing named export into undefined', () => {
    universal();
    MISTAKES.F5.apply(ws);
    try {
      const r = bare();
      assert.notEqual(r.code, 0, explain(r));
      assert.match(r.out, /Element type is invalid: expected a string .* but got: undefined/, explain(r));
    } finally { ws.reset(); }
  });
});

describe('jest --watch', () => {
  it('the watch plugin regenerates on change: a typo poisons the shims ([F2] in the run), fixing it goes green', async () => {
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');
    const child = spawn(path.join(ws.dir, 'node_modules/.bin/jest'), ['--watchAll'], { cwd: ws.dir, env: { ...process.env, CI: '', FORCE_COLOR: '0' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const waitFor = async (re, from, ms = 60_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (re.test(out.slice(from))) return out.length; await new Promise((r) => setTimeout(r, 100)); }
      throw new Error(`timed out waiting for ${re}:\n${out.slice(-3000)}`);
    };
    try {
      let at = await waitFor(/Tests:\s+4 passed/, 0);
      MISTAKES.F2a.apply(ws);
      at = await waitFor(/\[F2\] src\/overrides\/Buton\.tsx/, at);
      assert.match(out, /STUNT-DOUBLE-ERROR -- \[F2\]/);
      ws.reset();
      await waitFor(/Tests:\s+4 passed/, at);
    } finally {
      ws.reset();
      child.kill();
    }
  });
});
