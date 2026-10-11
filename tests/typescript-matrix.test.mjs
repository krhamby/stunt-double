// The contract type gate under TypeScript 7.0.2 and 5.9.3 (an npm alias + "typescript": "typescript5"),
// strict on and off: override shapes that must pass, and contract mistakes that must fail with their code.
// Run: npm run setup && node --test tests/typescript-matrix.test.mjs
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageManagers, makeProject, install, run } from './package-managers/project.mjs';

const pms = packageManagers();
const CONTRACT = `import type { SlotProps } from '@acme/core/contracts';\n`;
const BTN = (props, body = '<button ref={ref} data-v={variant} onClick={onClick}>{children}</button>') => `({ children, variant, onClick, ref }: ${props}) { return ${body}; }`;

/** Button overrides: must pass under every TS version and strict setting */
const PASS = {
  plain: `${CONTRACT}export function Button${BTN("SlotProps['Button']")}\n`,
  'React.FC': `import type { FC } from 'react';\n${CONTRACT}export const Button: FC<SlotProps['Button']> = ({ children, variant, onClick, ref }) => <button ref={ref} data-v={variant} onClick={onClick}>{children}</button>;\n`,
  memo: `import { memo } from 'react';\n${CONTRACT}export const Button = memo(function Button${BTN("SlotProps['Button']")});\n`,
  forwardRef: `import { forwardRef } from 'react';\n${CONTRACT}export const Button = forwardRef<HTMLButtonElement, Omit<SlotProps['Button'], 'ref'>>(function Button({ children, variant, onClick }, ref) { return <button ref={ref} data-v={variant} onClick={onClick}>{children}</button>; });\n`,
  class: `import { Component } from 'react';\n${CONTRACT}export class Button extends Component<SlotProps['Button']> { render() { const { children, variant, onClick } = this.props; return <button data-v={variant} onClick={onClick}>{children}</button>; } }\n`,
  'returns children': `${CONTRACT}export function Button({ children }: SlotProps['Button']) { return children; }\n`,
};

/** Button overrides: must fail with this line (strict-independent) */
const FAIL = {
  'extra required prop': [`${CONTRACT}export function Button({ children, tone }: SlotProps['Button'] & { tone: 'loud' }) { return <button data-tone={tone}>{children}</button>; }\n`, /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322 .*Property 'tone' is missing/],
  'narrowed union': [`import type { ReactNode, Ref } from 'react';\nexport function Button({ children }: { children?: ReactNode; variant?: 'primary'; onClick?: () => void; ref?: Ref<HTMLButtonElement> }) { return <button>{children}</button>; }\n`, /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/],
  'declares fewer props': [`import type { ReactNode } from 'react';\nexport function Button({ children }: { children?: ReactNode }) { return <button>{children}</button>; }\n`, /\[F1\] Button \(src\/overrides\/Button\.tsx\): override ignores these SDK props: .*"onClick"/],
  'wrong ref element': [`import type { ReactNode, Ref } from 'react';\nexport function Button({ children }: { children?: ReactNode; variant?: 'primary' | 'secondary'; onClick?: () => void; ref?: Ref<HTMLDivElement> }) { return <div>{children}</div>; }\n`, /\[F1\] Button \(src\/overrides\/Button\.tsx\): TS2322/],
  'async component': [`${CONTRACT}export async function Button({ children }: SlotProps['Button']) { return <button>{children}</button>; }\n`, /\[F9\] Button \(src\/overrides\/Button\.tsx\): client slot override must not be an async component/],
  'not a component': [`export const Button = 'button';\n`, /\[F1\] Button \(src\/overrides\/Button\.tsx\): is not a React component/],
  'default export': [`${CONTRACT}export default function Button({ children }: SlotProps['Button']) { return <button>{children}</button>; }\n`, /\[F5\] src\/overrides\/Button\.tsx must export a named `Button` \(it exports: default\)/],
};

describe('type gate: TypeScript 7.0.2 / 5.9.3 x strict on / off', { concurrency: 1 }, () => {
  let dir, appTsconfig, button;
  before(async () => {
    dir = makeProject('ts-matrix', 'npm', 'adapter', { edit: (_d, pkg) => { pkg.devDependencies.typescript5 = 'npm:typescript@5.9.3'; } });
    const i = await install(pms, 'npm', dir);
    assert.equal(i.code, 0, i.out.slice(-2000));
    appTsconfig = fs.readFileSync(path.join(dir, 'tsconfig.app.json'), 'utf8');
    button = path.join(dir, 'src/overrides/Button.tsx');
  });

  for (const [ts, version] of [['typescript', '7.0.2'], ['typescript5', '5.9.3']]) {
    for (const strict of [true, false]) {
      test(`${ts === 'typescript' ? 'TS 7' : 'TS 5.9 (typescript5 alias)'}, strict ${strict ? 'on' : 'off'}`, async () => {
        fs.writeFileSync(path.join(dir, 'stunt-double.config.json'), JSON.stringify({ sdk: '@acme/core', typescript: ts }));
        assert.match(appTsconfig, /"strict": true/);
        fs.writeFileSync(path.join(dir, 'tsconfig.app.json'), appTsconfig.replace('"strict": true', `"strict": ${strict}`));
        const check = () => run(['npx', '--no-install', 'stunt-double'], ['check'], dir);
        for (const [name, text] of Object.entries(PASS)) {
          fs.writeFileSync(button, text);
          const r = await check();
          assert.equal(r.code, 0, `${name} must pass:\n${r.out}`);
          assert.match(r.out, new RegExp(`contracts checked by tsc ${version.replace(/\./g, '\\.')}`), name);
        }
        for (const [name, [text, re]] of Object.entries(FAIL)) {
          fs.writeFileSync(button, text);
          const r = await check();
          assert.notEqual(r.code, 0, `${name} must fail:\n${r.out}`);
          assert.match(r.out, re, name);
          if (!name.startsWith('default')) assert.match(r.out, new RegExp(`\\(tsc ${version.replace(/\./g, '\\.')}, \\d+ ms\\)`), name);
        }
      });
    }
  }
});
