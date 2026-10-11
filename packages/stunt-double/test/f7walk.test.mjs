// walkImplementation(): the transitive import walk behind F7 (an override that renders itself), W7 (consumer
// cycle warning) and F9 (server-only in a client slot). oxc-parser + oxc-resolver, tsconfig "paths" aware.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { walkImplementation, generate } from '../src/core/index.mjs';
import { project, write } from './helpers.mjs';

function walk(files, { slot = 'Button', kind = 'client', consumers = ['Dialog'], tsconfig = false } = {}) {
  const { root } = project({ files: { 'src/overrides/Logo.tsx': 'export function Logo() { return null; }\n', ...files } });
  if (tsconfig) write(root, { 'tsconfig.json': { compilerOptions: { jsx: 'react-jsx', paths: { '@/*': ['./src/*'] } }, include: ['src'] } });
  const r = walkImplementation({
    root, entry: path.join(root, `src/overrides/${slot}.tsx`), slot, exportName: slot, sdk: '@acme/core', slotPkg: '@acme/core-slots',
    kind, consumers, tsconfig: tsconfig ? path.join(root, 'tsconfig.json') : null,
  });
  return { ...r, root };
}

const button = (imports, body = '<Effective {...props} />') => `${imports}\nexport function Button(props) { return <span>${body}</span>; }\n`;

describe('F7: an override that reaches its own slot', () => {
  test('directly, through its socket', () => {
    const r = walk({ 'src/overrides/Button.tsx': button(`import { Button as Effective } from '@acme/core-slots/Button';`) });
    assert.match(r.errors.join('\n'), /\[F7\] src\/overrides\/Button\.tsx imports "@acme\/core-slots\/Button": that is slot "Button" itself \(infinite render\)\. Wrap the default via '@acme\/core\/original\/Button'/);
  });

  test('through the SDK barrel (named import, renamed)', () => {
    const r = walk({ 'src/overrides/Button.tsx': button(`import { Button as Effective } from '@acme/core';`) });
    assert.match(r.errors.join('\n'), /\[F7\] src\/overrides\/Button\.tsx imports \{ Button \} from "@acme\/core"/);
  });

  test('through a namespace member (<Acme.Button>), but not a namespace that never touches the slot', () => {
    const hit = walk({ 'src/overrides/Button.tsx': button(`import * as Acme from '@acme/core';`, '<Acme.Button {...props} />') });
    assert.match(hit.errors.join('\n'), /\[F7\][^\n]*uses <ns>\.Button from "@acme\/core"/);
    const miss = walk({ 'src/overrides/Button.tsx': button(`import * as Acme from '@acme/core';`, '<Acme.Card {...props} />') });
    assert.deepEqual(miss.errors, []);
  });

  test('transitively through a project helper, with the import chain in the message', () => {
    const r = walk({
      'src/components/Fancy.tsx': `import { Button } from '@acme/core';\nexport const Fancy = (p) => <Button {...p} />;\n`,
      'src/overrides/Button.tsx': button(`import { Fancy } from '../components/Fancy';`, '<Fancy {...props} />'),
    });
    assert.match(r.errors.join('\n'), /\[F7\] src\/overrides\/Button\.tsx -> src\/components\/Fancy\.tsx imports \{ Button \} from "@acme\/core"/);
  });

  test('transitively through a tsconfig "paths" alias and a namespace', () => {
    const r = walk({
      'src/components/Fancy.tsx': `import * as Sdk from '@acme/core';\nexport const Fancy = (p) => <Sdk.Button {...p} />;\n`,
      'src/overrides/Button.tsx': button(`import { Fancy } from '@/components/Fancy';`, '<Fancy {...props} />'),
    }, { tsconfig: true });
    assert.match(r.errors.join('\n'), /\[F7\] src\/overrides\/Button\.tsx -> src\/components\/Fancy\.tsx uses <ns>\.Button from "@acme\/core"/);
  });

  test("through a helper that does `export * from '@acme/core'`", () => {
    const r = walk({
      'src/lib/ui.ts': `export * from '@acme/core';\n`,
      'src/overrides/Button.tsx': button(`import { Button as Effective } from '../lib/ui';`),
    });
    assert.match(r.errors.join('\n'), /\[F7\][^\n]*src\/lib\/ui\.ts re-exports everything from "@acme\/core"/);
  });

  test('a literal dynamic import that reads the slot', () => {
    const r = walk({ 'src/overrides/Button.tsx': `export async function load() { const { Button } = await import('@acme/core'); return Button; }\nexport function Button() { return null; }\n` });
    assert.match(r.errors.join('\n'), /\[F7\][^\n]*loads "@acme\/core" dynamically and reads Button/);
  });
});

describe('not F7', () => {
  test('wrapping the original, type-only imports, other slots and contracts are fine', () => {
    const r = walk({
      'src/overrides/Button.tsx': `import { Button as Original } from '@acme/core/original/Button';
import type { Button as B } from '@acme/core';
import { type SlotProps } from '@acme/core/contracts';
import { Card } from '@acme/core';
export function Button(props: SlotProps['Button'] & { b?: typeof B }) { return <Card><Original {...props} /></Card>; }
`,
    });
    assert.deepEqual(r.errors, []);
  });

  test('the walk stops at node_modules', () => {
    const r = walk({
      'node_modules/some-lib/package.json': JSON.stringify({ name: 'some-lib', version: '1.0.0', main: 'index.js' }),
      'node_modules/some-lib/index.js': `import { Button } from '@acme/core';\nexport const X = Button;\n`,
      'src/overrides/Button.tsx': button(`import { X as Effective } from 'some-lib';`),
    });
    assert.deepEqual(r.errors, []);
  });
});

describe('W7 and F9', () => {
  test('W7: rendering an SDK component that renders this slot is a warning, not an error', () => {
    const r = walk({ 'src/overrides/Button.tsx': button(`import { Dialog as Effective } from '@acme/core';`) });
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join('\n'), /\[W7\][^\n]*renders Dialog from "@acme\/core", and Dialog renders slot "Button"/);
  });

  test('F9: a client slot whose closure imports "server-only"; a shared slot may', () => {
    const files = {
      'src/lib/secret.ts': `import 'server-only';\nexport const secret = 1;\n`,
      'src/overrides/Button.tsx': button(`import { secret } from '../lib/secret';\nimport { Button as Effective } from '@acme/core/original/Button';`),
    };
    assert.match(walk(files).errors.join('\n'), /\[F9\] src\/overrides\/Button\.tsx -> src\/lib\/secret\.ts imports "server-only" but "Button" is a client slot/);
    assert.deepEqual(walk(files, { kind: 'shared' }).errors, []);
  });
});

test('generate() reports F7 from the walk and records the closure for watching', () => {
  const { root } = project({
    files: {
      'src/components/Fancy.tsx': `import { Button } from '@acme/core';\nexport const Fancy = (p) => <Button {...p} />;\n`,
      'src/overrides/Button.tsx': button(`import { Fancy } from '../components/Fancy';`, '<Fancy {...props} />'),
      'src/overrides/Logo.tsx': 'export function Logo() { return null; }\n',
    },
  });
  const p = generate({ root, write: false });
  assert.match(p.problems.join('\n'), /\[F7\] src\/overrides\/Button\.tsx -> src\/components\/Fancy\.tsx/);
  assert.ok(p.watches(path.join(root, 'src/components/Fancy.tsx')), 'a file in an override closure is watched (editing it re-validates)');
});
