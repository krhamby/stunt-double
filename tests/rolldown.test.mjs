// Rolldown 1.2 suite: examples/customer-rolldown built with
//   t1     `rolldown -c`  (stuntDouble() from stunt-double/rolldown)
//   chain  `stunt-double check && <rolldown without stunt-double>`
//   bare   rolldown without any stunt-double code (the link resolves the sockets)
//
//   npm run setup && node --test tests/rolldown.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bundlerSuite } from './cli-bundlers/suite.mjs';
import { run, write, probe, assertRender } from './cli-bundlers/lib.mjs';
import { STA, DEFAULT_PRICE, F1C_RENDER, watchScript, WATCH_STEPS, chainOf, placeholderOnly, EXTERNAL_F6 } from './cli-bundlers/shared.mjs';

const node = (dir, ...args) => run(process.execPath, args, dir);

/** SSR build through the Rolldown API. Prints ERR <message> on failure. */
const script = (plugins, imports = '', external = '[/^react(-dom)?(\\/|$)/]') => `import { rolldown } from 'rolldown';
${imports}
try {
  const b = await rolldown({ input: 'src/entry-server.tsx', platform: 'node', external: ${external}, transform: { jsx: 'react-jsx' }, onLog() {}, plugins: ${plugins} });
  await b.write({ dir: process.argv[2] ?? 'dist-bare', format: 'es' });
} catch (e) { console.error('ERR', e.message); process.exit(1); }
`;

bundlerSuite({
  name: 'Rolldown 1.2 (customer-rolldown)',
  example: 'customer-rolldown',
  clientDir: 'dist',
  prepareBare: (d) => write(d, 'bare.mjs', script('[]')),
  probeEntry: { bare: 'dist-bare/entry-server.js', chain: 'dist-bare/entry-server.js' },
  commands: {
    t1: (d) => run('npx', ['rolldown', '-c'], d),
    chain: chainOf((d) => node(d, 'bare.mjs')),
    bare: (d) => node(d, 'bare.mjs'),
  },
  expect: {
    'F1a': { ...STA('[F1]'), bare: 'pass' },
    'F1a-narrow': { ...STA('[F1]'), bare: 'pass' },
    'F1b': { ...STA('[F1]'), bare: 'pass' },
    // bare: nothing regenerates after the SDK upgrade (no adapter, no chain), and 1.1.0 adds a slot.
    'F1b-upgrade': { ...STA('[F1]'), bare: 'pass', bareProbe: 'crash' }, // UNRESOLVED_IMPORT warning only (see F2b)
    'F1c': { t1: 'pass', chain: 'pass', bare: 'pass', render: F1C_RENDER },
    'F2a': { ...STA('[F2]'), bare: 'pass' },
    'F2a-stray': { ...STA('[F2]'), bare: 'pass' },
    // bare: Rolldown 1.2.13 treats an unresolvable BARE specifier (@acme/core-slots/Price: the link has no such shim
    // yet) as external with an UNRESOLVED_IMPORT warning and exits 0; the bundle then fails when it is loaded.
    'F2b': { t1: { fail: ['[F2]', '[F3]', 'RENAMED to "Price"'] }, chain: { fail: ['[F2]', '[F3]'] }, bare: 'pass', bareProbe: 'crash' },
    'F3': { ...STA('[F3]'), bare: { fail: /UNRESOLVED_IMPORT.*Could not resolve '\.\.\/\.\.\/src\/overrides\/Logo\.tsx'/ } },
    'F4': { ...STA('[F4]'), bare: 'pass' },
    'F5': { ...STA('[F5]'), bare: { fail: /MISSING_EXPORT.*"Button" is not exported/ } },
    'F6a': { ...STA('[F6]'), bare: 'pass', bareProbe: { sdk: { 'SDK_DEFAULT_BUTTON(in-cart)': 3, 'BRAND_BUTTON(dark)': 2 } } },
    // chain: the check passes (nothing declares a link), then Rolldown without the plugin hits the placeholder: loud.
    'F6b': { t1: 'pass', chain: { fail: /STUNT-DOUBLE-NOT-WIRED/ }, bare: { fail: /STUNT-DOUBLE-NOT-WIRED/ } },
    'F6g': { ...STA('[F6]'), bare: 'pass' },
    'F6h': { t1: 'pass', chain: 'pass', render: DEFAULT_PRICE, bare: { fail: /Could not resolve '\.\.\/\.\.\/src\/overrides\/PriceTag\.tsx'/ } },
    // bare: the shim still says "no override": the SDK default renders silently (R1); t1 / chain regenerate.
    'F6h-add': { t1: 'pass', chain: 'pass', bare: 'pass', bareProbe: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0 } } },
    'F7': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F7-transitive': { ...STA('[F7]'), bare: 'pass', bareProbe: 'crash' },
    'F8': { ...STA('[F8]'), bare: 'pass' },
    'F9b': { ...STA('[F9]'), bare: 'pass', bareProbe: 'crash' },
    'F9c': { ...STA('[F9]'), bare: 'pass' },
  },
  extra: ({ ws }) => {
    describe('Rolldown specifics', () => {
      // Server builds with "externalize the dependencies" rules, in an adapter-only project (placeholder, no link).
      for (const [what, external, shown] of [
        ['a function externalizing every package.json dependency', "(id) => ['react', 'react-dom', '@acme/core', '@acme/core-slots'].some((d) => id === d || id.startsWith(d + '/'))", EXTERNAL_F6('"@acme/core"')],
        // Rolldown matches the RESOLVED id here, so the message names the file
        ['[/node_modules/]', '[/node_modules/]', EXTERNAL_F6('"node_modules/@acme/core/dist/index.js"')],
        ['a regex on the sockets', '[/^react(-dom)?(\\/|$)/, /^@acme\\/core-slots\\//]', /\[F6\] the bundle leaves "@acme\/core-slots\/(Button|Logo|PriceTag)"/],
      ]) test(`node build with external = ${what} fails with [F6] (the SDK / sockets would load natively)`, () => {
        const dir = ws.project(`ext-${what.replace(/\W+/g, '-').replace('node_modules', 'nm')}`, (d, w) => { placeholderOnly(d, w); write(d, 'server.mjs', script('[stuntDouble()]', "import { stuntDouble } from 'stunt-double/rolldown';", external)); });
        const r = node(dir, 'server.mjs', 'dist-ssr');
        assert.notEqual(r.code, 0, ws.show(r));
        assert.match(r.out, shown, ws.show(r));
        assert.ok(!fs.existsSync(path.join(dir, 'dist-ssr')), 'nothing may be written');
      });
      test('node build that keeps only React external renders the overrides (adapter-only project)', () => {
        const dir = ws.project('ext-react-only', (d, w) => { placeholderOnly(d, w); write(d, 'server.mjs', script('[stuntDouble()]', "import { stuntDouble } from 'stunt-double/rolldown';")); });
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
  },
});
