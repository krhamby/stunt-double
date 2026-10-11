// esbuild 0.28: examples/customer-esbuild built by `node build.mjs` (esbuild.build + stuntDoubleEsbuild()).
// The shared catalogue runs through defineToolSuite (tests/README.md); the esbuild-specific behaviour the
// catalogue cannot express (onEnd audit and write hold, context.rebuild(), node-target externals, the
// zero-plugin alias variant) follows as plain node:test cases.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defineToolSuite } from './harness/index.mjs';
import { workspace, run, write, codesIn, packs, probe, assertRender } from './cli-bundlers/lib.mjs';
import { EXTERNAL_F6 } from './cli-bundlers/shared.mjs';

/** esbuild with NO stunt-double code: the same two bundles as build.mjs. */
const PLAIN_BUILD = `import * as esbuild from 'esbuild';
const shared = { bundle: true, jsx: 'automatic', logLevel: 'info' };
try {
  await esbuild.build({ ...shared, entryPoints: ['src/main.tsx'], outdir: 'dist/assets', platform: 'browser', format: 'esm', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
  await esbuild.build({ ...shared, entryPoints: ['src/entry-server.tsx'], outdir: 'dist-ssr', platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react/*', 'react-dom/*'] });
} catch { process.exit(1); }
`;

defineToolSuite({
  name: 'esbuild',
  fixtureDir: 'examples/customer-esbuild',
  commands: {
    build: 'node build.mjs',
    render: 'node probes/render.mjs',
    // the zero-plugin variant: esbuild `alias: stuntDoubleAlias()` behind the gate
    alias: 'stunt-double check && node build-alias.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/assets/*.js' }, alsoPass: ['check', 'alias'] },
  unwired: { files: { 'build.unwired.mjs': PLAIN_BUILD }, command: 'node build.unwired.mjs' },
  typescript5: true,
  universal: {
    files: { 'build.universal.mjs': PLAIN_BUILD },
    build: 'stunt-double check && node build.universal.mjs',
    bare: 'node build.universal.mjs',
    mutations: ['F1a', 'F1b', 'F2a', 'F3a', 'F4', 'F5a', 'F6a', 'F6g', 'F7b', 'F8', 'F9c'],
  },
});

const node = (dir, ...args) => run(process.execPath, args, dir);

  describe('esbuild specifics', () => {
    const ws = workspace('customer-esbuild');
    before(() => ws.install());
    after(() => ws.cleanup());

    test('audit: a plugin that resolves a socket before stunt-double fails the build in onEnd, and writes nothing', () => {
      const dir = ws.project('audit');
      write(dir, 'rogue.mjs', `import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';
const rogue = { name: 'rogue', setup(b) { b.onResolve({ filter: /^@acme\\/core-slots\\/PriceTag$/ }, (a) => b.resolve('@acme/core/original/PriceTag', { kind: a.kind, resolveDir: a.resolveDir })); } };
try {
await esbuild.build({ bundle: true, jsx: 'automatic', entryPoints: ['src/main.tsx'], outdir: 'dist-rogue', plugins: [rogue, stuntDoubleEsbuild()] });
} catch { process.exit(1); }
`);
      const r = node(dir, 'rogue.mjs');
      assert.notEqual(r.code, 0, ws.show(r));
      // printed by the plugin itself: esbuild 0.28 does not log onEnd errors
      assert.match(r.out, /\[F6\] node_modules\/@acme\/core\/dist\/Checkout\.js imports the SDK default of slot "PriceTag"/, ws.show(r));
      assert.match(r.out, /\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but \.stunt-double\/gen\/PriceTag\.jsx is not in the bundle/, ws.show(r));
      assert.ok(!fs.existsSync(path.join(dir, 'dist-rogue')), 'a failed audit must not leave a bundle on disk');
    });

    test('a user alias for a socket does not win over the plugin', () => {
      const dir = ws.project('user-alias');
      write(dir, 'alias.mjs', `import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';
const r = await esbuild.build({ bundle: true, jsx: 'automatic', write: false, entryPoints: ['src/main.tsx'], outdir: 'x',
alias: { '@acme/core-slots/PriceTag': '@acme/core/original/PriceTag' }, plugins: [stuntDoubleEsbuild()] });
console.log(r.outputFiles[0].text.includes('SDK_DEFAULT_PRICETAG') ? 'DEFAULT' : 'OVERRIDE');
`);
      const r = node(dir, 'alias.mjs');
      assert.equal(r.code, 0, ws.show(r));
      assert.match(r.out, /OVERRIDE/);
    });

    // Server builds that externalize packages, in an adapter-only project (no link: the placeholder is installed).
    const serverBuild = (external) => `import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';
try {
await esbuild.build({ bundle: true, jsx: 'automatic', entryPoints: ['src/entry-server.tsx'], outdir: 'dist-ssr', platform: 'node', format: 'esm',
  ${external}, plugins: [stuntDoubleEsbuild()] });
} catch { process.exit(1); }
`;
    test("node build with packages: 'external' fails with [F6] (the SDK would load natively), and writes nothing", () => {
      const dir = ws.project('ext-packages', (d) => write(d, 'server.mjs', serverBuild("packages: 'external'")));
      const r = node(dir, 'server.mjs');
      assert.notEqual(r.code, 0, ws.show(r));
      assert.match(r.out, EXTERNAL_F6('"@acme/core"'), ws.show(r));
      assert.ok(!fs.existsSync(path.join(dir, 'dist-ssr')), 'nothing may be written');
    });
    test("node build with external: ['@acme/*'] fails with [F6]", () => {
      const dir = ws.project('ext-scope', (d) => write(d, 'server.mjs', serverBuild("external: ['react', 'react-dom', 'react/*', 'react-dom/*', '@acme/*']")));
      const r = node(dir, 'server.mjs');
      assert.notEqual(r.code, 0, ws.show(r));
      assert.match(r.out, EXTERNAL_F6('"@acme/core"'), ws.show(r));
    });
    test('no false [F6]: an entry that uses only Button leaves the unused socket re-exports out (Bun 1.4.2 lists them as external)', () => {
      const dir = ws.project('ext-unused', (d) => {
        write(d, 'src/only-button.tsx', "import { Button } from '@acme/core';\nexport const X = () => <Button>x</Button>;\n");
        write(d, 'server.mjs', serverBuild("external: ['react', 'react-dom', 'react/*', 'react-dom/*']").replace("'src/entry-server.tsx'", "'src/only-button.tsx'"));
      });
      const r = node(dir, 'server.mjs');
      assert.equal(r.code, 0, ws.show(r));
    });
    test("node build with the SOCKETS external ('@acme/core-slots/*'): the plugin's onResolve wins and the overrides render", () => {
      const dir = ws.project('ext-socket', (d) => write(d, 'server.mjs', serverBuild("external: ['react', 'react-dom', 'react/*', 'react-dom/*', '@acme/core-slots/*']")));
      const r = node(dir, 'server.mjs');
      assert.equal(r.code, 0, ws.show(r));
      assertRender(ws, probe(dir));
    });

    test('context.rebuild(): every rebuild regenerates and re-runs the type gate', () => {
      const dir = ws.project('rebuild');
      write(dir, 'ctx.mjs', `import fs from 'node:fs';
import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';
const BTN = fs.readFileSync('src/overrides/Button.tsx', 'utf8');
const ctx = await esbuild.context({ bundle: true, jsx: 'automatic', logLevel: 'silent', entryPoints: ['src/entry-server.tsx'], outdir: 'ctx-out',
platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react/*', 'react-dom/*'], plugins: [stuntDoubleEsbuild()] });
const step = async (name, f) => { f?.(); const r = await ctx.rebuild().then(() => 'ok', (e) => 'fail ' + [...new Set(e.errors.map((x) => x.text).join('\\n').match(/\\[F\\d\\]/g))].join(',')); console.log(name + ': ' + r); };
await step('initial');
await step('typo', () => fs.copyFileSync('src/overrides/Button.tsx', 'src/overrides/Buton.tsx'));
await step('fix-typo', () => fs.rmSync('src/overrides/Buton.tsx'));
await step('contract', () => fs.writeFileSync('src/overrides/Button.tsx', BTN.replace("(props: SlotProps['Button'])", "(props: SlotProps['Button'] & { tone: 'loud' })")));
await step('fix-contract', () => fs.writeFileSync('src/overrides/Button.tsx', BTN));
await step('rm-logo', () => fs.renameSync('src/overrides/Logo.tsx', 'Logo.tsx.bak'));
await step('restore-logo', () => fs.renameSync('Logo.tsx.bak', 'src/overrides/Logo.tsx'));
await ctx.dispose();
`);
      const r = node(dir, 'ctx.mjs');
      assert.equal(r.code, 0, ws.show(r));
      assert.deepEqual(r.out.trim().split('\n'), ['initial: ok', 'typo: fail [F2]', 'fix-typo: ok', 'contract: fail [F1]', 'fix-contract: ok', 'rm-logo: fail [F3]', 'restore-logo: ok'], ws.show(r));
    });

    test('only the [Fx] lines are printed when validation fails (no "Cannot read file" noise for unwritten shims)', () => {
      const dir = ws.project('noise', (d, w) => w.swapDep(d, '@acme/core', `file:${packs}/acme-core-2.0.0.tgz`));
      const r = node(dir, 'build.mjs');
      assert.notEqual(r.code, 0, ws.show(r));
      assert.deepEqual(codesIn(r.out), ['[F2]', '[F3]'], ws.show(r));
      assert.doesNotMatch(r.out, /Cannot read file/, ws.show(r));
    });
  });

