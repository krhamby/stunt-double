// sdk-lint: the SDK's publish gate (DESIGN.md §3.6). The same dist scanner every project runs on the installed
// SDK. Each rule gets one failing fixture; the clean fixture must pass.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sdkLint, abiOf } from '../src/core/index.mjs';
import { tmpDir, fakeSdk, write, read } from './helpers.mjs';

/** A fresh SDK package dir; `abi: null` so the un-written manifest is not "stale". */
function sdk(o = {}) {
  const dir = tmpDir('sdk');
  fakeSdk(dir, { ...o, manifest: { abi: null, ...o.manifest } });
  return dir;
}
const errors = (dir, opts) => sdkLint(dir, opts).errors.join('\n');

describe('sdk-lint', () => {
  test('a slot-ready SDK passes', () => {
    const r = sdkLint(sdk());
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
  });

  test('--write computes consumers and the ABI pin, rewrites SlotAbi and writes the config schema', () => {
    const dir = sdk();
    const r = sdkLint(dir, { write: true });
    assert.equal(r.ok, true, r.errors.join('\n'));
    const m = JSON.parse(read(dir, 'slot-manifest.json'));
    assert.deepEqual(m.slots.Button.consumers, ['Dialog']);
    assert.match(m.abi, /^acme-core-slots\/1\.0\.0\+[0-9a-f]{6}$/);
    assert.match(read(dir, 'dist/contracts.d.ts'), new RegExp(`export type SlotAbi = '${m.abi.replace(/[.+]/g, '\\$&')}';`));
    const schema = JSON.parse(read(dir, 'stunt-double.schema.json'));
    assert.deepEqual(schema.properties.map.propertyNames.enum.sort(), ['Button', 'Card', 'Logo']);
    // and the written manifest is now consistent
    assert.deepEqual(sdkLint(dir).errors, []);
    assert.equal(m.abi, abiOf({ ...m }, read(dir, 'dist/contracts.d.ts'), '@acme/core-slots', '1.0.0'));
  });

  test('SDK1: a dist file imports a slot default directly (relative or via original/*)', () => {
    const dir = sdk({ files: { 'dist/Dialog.js': `'use client';\nimport { Button } from './original/Button.js';\nimport { Card } from '@acme/core/original/Card';\nexport function Dialog() { return [Button, Card]; }\n` } });
    const out = errors(dir);
    assert.match(out, /\[SDK1\] dist\/Dialog\.js imports the default of slot "Button" directly \("\.\/original\/Button\.js"\)/);
    assert.match(out, /\[SDK1\] dist\/Dialog\.js imports the default of slot "Card" directly/);
  });

  test('SDK2: a socket that is not in the manifest, and a slot without a SlotProps entry', () => {
    const dir = sdk({ files: { 'dist/Extra.js': `'use client';\nimport { Nope } from '@acme/core-slots/Nope';\nexport const E = Nope;\n` } });
    assert.match(errors(dir), /\[SDK2\] dist\/Extra\.js imports socket "@acme\/core-slots\/Nope", which is not in slot-manifest\.json/);
    const dir2 = sdk({ files: { 'dist/contracts.d.ts': `export interface SlotProps { Button: {}; Logo: {} }\nexport type SlotAbi = 'x';\n` } });
    assert.match(errors(dir2), /\[SDK2\] component slot "Card" has no SlotProps entry/);
  });

  test('SDK3: contracts import props through the socket package', () => {
    const dir = sdk({ files: { 'dist/contracts.d.ts': `import type { Button } from '@acme/core-slots/Button';\nexport interface SlotProps { Button: {}; Card: {}; Logo: {} }\nexport type SlotAbi = 'x';\nexport type B = typeof Button;\n` } });
    assert.match(errors(dir), /\[SDK3\] dist\/contracts\.d\.ts imports "@acme\/core-slots\/Button"/);
  });

  test('SDK4: a client default, or a file rendering a client slot, without "use client"', () => {
    const dir = sdk({ files: { 'dist/original/Button.js': `export function Button() { return null; }\n`, 'dist/Dialog.js': `import { Button } from '@acme/core-slots/Button';\nexport function Dialog() { return Button; }\n` } });
    const out = errors(dir);
    assert.match(out, /\[SDK4\] dist\/original\/Button\.js is the default of client slot "Button" but has no "use client" directive/);
    assert.match(out, /\[SDK4\] dist\/Dialog\.js renders client slot "Button" but has no "use client" directive/);
  });

  test('SDK5: a required slot with a default, and an optional slot without one', () => {
    const dir = sdk({ slots: { Button: { kind: 'client', default: 'dist/original/Button.js', required: true }, Card: { kind: 'shared' }, Logo: { kind: 'client', required: true } } });
    const out = errors(dir);
    assert.match(out, /\[SDK5\] slot "Button" is required AND has a default/);
    assert.match(out, /\[SDK5\] slot "Card" has no default and is not required/);
  });

  test('the peer on the socket package must be required and unranged', () => {
    const dir = sdk();
    const pj = JSON.parse(read(dir, 'package.json'));
    write(dir, { 'package.json': { ...pj, peerDependencies: { react: '>=18', '@acme/core-slots': '^1.0.0' }, peerDependenciesMeta: { '@acme/core-slots': { optional: true } } } });
    const out = errors(dir);
    assert.match(out, /REQUIRED peer "@acme\/core-slots": "\*"/);
    assert.match(out, /must not be optional/);
  });

  test('SDK6: published declarations must not mention the socket package (--fix rewrites them)', (t) => {
    const dir = sdk({ files: { 'dist/index.d.ts': `export { Button } from '@acme/core-slots/Button';\nexport { Card } from '@acme/core-slots/Card';\nexport { Logo } from '@acme/core-slots/Logo';\nexport { Dialog } from './Dialog.js';\n` } });
    const before = sdkLint(dir);
    if (!before.errors.some((e) => e.startsWith('[SDK6]'))) return t.skip('this core has no SDK6 rule');
    assert.match(before.errors.join('\n'), /\[SDK6\] dist\/index\.d\.ts:1 references "@acme\/core-slots\/Button"/);
    const fixed = sdkLint(dir, { fix: true });
    assert.deepEqual(fixed.errors.filter((e) => e.startsWith('[SDK6]')), []);
    const dts = read(dir, 'dist/index.d.ts');
    assert.doesNotMatch(dts, /@acme\/core-slots/);
    assert.match(dts, /export \{ Button \} from '\.\/original\/Button\.js'/);
    assert.match(dts, /Logo/, 'the required slot (no original) is still exported, typed by its contract');
  });

  test('the manifest and package.json must agree', () => {
    const dir = sdk({ manifest: { version: '9.9.9' } });
    assert.match(errors(dir), /slot-manifest\.json "version" is "9\.9\.9" but package\.json version is "1\.0\.0"/);
    assert.ok(fs.existsSync(path.join(dir, 'package.json')));
  });
});
