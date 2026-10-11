// Rolldown 1.2: examples/customer-rolldown built by `rolldown -c` (stuntDouble() from stunt-double/rolldown).
// The shared catalogue runs through defineToolSuite (tests/README.md); the Rolldown-specific behaviour (external
// rules in node builds, the buildEnd audit, watch mode) follows as plain node:test cases.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defineToolSuite } from './harness/index.mjs';
import { workspace, run, write, probe, assertRender } from './cli-bundlers/lib.mjs';
import { watchScript, WATCH_STEPS, EXTERNAL_F6 } from './cli-bundlers/shared.mjs';

/** rolldown.config.mjs WITHOUT stunt-double: the same two bundles. */
const PLAIN_CONFIG = `import { defineConfig } from 'rolldown';
const onLog = (level, log, handler) => { if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log); };
export default defineConfig([
  { input: 'src/main.tsx', platform: 'browser', onLog, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': '"production"' } }, output: { dir: 'dist/assets', format: 'es', minify: true } },
  { input: 'src/entry-server.tsx', platform: 'node', onLog, external: [/^react(-dom)?(\\/|$)/], transform: { jsx: 'react-jsx' }, output: { dir: 'dist-ssr', format: 'es' } },
]);
`;

defineToolSuite({
  name: 'rolldown',
  fixtureDir: 'examples/customer-rolldown',
  toolConfig: 'rolldown.config.mjs',
  commands: { build: 'rolldown -c', render: 'node probes/render.mjs' },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/assets/*.js' }, alsoPass: ['check'] },
  unwired: { files: { 'rolldown.unwired.config.mjs': PLAIN_CONFIG }, command: 'rolldown -c rolldown.unwired.config.mjs' },
  typescript5: true,
  universal: {
    files: { 'rolldown.universal.config.mjs': PLAIN_CONFIG },
    build: 'stunt-double check && rolldown -c rolldown.universal.config.mjs',
    bare: 'rolldown -c rolldown.universal.config.mjs',
    mutations: ['F1a', 'F1b', 'F2a', 'F3a', 'F4', 'F5a', 'F6a', 'F6g', 'F7b', 'F8', 'F9c'],
  },
});

const node = (dir, ...args) => run(process.execPath, args, dir);

/** SSR build through the Rolldown API. Prints ERR <message> on failure. */
const script = (plugins, imports = '', external = '[/^react(-dom)?(\\/|$)/]') => `import { rolldown } from 'rolldown';
${imports}
try {
  const b = await rolldown({ input: 'src/entry-server.tsx', platform: 'node', external: ${external}, transform: { jsx: 'react-jsx' }, onLog() {}, plugins: ${plugins} });
  await b.write({ dir: process.argv[2] ?? 'dist-bare', format: 'es' });
} catch (e) { console.error('ERR', e.message); process.exit(1); }
`;

  describe('Rolldown specifics', () => {
    const ws = workspace('customer-rolldown');
    before(() => ws.install());
    after(() => ws.cleanup());

    // Server builds with "externalize the dependencies" rules, in an adapter-only project (placeholder, no link).
    for (const [what, external, shown] of [
      ['a function externalizing every package.json dependency', "(id) => ['react', 'react-dom', '@acme/core', '@acme/core-slots'].some((d) => id === d || id.startsWith(d + '/'))", EXTERNAL_F6('"@acme/core"')],
      // Rolldown matches the RESOLVED id here, so the message names the file
      ['[/node_modules/]', '[/node_modules/]', EXTERNAL_F6('"node_modules/@acme/core/dist/index.js"')],
      ['a regex on the sockets', '[/^react(-dom)?(\\/|$)/, /^@acme\\/core-slots\\//]', /\[F6\] the bundle leaves "@acme\/core-slots\/(Button|Logo|PriceTag)"/],
    ]) test(`node build with external = ${what} fails with [F6] (the SDK / sockets would load natively)`, () => {
      const dir = ws.project(`ext-${what.replace(/\W+/g, '-').replace('node_modules', 'nm')}`, (d, w) => { write(d, 'server.mjs', script('[stuntDouble()]', "import { stuntDouble } from 'stunt-double/rolldown';", external)); });
      const r = node(dir, 'server.mjs', 'dist-ssr');
      assert.notEqual(r.code, 0, ws.show(r));
      assert.match(r.out, shown, ws.show(r));
      assert.ok(!fs.existsSync(path.join(dir, 'dist-ssr')), 'nothing may be written');
    });
    test('node build that keeps only React external renders the overrides (adapter-only project)', () => {
      const dir = ws.project('ext-react-only', (d, w) => { write(d, 'server.mjs', script('[stuntDouble()]', "import { stuntDouble } from 'stunt-double/rolldown';")); });
      const r = node(dir, 'server.mjs', 'dist-ssr');
      assert.equal(r.code, 0, ws.show(r));
      assertRender(ws, probe(dir));
    });

    test('audit: a plugin that resolves a socket elsewhere fails the build at buildEnd', () => {
      const dir = ws.project('audit', (d) => write(d, 'rogue.mjs', script(
        '[{ name: "rogue", resolveId(s, imp) { if (s === "@acme/core-slots/PriceTag") return this.resolve("@acme/core/original/PriceTag", imp, { skipSelf: true }); } }, stuntDouble()]',
        "import { stuntDouble } from 'stunt-double/rolldown';")));
      const r = node(dir, 'rogue.mjs');
      assert.notEqual(r.code, 0, ws.show(r));
      assert.match(r.out, /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the SDK default of slot "PriceTag"/, ws.show(r));
      assert.ok(!fs.existsSync(path.join(dir, 'dist-bare')), 'a failed audit must not leave a bundle on disk');
    });

    test('rolldown watch: every rebuild regenerates, re-runs the type gate and watches the overrides dir', () => {
      const dir = ws.project('watch', (d) => write(d, 'watch.mjs', watchScript({
        imports: "import { watch } from 'rolldown';\nimport { stuntDouble } from 'stunt-double/rolldown';",
        plugins: '[stuntDouble()]',
        extra: "platform: 'node', transform: { jsx: 'react-jsx' }, onLog() {},",
      })));
      const r = run(process.execPath, ['watch.mjs'], dir, { timeout: 120_000 });
      assert.equal(r.code, 0, ws.show(r));
      assert.deepEqual(r.out.trim().split('\n').filter((l) => l.includes(': ')), WATCH_STEPS, ws.show(r));
    });
  });

