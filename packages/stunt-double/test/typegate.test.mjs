// The type gate end to end on a tiny project: the real TypeScript compiler (the repo's, resolved by package
// name exactly like a project's) compiles the generated check file. Skipped when TypeScript or @types/react is
// not installed at the repository root.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generate, runTypeGate } from '../src/core/index.mjs';
import { project, linkTypeScript } from './helpers.mjs';

const CONTRACTS = `import type { SlotProps } from '@acme/core/contracts';`;
const good = {
  'src/overrides/Button.tsx': `import { Button as Original } from '@acme/core/original/Button';\n${CONTRACTS}\nexport function Button(props: SlotProps['Button']) { return <span><Original {...props} /></span>; }\n`,
  'src/overrides/Logo.tsx': `${CONTRACTS}\nexport function Logo(_props: SlotProps['Logo']) { return <svg />; }\n`,
};

async function gate(files) {
  const { root } = project({ files });
  const tsVersion = linkTypeScript(root);
  if (!tsVersion) return null;
  const p = generate({ root, onError: 'return' });
  assert.deepEqual(p.problems, []);
  return { r: await runTypeGate(p, { force: true }), tsVersion };
}

describe('type gate (real tsc)', () => {
  test('a fitting override passes', async (t) => {
    const g = await gate(good);
    if (!g) return t.skip('typescript / @types/react not installed at the repo root');
    assert.equal(g.r.ok, true, g.r.message);
  });

  test('[F1] an extra required prop, mapped to the slot and the override file', async (t) => {
    const g = await gate({ ...good, 'src/overrides/Button.tsx': `${CONTRACTS}\nexport function Button({ tone }: SlotProps['Button'] & { tone: 'loud' }) { return <b>{tone}</b>; }\n` });
    if (!g) return t.skip('typescript / @types/react not installed at the repo root');
    assert.equal(g.r.ok, false);
    assert.match(g.r.message, /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322[^\n]*tone/);
    assert.match(g.r.message, new RegExp(`tsc ${g.tsVersion.replace(/\./g, '\\.')}`));
  });

  test('[F1] declaresAll: an override that silently drops SDK props', async (t) => {
    const g = await gate({ ...good, 'src/overrides/Button.tsx': `import type { ReactNode } from 'react';\nexport function Button({ children }: { children?: ReactNode }) { return <b>{children}</b>; }\n` });
    if (!g) return t.skip('typescript / @types/react not installed at the repo root');
    assert.equal(g.r.ok, false);
    assert.match(g.r.message, /\[F1\] Button \(src\/overrides\/Button\.tsx\): override ignores these SDK props: [^\n]*"onClick"[^\n]*"variant"/);
  });

  test('[F9] an async override in a client slot; [F1] a non-component', async (t) => {
    const g = await gate({ ...good, 'src/overrides/Logo.tsx': `${CONTRACTS}\nexport async function Logo(_p: SlotProps['Logo']) { return <svg />; }\n`, 'src/overrides/Card.tsx': `export const Card = 'not a component';\n` });
    if (!g) return t.skip('typescript / @types/react not installed at the repo root');
    assert.equal(g.r.ok, false);
    assert.match(g.r.message, /\[F9\] Logo \(src\/overrides\/Logo\.tsx\): client slot override must not be an async component/);
    assert.match(g.r.message, /\[F1\] Card \(src\/overrides\/Card\.tsx\): is not a React component/);
  });
});
