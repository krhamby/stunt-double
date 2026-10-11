// F7 (an override renders itself: infinite render at runtime), F8 (duplicate React), F9 (server/client
// mismatch). F7/F8/F9b are static validation (STA); F9c is the type gate (TYP).
const CONTRACTS = `import type { SlotProps } from '@acme/core/contracts';`;

/** A Button override that renders `Inner` (imported by `importLine`) inside the brand wrapper. */
const buttonVia = (importLine, inner = 'Effective') => `${importLine}
${CONTRACTS}

export function Button(props: SlotProps['Button']) {
  return (
    <span data-sd="BRAND_BUTTON">
      <${inner} {...props} />
    </span>
  );
}
`;

export default [
  {
    id: 'F7a',
    title: 'override imports its own socket (@acme/core-slots/Button)',
    catches: 'STA (F7 walk)',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), buttonVia(`import { Button as Effective } from '@acme/core-slots/Button';`)),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F7\][^\n]*Button\.tsx[^\n]*imports "@acme\/core-slots\/Button"[^\n]*slot "Button" itself/] },
  },
  {
    id: 'F7b',
    title: 'override imports its own slot from the SDK barrel (@acme/core)',
    catches: 'STA (F7 walk)',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), buttonVia(`import { Button as Effective } from '@acme/core';`)),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F7\][^\n]*Button\.tsx[^\n]*imports \{ Button \} from "@acme\/core"[^\n]*slot "Button" itself/] },
  },
  {
    id: 'F7c',
    title: 'override reaches its own slot transitively, through a project helper',
    catches: 'STA (F7 walk)',
    tags: ['sta'],
    apply: (fx) => {
      const helper = fx.src('components/FancyButton.tsx');
      fx.write(helper, `import { Button } from '@acme/core';
${CONTRACTS}

/** An app component that happens to render the SDK Button (which is the override itself). */
export function FancyButton(props: SlotProps['Button']) {
  return <Button {...props} />;
}
`);
      const file = fx.override('Button.tsx');
      fx.write(file, buttonVia(`import { FancyButton } from '${fx.spec(file, helper)}';`, 'FancyButton'));
    },
    expect: { outcome: 'fail', command: 'build', messages: [/\[F7\][^\n]*overrides\/Button\.tsx -> [^\n]*components\/FancyButton\.tsx imports \{ Button \} from "@acme\/core"/] },
  },
  {
    id: 'F7d',
    title: 'override renders its own slot through a namespace import (<Acme.Button>)',
    catches: 'STA (F7 walk)',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), buttonVia(`import * as Acme from '@acme/core';`, 'Acme.Button')),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F7\][^\n]*Button\.tsx[^\n]*uses <ns>\.Button from "@acme\/core"/] },
  },
  {
    id: 'F8',
    title: 'duplicate React: the installed SDK resolves its own nested copy (1.0.0-nested-react)',
    catches: 'STA (singleton preflight) + AUD',
    tags: ['sta', 'sdk-bug'],
    sdk: '1.0.0-nested-react',
    apply: () => {},
    expect: { outcome: 'fail', command: 'build', messages: [/\[F8\][^\n]*"react"[^\n]*2 (copies|locations)/] },
  },
  {
    id: 'F9b',
    title: 'client-slot override imports "server-only"',
    catches: 'STA (F7 walk)',
    tags: ['sta', 'rsc'],
    apply: (fx) => fx.edit(fx.override('Button.tsx'), (s) => `import 'server-only';\n${s}`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F9\][^\n]*imports "server-only"[^\n]*"Button" is a client slot/] },
  },
  {
    id: 'F9c',
    title: 'async (server-shaped) override in a client slot',
    catches: 'TYP',
    tags: ['typegate', 'rsc'],
    apply: (fx) => fx.write(fx.override('Logo.tsx'), `${CONTRACTS}

export async function Logo({ size = 32 }: SlotProps['Logo']) {
  return <svg data-sd="BRAND_LOGO" width={size} height={size} viewBox="0 0 32 32" />;
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F9\] Logo \([^)\n]*Logo\.tsx\)[^\n]*must not be an async component/] },
  },
];
