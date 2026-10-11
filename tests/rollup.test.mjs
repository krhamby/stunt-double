// Rollup 4 suite: examples/customer-rollup built with
//   t1     `rollup -c`  (stuntDouble() from stunt-double/rollup + @rollup/plugin-node-resolve 16)
//   chain  `stunt-double check && <rollup without stunt-double>`
//   bare   rollup without any stunt-double code (the link resolves the sockets)
//
//   npm run setup && node --test tests/rollup.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bundlerSuite } from './cli-bundlers/suite.mjs';
import { run, write, packs, readJson, writeJson, probe, assertRender } from './cli-bundlers/lib.mjs';
import { STA, DEFAULT_PRICE, F1C_RENDER, watchScript, WATCH_STEPS, chainOf } from './cli-bundlers/shared.mjs';

const node = (dir, ...args) => run(process.execPath, args, dir);

/** SSR build through the Rollup API; PLUGINS is spliced in. Prints ERR <code> on failure. */
const script = (plugins, imports = '') => `import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import esbuild from 'rollup-plugin-esbuild';
${imports}
const resolve = nodeResolve({ extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'] });
try {
  const b = await rollup({ input: 'src/entry-server.tsx', external: [/^react(-dom)?(\\/|$)/], onwarn() {}, plugins: ${plugins} });
  await b.write({ dir: process.argv[2] ?? 'dist-bare', format: 'es' });
} catch (e) { console.error('ERR', e.code ?? '', e.message); process.exit(1); }
`;
const BARE = script('[resolve, commonjs(), esbuild({ jsx: "automatic" })]');

bundlerSuite({
  name: 'Rollup 4 (customer-rollup)',
  example: 'customer-rollup',
  clientDir: 'dist',
  prepareBare: (d) => write(d, 'bare.mjs', BARE),
  probeEntry: { bare: 'dist-bare/entry-server.js', chain: 'dist-bare/entry-server.js' },
  commands: {
    t1: (d) => run('npx', ['rollup', '-c'], d),
    chain: chainOf((d) => node(d, 'bare.mjs')),
    bare: (d) => node(d, 'bare.mjs'),
  },
  expect: {
    'F1a': { ...STA('[F1]'), bare: 'pass' },
    'F1a-narrow': { ...STA('[F1]'), bare: 'pass' },
    'F1b': { ...STA('[F1]'), bare: 'pass' },
    'F1b-upgrade': { ...STA('[F1]'), bare: 'pass' },
    'F1c': { t1: 'pass', chain: 'pass', bare: 'pass', render: F1C_RENDER },
    'F2a': { ...STA('[F2]'), bare: 'pass' },
    'F2a-stray': { ...STA('[F2]'), bare: 'pass' },
    'F2b': { t1: { fail: ['[F2]', '[F3]', 'RENAMED to "Price"'] }, chain: { fail: ['[F2]', '[F3]'] }, bare: { fail: /ENOENT Could not load .*sdk-slots\/gen\/(Footer|Price)\.jsx/ } },
    'F3': { ...STA('[F3]'), bare: { fail: /UNRESOLVED_IMPORT Could not resolve "\.\.\/\.\.\/src\/overrides\/Logo\.tsx"/ } },
    'F4': { ...STA('[F4]'), bare: 'pass' },
    'F5': { ...STA('[F5]'), bare: { fail: /MISSING_EXPORT .*"Button" is not exported by "src\/overrides\/Button\.tsx"/ } },
    'F6a': { ...STA('[F6]'), bare: 'pass', bareProbe: { sdk: { 'SDK_DEFAULT_BUTTON(in-cart)': 3, 'BRAND_BUTTON(dark)': 2 } } },
    // chain: the check passes (nothing declares a link), then Rollup without the plugin hits the placeholder: loud.
    'F6b': { t1: 'pass', chain: { fail: /STUNT-DOUBLE-NOT-WIRED/ }, bare: { fail: /STUNT-DOUBLE-NOT-WIRED/ } },
    'F6g': { ...STA('[F6]'), bare: 'pass' },
    'F6h': { t1: 'pass', chain: 'pass', render: DEFAULT_PRICE, bare: { fail: /UNRESOLVED_IMPORT Could not resolve "\.\.\/\.\.\/src\/overrides\/PriceTag\.tsx"/ } },
    // bare: the shim still says "no override": the SDK default renders silently (R1); t1 / chain regenerate.
    'F6h-add': { t1: 'pass', chain: 'pass', bare: 'pass', bareProbe: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } } },
    'F7': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F7-transitive': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F8': { ...STA('[F8]'), bare: 'pass' },
    // bare: node-resolve leaves the uninstalled "server-only" external (a warning); Node then fails at import time.
    'F9b': { ...STA('[F9]'), bare: 'pass', bareProbe: 'crash' },
    'F9c': { ...STA('[F9]'), bare: 'pass' },
  },
  extra: ({ ws }) => {
    describe('Rollup specifics', () => {
      test('plugin order is harmless: stuntDouble() after node-resolve, with no link (placeholder installed)', () => {
        const dir = ws.project('order', (d, w) => {
          const pkg = readJson(path.join(d, 'package.json'));
          delete pkg.dependencies['@acme/core-slots'];
          writeJson(path.join(d, 'package.json'), pkg);
          fs.rmSync(path.join(d, 'node_modules/@acme/core-slots'), { recursive: true, force: true });
          w.npm(d, 'install', '--no-save', `${packs}/acme-core-slots-0.0.1.tgz`);
          write(d, 'last.mjs', script('[resolve, commonjs(), esbuild({ jsx: "automatic" }), stuntDouble()]', "import { stuntDouble } from 'stunt-double/rollup';"));
        });
        const r = node(dir, 'last.mjs', 'dist-ssr');
        assert.equal(r.code, 0, ws.show(r));
        assertRender(ws, probe(dir));
      });

      test('audit: a plugin that resolves a socket elsewhere fails the build at buildEnd', () => {
        const dir = ws.project('audit', (d) => write(d, 'rogue.mjs', script(
          '[{ name: "rogue", resolveId(s, imp) { if (s === "@acme/core-slots/PriceTag") return this.resolve("@acme/core/original/PriceTag", imp, { skipSelf: true }); } }, stuntDouble(), resolve, commonjs(), esbuild({ jsx: "automatic" })]',
          "import { stuntDouble } from 'stunt-double/rollup';")));
        const r = node(dir, 'rogue.mjs');
        assert.notEqual(r.code, 0, ws.show(r));
        assert.match(r.out, /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the SDK default of slot "PriceTag"/, ws.show(r));
        assert.ok(!fs.existsSync(path.join(dir, 'dist-bare')), 'a failed audit must not leave a bundle on disk');
      });

      test('rollup watch: every rebuild regenerates, re-runs the type gate and watches the overrides dir', () => {
        const dir = ws.project('watch', (d) => write(d, 'watch.mjs', watchScript({
          imports: "import { watch } from 'rollup';\nimport { stuntDouble } from 'stunt-double/rollup';\nimport { nodeResolve } from '@rollup/plugin-node-resolve';\nimport commonjs from '@rollup/plugin-commonjs';\nimport esbuild from 'rollup-plugin-esbuild';",
          plugins: "[stuntDouble(), nodeResolve({ extensions: ['.js', '.jsx', '.tsx', '.ts'] }), commonjs(), esbuild({ jsx: 'automatic' })]",
          extra: 'onwarn() {},',
        })));
        const r = run(process.execPath, ['watch.mjs'], dir, { timeout: 120_000 });
        assert.equal(r.code, 0, ws.show(r));
        assert.deepEqual(r.out.trim().split('\n').filter((l) => l.includes(': ')), WATCH_STEPS, ws.show(r));
      });
    });
  },
});
