// Farm 1.7 suite (stretch): examples/customer-farm built with
//   t1     `npm run build`   farm build (+ SSR build) with stuntDouble() in vitePlugins (Farm's Vite compatibility)
//   chain  `stunt-double check && <farm build without stunt-double>`
//   bare   farm without any stunt-double code (the link resolves the sockets)
//
//   npm run setup && node --test tests/farm.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bundlerSuite } from './cli-bundlers/suite.mjs';
import { run, write } from './cli-bundlers/lib.mjs';
import { STA, DEFAULT_PRICE, F1C_RENDER, chainOf } from './cli-bundlers/shared.mjs';

const BARE_CONFIG = `import { defineConfig } from '@farmfe/core';
export default defineConfig({
  compilation: {
    input: { 'entry-server': './src/entry-server.tsx' },
    output: { path: 'dist-bare', targetEnv: 'node', format: 'esm', entryFilename: '[entryName].js' },
    external: ['^react$', '^react-dom', '^react/'],
    minify: false,
    persistentCache: false,
  },
  plugins: ['@farmfe/plugin-react'],
});
`;
const farm = (d, ...args) => run('npx', ['farm', 'build', ...args], d);
const bare = (d) => farm(d, '-c', 'farm.config.bare.ts');

bundlerSuite({
  name: 'Farm 1.7 (customer-farm)',
  example: 'customer-farm',
  clientDir: 'dist',
  prepareBare: (d) => write(d, 'farm.config.bare.ts', BARE_CONFIG),
  probeEntry: { bare: 'dist-bare/entry-server.js', chain: 'dist-bare/entry-server.js' },
  commands: {
    t1: (d) => run('npm', ['run', '--silent', 'build'], d),
    chain: chainOf(bare),
    bare,
  },
  expect: {
    'F1a': { ...STA('[F1]'), bare: 'pass' },
    'F1a-narrow': { ...STA('[F1]'), bare: 'pass' },
    'F1b': { ...STA('[F1]'), bare: 'pass' },
    // bare: nothing regenerates after the SDK upgrade (no adapter, no chain), and 1.1.0 adds a slot.
    'F1b-upgrade': { ...STA('[F1]'), bare: { fail: /Can not resolve `@acme\/core-slots\/Badge`/ } },
    'F1c': { t1: 'pass', chain: 'pass', bare: 'pass', render: F1C_RENDER },
    'F2a': { ...STA('[F2]'), bare: 'pass' },
    'F2a-stray': { ...STA('[F2]'), bare: 'pass' },
    'F2b': { t1: { fail: ['[F2]', '[F3]', 'RENAMED to "Price"'] }, chain: { fail: ['[F2]', '[F3]'] }, bare: { fail: /Can not resolve `@acme\/core-slots\/(Price|Footer)`/ } },
    'F3': { ...STA('[F3]'), bare: { fail: /Can not resolve `\.\.\/\.\.\/src\/overrides\/Logo\.tsx`/ } },
    'F4': { ...STA('[F4]'), bare: 'pass' },
    'F5': { ...STA('[F5]'), bare: 'pass', bareProbe: 'crash' },
    'F6a': { ...STA('[F6]'), bare: 'pass', bareProbe: { sdk: { 'SDK_DEFAULT_BUTTON(in-cart)': 3, 'BRAND_BUTTON(dark)': 2 } } },
    'F6b': { t1: 'pass', chain: { fail: /STUNT-DOUBLE-NOT-WIRED/ }, bare: { fail: /STUNT-DOUBLE-NOT-WIRED/ } },
    'F6g': { ...STA('[F6]'), bare: 'pass' },
    'F6h': { t1: 'pass', chain: 'pass', render: DEFAULT_PRICE, bare: { fail: /Can not resolve `\.\.\/\.\.\/src\/overrides\/PriceTag\.tsx`/ } },
    // bare: the shim still says "no override": the SDK default renders silently (R1); t1 / chain regenerate.
    'F6h-add': { t1: 'pass', chain: 'pass', bare: 'pass', bareProbe: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } } },
    'F7': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F7-transitive': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F8': { ...STA('[F8]'), bare: 'pass' },
    // t1: the [F9] line, next to Farm's own resolve error for the uninstalled server-only package
    'F9b': { ...STA('[F9]'), bare: { fail: /Can not resolve `server-only`/ } },
    'F9c': { ...STA('[F9]'), bare: 'pass' },
  },
  extra: ({ ws }) => {
    describe('Farm specifics', () => {
      test('the post-bundle audit is skipped under Farm, and says so', () => {
        const dir = ws.project('audit-notice');
        const r = run('npx', ['farm', 'build'], dir);
        assert.equal(r.code, 0, ws.show(r));
        assert.match(r.out, /stunt-double: post-bundle audit skipped, this host has no module-graph API/, ws.show(r));
      });

      test('farm start refuses to start on an injection error, with the [Fx] line', () => {
        const dir = ws.project('dev-typo', (d) => fs.copyFileSync(path.join(d, 'src/overrides/Button.tsx'), path.join(d, 'src/overrides/Buton.tsx')));
        const r = run('npx', ['farm', 'start', '--port', '9791'], dir, { timeout: 60_000 });
        assert.equal(r.signal, null, `farm start kept running instead of refusing to start\n${ws.show(r)}`);
        assert.notEqual(r.code, 0, ws.show(r));
        assert.match(r.out, /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton"/, ws.show(r));
        assert.match(r.out, /Failed to start the server/, ws.show(r));
      });
    });
  },
});
