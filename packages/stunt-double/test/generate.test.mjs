// generate(): static validation (STA: scan + plan + dist scan + bypass + singletons) and emit, on tiny projects
// with a fake installed SDK. One mistake per test; each must produce its stable [Fx] code and key phrase.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generate, StuntDoubleError } from '../src/core/index.mjs';
import { project, write, read, SRC, SLOTS, fakeSdk } from './helpers.mjs';

const base = { 'src/overrides/Button.tsx': SRC.wrapButton, 'src/overrides/Logo.tsx': SRC.logo };
const gen = (root, extra = {}) => generate({ root, onError: 'return', ...extra });
const problems = (p) => p.problems.join('\n');

describe('generate: the positive case', () => {
  test('writes one shim per slot, a check file and nothing under src/', () => {
    const { root } = project({ files: base });
    const p = gen(root);
    assert.deepEqual(p.problems, []);
    assert.equal(p.sdk.name, '@acme/core');
    assert.deepEqual(p.slots, ['Button', 'Card', 'Logo']);
    // the override decision lives in shim CONTENT behind a fixed path
    assert.match(fs.readFileSync(p.shimFile('Button'), 'utf8'), /export \{ Button \} from '[./]*src\/overrides\/Button\.tsx'/);
    assert.match(fs.readFileSync(p.shimFile('Card'), 'utf8'), /export \{ Card \} from '@acme\/core\/original\/Card'/);
    assert.match(fs.readFileSync(p.shimFile('Logo'), 'utf8'), /export \{ Logo \} from '[./]*src\/overrides\/Logo\.tsx'/);
    assert.ok(p.shimFile('Button').endsWith('.jsx'), 'shims are .jsx (never pre-bundled by Vite, refused by Node)');
    assert.ok(fs.existsSync(p.checkFile), 'check file written');
    // simplicity bar: generated files live outside src/
    const srcFiles = fs.readdirSync(path.join(root, 'src'), { recursive: true }).map(String).sort();
    assert.deepEqual(srcFiles, ['overrides', 'overrides/Button.tsx', 'overrides/Logo.tsx']);
    assert.ok(!path.relative(root, p.genDir).startsWith('src'), `generated dir ${p.genDir} must not be under src/`);
  });

  test('the default generated directory is .stunt-double/ and ignores itself in git', () => {
    const { root } = project({ files: base });
    const p = gen(root);
    assert.equal(path.relative(root, p.outDir ?? path.dirname(p.genDir)), '.stunt-double');
    assert.match(read(root, '.stunt-double/.gitignore'), /^\*$/m);
  });

  test('only changed files are written on a second run (no spurious HMR / cache invalidation)', () => {
    const { root } = project({ files: base });
    gen(root);
    const again = gen(root);
    assert.deepEqual(again.changedFiles, []);
    write(root, { 'src/overrides/Card.tsx': `export function Card(props) { return props.children; }\n` });
    const third = gen(root);
    assert.ok(third.changedFiles.some((f) => f.endsWith(`Card.jsx`)), `Card shim rewritten: ${third.changedFiles}`);
    assert.ok(!third.changedFiles.some((f) => f.endsWith(`Button.jsx`)), 'Button shim untouched');
  });

  test('a shim of a client slot gets "use client" only when RSC is in play', () => {
    const { root } = project({ files: base });
    assert.doesNotMatch(fs.readFileSync(gen(root).shimFile('Button'), 'utf8'), /use client/);
    const rsc = gen(root, { rsc: true });
    assert.match(fs.readFileSync(rsc.shimFile('Button'), 'utf8'), /^'use client';/);
    assert.doesNotMatch(fs.readFileSync(rsc.shimFile('Card'), 'utf8'), /use client/, 'Card is a shared slot');
  });
});

describe('generate: F2 unknown slot', () => {
  test('a typo is an error with a "did you mean" hint, never an unused file', () => {
    const { root } = project({ files: { ...base, 'src/overrides/Buton.tsx': SRC.wrapButton } });
    assert.match(problems(gen(root)), /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/);
  });

  test('stray files: Button.override.tsx and a directory without index', () => {
    const { root } = project({ files: { ...base, 'src/overrides/Button.override.tsx': SRC.wrapButton, 'src/overrides/Card/helpers.tsx': 'export const x = 1;\n' } });
    const out = problems(gen(root));
    assert.match(out, /\[F2\][^\n]*Button\.override\.tsx[^\n]*did you mean "Button"/);
    assert.match(out, /\[F2\][^\n]*Card\/ has no index file/);
  });

  test('helpers, tests, stories, declarations and assets are ignored', () => {
    const { root } = project({
      files: {
        ...base,
        'src/overrides/_shared.tsx': 'export const brand = "x";\n',
        'src/overrides/_internal/x.tsx': 'export const y = 1;\n',
        'src/overrides/Button.test.tsx': 'export {};\n',
        'src/overrides/Logo.stories.tsx': 'export default {};\n',
        'src/overrides/types.d.ts': 'export {};\n',
        'src/overrides/logo.svg': '<svg/>',
        'src/overrides/styles.css': '.a{}',
      },
    });
    assert.deepEqual(gen(root).problems, []);
  });

  test('an SDK upgrade that renames or removes a slot explains what to do', () => {
    const slots = { ...SLOTS, Price: { export: 'Price', kind: 'client', default: 'dist/original/Price.js', renamedFrom: ['PriceTag'] } };
    const { root } = project({
      sdk: { version: '2.0.0', slots, removedSlots: { Tooltip: 'use the Popover slot (removed in 2.0.0)' } },
      files: { ...base, 'src/overrides/PriceTag.tsx': 'export function PriceTag() { return null; }\n', 'src/overrides/Tooltip.tsx': 'export function Tooltip() { return null; }\n' },
    });
    const out = problems(gen(root));
    assert.match(out, /\[F2\] src\/overrides\/PriceTag\.tsx: slot "PriceTag" was RENAMED to "Price" in @acme\/core@2\.0\.0: rename the file to Price\.tsx/);
    assert.match(out, /\[F2\] src\/overrides\/Tooltip\.tsx: slot "Tooltip" was REMOVED in @acme\/core@2\.0\.0: use the Popover slot/);
  });

  test('config map keys are slots too', () => {
    const { root } = project({ files: base, config: { map: { Buton: { ignoresProps: ['x'] } } } });
    assert.match(problems(gen(root)), /\[F2\][^\n]*map\."Buton"[^\n]*did you mean "Button"/);
  });
});

describe('generate: F3 / F4 / F5', () => {
  test('F3: a required slot with no implementation', () => {
    const { root } = project({ files: { 'src/overrides/Button.tsx': SRC.wrapButton } });
    const p = gen(root);
    assert.match(problems(p), /\[F3\] required slot "Logo" has no implementation: create src\/overrides\/Logo\.tsx exporting `Logo`/);
  });

  test('F4: Button.tsx and Button/index.tsx both claim the slot', () => {
    const { root } = project({ files: { ...base, 'src/overrides/Button/index.tsx': SRC.wrapButton } });
    const out = problems(gen(root));
    assert.match(out, /\[F4\] slot "Button" is claimed by 2 files: [^\n]*Keep exactly one/);
    assert.match(out, /\[F4\][^\n]*src\/overrides\/Button\.tsx/);
    assert.match(out, /\[F4\][^\n]*src\/overrides\/Button\/index\.tsx/);
  });

  test('F4: a config map entry and a convention file both claim the slot', () => {
    const { root } = project({ files: { ...base, 'src/brand/Logo.tsx': SRC.logo }, config: { map: { Logo: { from: 'src/brand/Logo.tsx' } } } });
    assert.match(problems(gen(root)), /\[F4\] slot "Logo" is claimed by 2 files/);
  });

  test('F5: a default export (with the map hint) and a wrong name', () => {
    const { root } = project({ files: { ...base, 'src/overrides/Logo.tsx': 'export default function Logo() { return null; }\n' } });
    assert.match(problems(gen(root)), /\[F5\] src\/overrides\/Logo\.tsx must export a named `Logo` \(it exports: default\)[^\n]*"export": "default"/);
    write(root, { 'src/overrides/Logo.tsx': 'export function BrandLogo() { return null; }\n' });
    assert.match(problems(gen(root)), /\[F5\] src\/overrides\/Logo\.tsx must export a named `Logo` \(it exports: BrandLogo\)/);
  });

  test('F5 is satisfied by map.<Slot>.export, and the shim re-exports under the slot name', () => {
    const { root } = project({ files: { ...base, 'src/overrides/Logo.tsx': 'export default function Logo() { return null; }\n' }, config: { map: { Logo: { export: 'default' } } } });
    const p = gen(root);
    assert.deepEqual(p.problems, []);
    assert.match(fs.readFileSync(p.shimFile('Logo'), 'utf8'), /export \{ default as Logo \} from/);
  });

  test('map.from claims a slot from a file outside the overrides directory', () => {
    const { root } = project({ files: { 'src/overrides/Button.tsx': SRC.wrapButton, 'src/brand/BrandLogo.tsx': 'export function BrandLogo() { return null; }\n' }, config: { map: { Logo: { from: 'src/brand/BrandLogo.tsx', export: 'BrandLogo' } } } });
    const p = gen(root);
    assert.deepEqual(p.problems, []);
    assert.match(fs.readFileSync(p.shimFile('Logo'), 'utf8'), /export \{ BrandLogo as Logo \} from '[./]*src\/brand\/BrandLogo\.tsx'/);
  });
});

describe('generate: F6 / F8 and config', () => {
  test('F6g: app code importing an original outside the overrides; allowOriginalImports exempts it', () => {
    const files = { ...base, 'src/pages/Legacy.tsx': `import { Button } from '@acme/core/original/Button';\nexport const L = () => <Button />;\n` };
    const { root } = project({ files });
    assert.match(problems(gen(root)), /\[F6\] src\/pages\/Legacy\.tsx imports "@acme\/core\/original\/Button" outside src\/overrides/);
    const { root: r2 } = project({ files, config: { allowOriginalImports: ['src/pages/**'] } });
    assert.deepEqual(gen(r2).problems, []);
  });

  test('F6a: the INSTALLED SDK imports a slot default relatively (dist scan)', () => {
    const { root, sdk } = project({ files: base });
    write(sdk.dir, { 'dist/Dialog.js': `'use client';\nimport { Button } from './original/Button.js';\nexport function Dialog() { return Button({}); }\n` });
    assert.match(problems(gen(root)), /\[F6\] node_modules\/@acme\/core\/dist\/Dialog\.js imports the default of slot "Button" directly \("\.\/original\/Button\.js"\): overrides are NOT applied inside Dialog/);
  });

  test('F8: React resolves to two copies (app vs SDK)', () => {
    const { root, sdk } = project({ files: base });
    write(root, { 'node_modules/react/package.json': { name: 'react', version: '19.3.0' } });
    write(sdk.dir, { 'node_modules/react/package.json': { name: 'react', version: '18.3.1' } });
    assert.match(problems(gen(root)), /\[F8\] "react" resolves to 2 copies/);
  });

  test('CFG: an unknown config key is an error, like a typo in a file name', () => {
    const { root } = project({ files: base, config: { overidesDir: 'src/overrides' } });
    assert.match(problems(gen(root)), /\[CFG\] unknown key "overidesDir"/);
  });

  test('SETUP: no dependency ships a slot manifest', () => {
    const { root } = project({ files: base, pkg: { dependencies: {} } });
    const p = gen(root);
    assert.equal(p.sdk, null);
    assert.match(problems(p), /\[SETUP\] no dependency in package\.json ships a slot-manifest\.json/);
  });

  test('SETUP: a manifest needing another stunt-double version is refused (fail closed)', () => {
    const { root } = project({ files: base, sdk: { manifest: { stuntDouble: '>=9.0.0' } } });
    assert.match(problems(gen(root)), /\[SETUP\] @acme\/core@1\.0\.0 needs stunt-double >=9\.0\.0/);
  });
});

describe('generate: error modes', () => {
  test("onError 'throw' raises a StuntDoubleError carrying the problems", () => {
    const { root } = project({ files: { 'src/overrides/Buton.tsx': SRC.wrapButton, 'src/overrides/Logo.tsx': SRC.logo } });
    assert.throws(() => generate({ root, onError: 'throw' }), (e) => e instanceof StuntDoubleError && e.problems.some((x) => x.startsWith('[F2]')) && /\[F2\]/.test(e.message));
  });

  test("onError 'poison' makes every shim fail to resolve, with the error in the specifier", () => {
    const { root } = project({ files: { 'src/overrides/Buton.tsx': SRC.wrapButton, 'src/overrides/Logo.tsx': SRC.logo } });
    const p = generate({ root, onError: 'poison' });
    for (const s of p.slots) {
      const shim = fs.readFileSync(p.shimFile(s), 'utf8');
      const spec = /import '(\.\/STUNT-DOUBLE-ERROR -- [^']*)'/.exec(shim)?.[1];
      assert.ok(spec, `${s} shim is poisoned:\n${shim}`);
      assert.match(spec, /\[F2\]/);
      assert.doesNotMatch(spec.slice(2), /[/\\:?#"]/, 'poison text has no path or URL syntax (Turbopack and friends would misparse it)');
    }
  });

  test("write: false validates without touching the disk", () => {
    const { root } = project({ files: base });
    const p = generate({ root, write: false });
    assert.deepEqual(p.problems, []);
    assert.ok(!fs.existsSync(p.genDir), 'nothing generated');
  });
});

test('fakeSdk helper sanity: the SDK barrel renders every slot through its socket', () => {
  const { dir } = fakeSdk(path.join(project().root, 'x'));
  assert.match(read(dir, 'dist/index.js'), /export \{ Button \} from '@acme\/core-slots\/Button'/);
});
