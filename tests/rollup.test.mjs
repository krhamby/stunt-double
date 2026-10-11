// Rollup 4: examples/customer-rollup built by `rollup -c` (stuntDouble() from stunt-double/rollup +
// @rollup/plugin-node-resolve 16). The shared catalogue runs through defineToolSuite (tests/README.md); the
// Rollup-specific behaviour (plugin order, external rules in node builds, the buildEnd audit, watch mode) follows
// as plain node:test cases.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defineToolSuite } from './harness/index.mjs';
import { workspace, run, write, probe, assertRender } from './cli-bundlers/lib.mjs';
import { watchScript, WATCH_STEPS, EXTERNAL_F6 } from './cli-bundlers/shared.mjs';

/** rollup.config.mjs WITHOUT stunt-double: the same two bundles. */
const PLAIN_CONFIG = `import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import esbuild from 'rollup-plugin-esbuild';
const plugins = (browser) => [
  nodeResolve({ browser, extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'] }),
  commonjs(),
  replace({ preventAssignment: true, values: { 'process.env.NODE_ENV': JSON.stringify('production') } }),
  esbuild({ jsx: 'automatic', target: 'es2022' }),
];
const onwarn = (w, warn) => { if (w.code !== 'MODULE_LEVEL_DIRECTIVE') warn(w); };
export default [
  { input: 'src/main.tsx', output: { dir: 'dist/assets', format: 'es' }, plugins: plugins(true), onwarn },
  { input: 'src/entry-server.tsx', output: { dir: 'dist-ssr', format: 'es' }, external: [/^react(-dom)?(\\/|$)/], plugins: plugins(false), onwarn },
];
`;

defineToolSuite({
  name: 'rollup',
  fixtureDir: 'examples/customer-rollup',
  toolConfig: 'rollup.config.mjs',
  commands: { build: 'rollup -c', render: 'node probes/render.mjs' },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/assets/*.js' }, alsoPass: ['check'] },
  unwired: { files: { 'rollup.unwired.config.mjs': PLAIN_CONFIG }, command: 'rollup -c rollup.unwired.config.mjs' },
  typescript5: true,
  universal: {
    files: { 'rollup.universal.config.mjs': PLAIN_CONFIG },
    build: 'stunt-double check && rollup -c rollup.universal.config.mjs',
    bare: 'rollup -c rollup.universal.config.mjs',
    mutations: ['F1a', 'F1b', 'F2a', 'F3a', 'F4', 'F5a', 'F6a', 'F6g', 'F7b', 'F8', 'F9c'],
  },
});

const node = (dir, ...args) => run(process.execPath, args, dir);

/** SSR build through the Rollup API; PLUGINS is spliced in. Prints ERR <code> on failure. */
const script = (plugins, imports = '', external = '[/^react(-dom)?(\\/|$)/]') => `import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import esbuild from 'rollup-plugin-esbuild';
${imports}
const resolve = nodeResolve({ extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'] });
try {
  const b = await rollup({ input: 'src/entry-server.tsx', external: ${external}, onwarn() {}, plugins: ${plugins} });
  await b.write({ dir: process.argv[2] ?? 'dist-bare', format: 'es' });
} catch (e) { console.error('ERR', e.code ?? '', e.message); process.exit(1); }
`;
  describe('Rollup specifics', () => {
    const ws = workspace('customer-rollup');
    before(() => ws.install());
    after(() => ws.cleanup());

    test('plugin order is harmless: stuntDouble() after node-resolve, with no link (placeholder installed)', () => {
      const dir = ws.project('order', (d) => {
        write(d, 'last.mjs', script('[resolve, commonjs(), esbuild({ jsx: "automatic" }), stuntDouble()]', "import { stuntDouble } from 'stunt-double/rollup';"));
      });
      const r = node(dir, 'last.mjs', 'dist-ssr');
      assert.equal(r.code, 0, ws.show(r));
      assertRender(ws, probe(dir));
    });

    // Server builds with "externalize the dependencies" rules, in an adapter-only project (placeholder, no link).
    for (const [what, external, shown] of [
      ['a function externalizing every package.json dependency', "(id) => ['react', 'react-dom', '@acme/core', '@acme/core-slots'].some((d) => id === d || id.startsWith(d + '/'))", EXTERNAL_F6('"@acme/core"')],
      ['[/node_modules/]', '[/node_modules/]', EXTERNAL_F6('"@acme/core"')],
      ['a regex on the sockets', '[/^react(-dom)?(\\/|$)/, /^@acme\\/core-slots\\//]', /\[F6\] the bundle leaves "@acme\/core-slots\/(Button|Logo|PriceTag)"/],
    ]) test(`node build with external = ${what} fails with [F6] (the SDK / sockets would load natively)`, () => {
      const dir = ws.project(`ext-${what.replace(/\W+/g, '-').replace('node_modules', 'nm')}`, (d, w) => { write(d, 'server.mjs', script('[stuntDouble(), resolve, commonjs(), esbuild({ jsx: "automatic" })]', "import { stuntDouble } from 'stunt-double/rollup';", external)); });
      const r = node(dir, 'server.mjs', 'dist-ssr');
      assert.notEqual(r.code, 0, ws.show(r));
      assert.match(r.out, shown, ws.show(r));
      assert.ok(!fs.existsSync(path.join(dir, 'dist-ssr')), 'nothing may be written');
    });
    test('node build that keeps only React external renders the overrides (adapter-only project)', () => {
      const dir = ws.project('ext-react-only', (d, w) => { write(d, 'server.mjs', script('[stuntDouble(), resolve, commonjs(), esbuild({ jsx: "automatic" })]', "import { stuntDouble } from 'stunt-double/rollup';")); });
      const r = node(dir, 'server.mjs', 'dist-ssr');
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

