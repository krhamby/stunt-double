// Override-level mistakes applied to a customer-vite-shaped project, with what each mode must do:
//   gated: adapter build, or `stunt-double check && vite build`     bare: `vite build` without either
import fs from 'node:fs';
import path from 'node:path';

const ALL_SDK = { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, SDK_DEFAULT_PRICETAG: 0 };
const OK = { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'], sdk: ALL_SDK };

export const OVERRIDE_MISTAKES = [
  {
    id: 'F1 extra required prop',
    write: { 'src/overrides/Button.tsx': `import type { SlotProps } from '@acme/core/contracts';\nexport function Button({ children, tone }: SlotProps['Button'] & { tone: 'loud' }) {\n  return <button data-sd="BRAND_BUTTON" data-tone={tone}>{children}</button>;\n}\n` },
    gated: { fails: /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322 .*Property 'tone' is missing/ },
    bare: { render: { app: ['BRAND_BUTTON'], sdk: { BRAND_BUTTON: 3 } } }, // ships an override that never gets `tone`
  },
  {
    id: 'F2 typo',
    copy: { 'src/overrides/Button.tsx': 'src/overrides/Buton.tsx' },
    gated: { fails: /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)/ },
    bare: { render: OK }, // the stray file is silently unused
  },
  {
    id: 'F3 required slot missing',
    remove: ['src/overrides/Logo.tsx'],
    gated: { fails: /\[F3\] required slot "Logo" has no implementation/ },
    bare: { fails: /UNRESOLVED_IMPORT\] Could not resolve '\.\.\/\.\.\/src\/overrides\/Logo\.tsx'/ },
  },
  {
    id: 'F4 two claims',
    copy: { 'src/overrides/Button.tsx': 'src/overrides/Button/index.tsx' },
    gated: { fails: /\[F4\] slot "Button" is claimed by 2 files/ },
    bare: { render: OK }, // previous decision
  },
  {
    id: 'F5 default export',
    edit: { 'src/overrides/PriceTag.tsx': (s) => s.replace('export const PriceTag', 'const PriceTag') + '\nexport default PriceTag;\n' },
    gated: { fails: /\[F5\] src\/overrides\/PriceTag\.tsx must export a named `PriceTag` \(it exports: default\)/ },
    bare: { fails: /MISSING_EXPORT\] "PriceTag" is not exported by "sdk-slots\/gen\/PriceTag\.jsx"/ },
  },
  {
    id: 'F6g bypass via original/*',
    edit: { 'src/App.tsx': (s) => `import { Button as Default } from '@acme/core/original/Button';\n` + s.replace('<Button variant="primary">Sign in</Button>', '<Default variant="primary">Sign in</Default>') },
    gated: { fails: /\[F6\] src\/App\.tsx imports "@acme\/core\/original\/Button" outside src\/overrides/ },
    bare: { render: { app: ['SDK_DEFAULT_BUTTON(none)'], sdk: ALL_SDK } }, // that call site silently renders the default
  },
  {
    id: 'F7 override imports its own slot',
    write: { 'src/overrides/Button.tsx': `import { Button as Sdk } from '@acme/core';\nimport type { SlotProps } from '@acme/core/contracts';\nexport function Button(props: SlotProps['Button']) {\n  return <span data-sd="BRAND_BUTTON"><Sdk {...props} /></span>;\n}\n` },
    gated: { fails: /\[F7\] src\/overrides\/Button\.tsx imports \{ Button \} from "@acme\/core": that is slot "Button" itself/ },
    bare: { runtime: /heap out of memory|Maximum call stack/ }, // infinite render
  },
];

const SNAP_PATHS = ['src/overrides', 'src/App.tsx'];

/** Snapshot the mutable files; returns restore(). */
export function snapshot(dir) {
  const snap = path.join(dir, '.sd-snapshot');
  fs.rmSync(snap, { recursive: true, force: true });
  for (const p of SNAP_PATHS) fs.cpSync(path.join(dir, p), path.join(snap, p), { recursive: true });
  return () => {
    for (const p of SNAP_PATHS) {
      fs.rmSync(path.join(dir, p), { recursive: true, force: true });
      fs.cpSync(path.join(snap, p), path.join(dir, p), { recursive: true });
    }
  };
}

export function applyMistake(dir, m) {
  const f = (p) => path.join(dir, p);
  for (const [p, text] of Object.entries(m.write ?? {})) fs.writeFileSync(f(p), text);
  for (const [from, to] of Object.entries(m.copy ?? {})) { fs.mkdirSync(path.dirname(f(to)), { recursive: true }); fs.copyFileSync(f(from), f(to)); }
  for (const p of m.remove ?? []) fs.rmSync(f(p));
  for (const [p, fn] of Object.entries(m.edit ?? {})) fs.writeFileSync(f(p), fn(fs.readFileSync(f(p), 'utf8')));
}
