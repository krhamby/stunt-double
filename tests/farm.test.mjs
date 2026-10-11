// Farm 1.7 (stretch): examples/customer-farm built by `farm build` (+ an SSR build) with stuntDouble() in
// vitePlugins (Farm's Vite-plugin compatibility). The shared catalogue runs through defineToolSuite
// (tests/README.md); the Farm-specific behaviour (no module graph, so no audit; dev start; doctor) follows as
// plain node:test cases.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defineToolSuite } from './harness/index.mjs';
import { workspace, run } from './cli-bundlers/lib.mjs';

/** farm configs WITHOUT stunt-double: the same two bundles. */
const PLAIN = (input, output) => `import { defineConfig } from '@farmfe/core';
export default defineConfig({ compilation: { input: ${input}, output: ${output}, external: ['^react$', '^react-dom', '^react/'], minify: false, persistentCache: false }, plugins: ['@farmfe/plugin-react'] });
`;
const PLAIN_FILES = {
  'farm.plain.config.ts': PLAIN("{ index: './index.html' }", "{ path: 'dist' }").replace(", external: ['^react$', '^react-dom', '^react/']", ''),
  'farm.plain.ssr.config.ts': PLAIN("{ 'entry-server': './src/entry-server.tsx' }", "{ path: 'dist-ssr', targetEnv: 'node', format: 'esm', entryFilename: '[entryName].js' }"),
};
const PLAIN_BUILD = 'farm build -c farm.plain.config.ts && farm build -c farm.plain.ssr.config.ts';

defineToolSuite({
  name: 'farm',
  fixtureDir: 'examples/customer-farm',
  toolConfig: 'farm.config.ts',
  commands: { build: 'farm build && farm build -c farm.config.ssr.ts', render: 'node probes/render.mjs' },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/*.js' }, alsoPass: ['check'] },
  unwired: { files: PLAIN_FILES, command: PLAIN_BUILD },
  typescript5: true,
  universal: {
    files: PLAIN_FILES,
    build: `stunt-double check && ${PLAIN_BUILD}`,
    bare: PLAIN_BUILD,
    mutations: ['F1a', 'F1b', 'F2a', 'F3a', 'F4', 'F5a', 'F6a', 'F6g', 'F7b', 'F8', 'F9c'],
  },
});

  describe('Farm specifics', () => {
    const ws = workspace('customer-farm');
    before(() => ws.install());
    after(() => ws.cleanup());

    test('the post-bundle audit is skipped under Farm, and says so', () => {
      const dir = ws.project('audit-notice');
      const r = run('npx', ['farm', 'build'], dir);
      assert.equal(r.code, 0, ws.show(r));
      assert.match(r.out, /stunt-double: post-bundle audit skipped, this host has no module-graph API/, ws.show(r));
    });

    test('doctor: farm scripts pass when farm.config wires stuntDouble(); still flagged without it', () => {
      const cli = (d) => run(process.execPath, [path.join(d, 'node_modules/stunt-double/bin/stunt-double.mjs'), 'doctor'], d);
      const wired = ws.project('doctor-wired');
      const r1 = cli(wired);
      assert.equal(r1.code, 0, ws.show(r1));
      assert.doesNotMatch(r1.out, /\[DOCTOR\] script/, ws.show(r1));
      const unwired = ws.project('doctor-unwired', (d) => {
        for (const f of ['farm.config.ts', 'farm.config.ssr.ts'])
          fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(d, f), 'utf8').replace("import { stuntDouble } from 'stunt-double/vite';", '').replace('vitePlugins: [stuntDouble()],', ''));
      });
      const r2 = cli(unwired);
      assert.notEqual(r2.code, 0, ws.show(r2));
      assert.match(r2.out, /\[DOCTOR\] script "build" runs a tool without a stunt-double adapter/, ws.show(r2));
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

