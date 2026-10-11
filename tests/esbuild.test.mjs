// esbuild 0.28 suite: examples/customer-esbuild built with
//   t1     `node build.mjs`          esbuild.build + stuntDoubleEsbuild()
//   chain  `npm run build:alias`     stunt-double check && esbuild with only `alias: stuntDoubleAlias()`
//   bare   esbuild with no stunt-double code at all (the link resolves the sockets)
//
//   npm run setup && node --test tests/esbuild.test.mjs
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bundlerSuite } from './cli-bundlers/suite.mjs';
import { run, write, codesIn, packs } from './cli-bundlers/lib.mjs';
import { STA, DEFAULT_PRICE, F1C_RENDER, placeholderOnly, EXTERNAL_F6 } from './cli-bundlers/shared.mjs';
import { probe, assertRender } from './cli-bundlers/lib.mjs';

const node = (dir, ...args) => run(process.execPath, args, dir);

const BARE = `import * as esbuild from 'esbuild';
try {
  await esbuild.build({ bundle: true, jsx: 'automatic', logLevel: 'error', entryPoints: ['src/entry-server.tsx'], outdir: 'dist-bare',
    platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react/*', 'react-dom/*'] });
} catch { process.exit(1); }
`;


bundlerSuite({
  name: 'esbuild 0.28 (customer-esbuild)',
  example: 'customer-esbuild',
  clientDir: 'dist',
  prepareBare: (d) => write(d, 'bare.mjs', BARE),
  probeEntry: { bare: 'dist-bare/entry-server.js' },
  commands: {
    t1: (d) => node(d, 'build.mjs'),
    chain: (d) => run('npm', ['run', '--silent', 'build:alias'], d),
    bare: (d) => node(d, 'bare.mjs'), // sees the shims of the last `stunt-double gen` (the root postinstall)
  },
  expect: {
    'F1a': { ...STA('[F1]'), bare: 'pass' },
    'F1a-narrow': { ...STA('[F1]'), bare: 'pass' },
    'F1b': { ...STA('[F1]'), bare: 'pass' },
    'F1b-upgrade': { ...STA('[F1]'), bare: 'pass' },
    'F1c': { t1: 'pass', chain: 'pass', bare: 'pass', render: F1C_RENDER },
    'F2a': { ...STA('[F2]'), bare: 'pass' },
    'F2a-stray': { ...STA('[F2]'), bare: 'pass' },
    'F2b': { t1: { fail: ['[F2]', '[F3]', 'RENAMED to "Price"'] }, chain: { fail: ['[F2]', '[F3]'] }, bare: { fail: /Could not resolve/ } },
    'F3': { ...STA('[F3]'), bare: { fail: /Could not resolve "\.\.\/\.\.\/src\/overrides\/Logo\.tsx"/ } },
    'F4': { ...STA('[F4]'), bare: 'pass' },
    'F5': { ...STA('[F5]'), bare: { fail: /No matching export in "src\/overrides\/Button\.tsx" for import "Button"/ } },
    'F6a': { ...STA('[F6]'), bare: 'pass', bareProbe: { sdk: { 'SDK_DEFAULT_BUTTON(in-cart)': 3, 'BRAND_BUTTON(dark)': 2 } } },
    'F6b': { t1: 'pass', chain: 'pass', bare: { fail: /STUNT-DOUBLE-NOT-WIRED/ } },
    'F6g': { ...STA('[F6]'), bare: 'pass' },
    // t1 / chain regenerate: PriceTag correctly falls back to the SDK default. bare: the old shim imports the deleted file.
    'F6h': { t1: 'pass', chain: 'pass', render: DEFAULT_PRICE, bare: { fail: /Could not resolve "\.\.\/\.\.\/src\/overrides\/PriceTag\.tsx"/ } },
    // bare: the shim still says "no override": the SDK default renders silently (R1); t1 / chain regenerate.
    'F6h-add': { t1: 'pass', chain: 'pass', bare: 'pass', bareProbe: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } } },
    'F7': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F7-transitive': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F8': { ...STA('[F8]'), bare: 'pass' },
    // bare: fails only because the server-only package is not installed in this project (not a stunt-double check).
    'F9b': { ...STA('[F9]'), bare: { fail: /Could not resolve "server-only"/ } },
    'F9c': { ...STA('[F9]'), bare: 'pass' },
  },
  extra: ({ ws }) => {
    describe('esbuild specifics', () => {
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
        assert.match(r.out, /\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but sdk-slots\/gen\/PriceTag\.jsx is not in the bundle/, ws.show(r));
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
        const dir = ws.project('ext-packages', (d, w) => { placeholderOnly(d, w); write(d, 'server.mjs', serverBuild("packages: 'external'")); });
        const r = node(dir, 'server.mjs');
        assert.notEqual(r.code, 0, ws.show(r));
        assert.match(r.out, EXTERNAL_F6('"@acme/core"'), ws.show(r));
        assert.ok(!fs.existsSync(path.join(dir, 'dist-ssr')), 'nothing may be written');
      });
      test("node build with external: ['@acme/*'] fails with [F6]", () => {
        const dir = ws.project('ext-scope', (d, w) => { placeholderOnly(d, w); write(d, 'server.mjs', serverBuild("external: ['react', 'react-dom', 'react/*', 'react-dom/*', '@acme/*']")); });
        const r = node(dir, 'server.mjs');
        assert.notEqual(r.code, 0, ws.show(r));
        assert.match(r.out, EXTERNAL_F6('"@acme/core"'), ws.show(r));
      });
      test("node build with the SOCKETS external ('@acme/core-slots/*'): the plugin's onResolve wins and the overrides render", () => {
        const dir = ws.project('ext-socket', (d, w) => { placeholderOnly(d, w); write(d, 'server.mjs', serverBuild("external: ['react', 'react-dom', 'react/*', 'react-dom/*', '@acme/core-slots/*']")); });
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
  },
});
