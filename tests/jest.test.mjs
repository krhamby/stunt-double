// Jest 30: examples/customer-jest with stunt-double/jest (`withStuntDouble(config)`), babel-jest and @swc/jest,
// jsdom and node test environments. For a test runner the "build" is the test run: its two tests render <App/>
// (jsdom and node) and write the HTML that probes/render.mjs prints. Runs the shared catalogue
// (tests/mutations), a Jest-only config guard, `jest --watchAll` as the dev probe, and the universal tier
// (jest-resolve follows the package link, no mapper). See tests/README.md and docs/tools/jest.md.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { defineToolSuite } from './harness/index.mjs';

// A Jest config that never got withStuntDouble(): it transforms the ESM SDK (as any working Jest setup for it
// must), so the registry placeholder's poisoned import is what fails.
const UNWIRED_CONFIG = `// A second Jest config without withStuntDouble() (e.g. an IDE runner's own config).
export default {
  testEnvironment: 'jsdom',
  transformIgnorePatterns: ['/node_modules/(?!(\\\\.pnpm/[^/]+/node_modules/)?@acme/)'],
};
`;

// Universal tier: no stunt-double code in the Jest config; jest-resolve follows node_modules/@acme/core-slots
// (linked) to the generated shims. The SDK and the slot package must be transformed (ESM).
const UNIVERSAL_CONFIG = `export default {
  testEnvironment: 'jsdom',
  transformIgnorePatterns: ['/node_modules/(?!(\\\\.pnpm/[^/]+/node_modules/)?@acme/core(-slots)?/)'],
};
`;

// Jest-only: withStuntDouble() refuses transformIgnorePatterns that would leave the ESM SDK untransformed.
const F6C_JEST = {
  id: 'F6c-jest',
  title: 'user transformIgnorePatterns would skip the ESM SDK (Jest could not load it)',
  catches: 'CFG (withStuntDouble)',
  tags: ['cfg'],
  apply: (fx) => fx.write('jest.bad.config.mjs', `import { withStuntDouble } from 'stunt-double/jest';
export default withStuntDouble({ testEnvironment: 'jsdom', transformIgnorePatterns: ['/node_modules/'] });
`),
  expect: { outcome: 'fail', run: 'jest -c jest.bad.config.mjs', messages: [/\[F6\] Jest transformIgnorePatterns entry "\/node_modules\/" skips node_modules\/@acme\/core/] },
};

defineToolSuite({
  name: 'jest',
  fixtureDir: 'examples/customer-jest',
  toolConfig: 'jest.config.mjs',
  commands: {
    build: 'jest',
    render: 'node probes/render.mjs',
    swc: 'jest -c jest.swc.config.mjs',
    gated: 'jest -c jest.typecheck.config.mjs',
    typecheck: 'tsc --noEmit',
  },
  outputs: ['dist'],
  positive: { alsoPass: ['check', 'swc', 'gated', 'typecheck'] },
  unwired: {
    files: { 'jest.unwired.config.mjs': UNWIRED_CONFIG },
    command: 'jest -c jest.unwired.config.mjs',
  },
  mutations: (list) => [...list, F6C_JEST],
  expectations: (m, exp) => {
    // babel-jest and @swc/jest strip types: contract mistakes are caught by the CLI gate (`stunt-double check &&
    // jest`, the fixture's "ci" script) or by the opt-in withStuntDouble(config, { typecheck: true }).
    if (m.tags?.includes('typegate') && exp.outcome === 'fail') return { command: 'checkThenBuild', also: [{ command: 'gated' }] };
    // every other mistake fails at config load, whichever transformer the config uses
    if (exp.outcome === 'fail' && exp.command === 'build') return { also: [{ command: 'swc' }] };
    return undefined;
  },
  devProbe: watchProbe,
  universal: {
    files: { 'jest.universal.config.mjs': UNIVERSAL_CONFIG },
    build: 'stunt-double check && jest -c jest.universal.config.mjs',
    bare: 'jest -c jest.universal.config.mjs',
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});

/**
 * `jest --watchAll` loads the config once; the watch plugin withStuntDouble() adds regenerates on every change.
 * A typo mid-session poisons the shims (the re-run fails with the [F2] text), fixing it goes green again, and an
 * override removed mid-session switches what renders without a restart.
 */
async function watchProbe(fx) {
  const child = spawn(path.join(fx.app, 'node_modules/.bin/jest'), ['--watchAll'], {
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
    throw new Error(`jest --watchAll: timed out waiting for ${re}:\n${out.slice(-3000)}`);
  };
  try {
    let at = await waitFor(/Tests:\s+2 passed/, 0);
    fx.write(fx.override('Buton.tsx'), fx.pristineText(fx.override('Button.tsx')));
    at = await waitFor(/\[F2\] src\/overrides\/Buton\.tsx[^\n]*did you mean "Button"/, at);
    assert.match(out, /STUNT-DOUBLE-ERROR -- \[F2\]/, 'the poisoned shim carries the [F2] text into the failing test');
    fx.remove(fx.override('Buton.tsx'));
    at = await waitFor(/Tests:\s+2 passed/, at);
    fx.remove(fx.override('PriceTag.tsx'));
    await waitFor(/Tests:\s+2 passed/, at);
    // the shim rewrite triggers one more run: let the output settle before reading what was rendered
    for (let len = -1; len !== out.length;) { len = out.length; await new Promise((r) => setTimeout(r, 2000)); }
    const r = await fx.run('node probes/render.mjs');
    assert.match(r.output, /SDK_DEFAULT_PRICETAG/, 'the removed override falls back to the SDK default live');
    assert.doesNotMatch(r.output, /BRAND_PRICE/);
  } finally {
    child.kill();
  }
}
