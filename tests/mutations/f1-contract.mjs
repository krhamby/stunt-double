// F1: the override does not fit the costume (the SDK's props contract), plus F1c, the shapes that MUST pass.
// Caught by the type gate (TYP): `vite build` (adapter), `stunt-double check`, the project's tsc.
const CONTRACTS = `import type { SlotProps } from '@acme/core/contracts';`;
const ORIGINAL_BUTTON = `import { Button as Original } from '@acme/core/original/Button';`;

/** A must-pass Button shape whose wrapper stamps data-ctx="<ctx>" (instead of the app theme). */
const buttonRender = (ctx) => ({
  app: [`BRAND_BUTTON(${ctx})`, 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { [`BRAND_BUTTON(${ctx})`]: 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0, BRAND_LOGO: 1 },
});

export default [
  {
    id: 'F1a',
    title: 'override requires a prop the SDK never passes (extra required prop)',
    catches: 'TYP',
    tags: ['typegate'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), `${ORIGINAL_BUTTON}
${CONTRACTS}

export function Button({ tone, ...props }: SlotProps['Button'] & { tone: 'loud' | 'quiet' }) {
  return (
    <span data-sd="BRAND_BUTTON" data-ctx={tone}>
      <Original {...props} />
    </span>
  );
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] Button \([^)\n]*Button\.tsx\)[^\n]*TS2322/, /\btone\b/] },
  },
  {
    id: 'F1b',
    title: 'override ignores SDK props (declares only `children`)',
    catches: 'TYP',
    tags: ['typegate'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), `import type { ReactNode } from 'react';

export function Button({ children }: { children?: ReactNode }) {
  return <button data-sd="BRAND_BUTTON">{children}</button>;
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] Button \([^)\n]*Button\.tsx\): override ignores these SDK props/, /onClick/, /variant/] },
  },
  {
    id: 'F1b-upgrade',
    title: 'SDK minor upgrade (1.1.0) widens a contract that the override typed by hand',
    catches: 'TYP',
    tags: ['typegate', 'upgrade'],
    sdk: '1.1.0',
    apply: (fx) => fx.write(fx.override('Button.tsx'), `import type { ReactNode, Ref } from 'react';
${ORIGINAL_BUTTON}

// Written against @acme/core 1.0.0 with its own props interface instead of SlotProps['Button'].
interface MyButtonProps {
  children?: ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
}

export function Button(props: MyButtonProps) {
  return (
    <span data-sd="BRAND_BUTTON" data-ctx="own-props">
      <Original {...props} />
    </span>
  );
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] Button \([^)\n]*Button\.tsx\)/, /danger|size/] },
  },

  // ---- F1c: shapes that must NOT fail (a contract that rejects them would be a false alarm) ------------------
  {
    id: 'F1c-fc',
    title: 'must pass: override typed React.FC<SlotProps["Button"]>',
    catches: 'TYP',
    tags: ['typegate', 'must-pass'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), `import type { FC } from 'react';
${ORIGINAL_BUTTON}
${CONTRACTS}

export const Button: FC<SlotProps['Button']> = (props) => (
  <span data-sd="BRAND_BUTTON" data-ctx="fc">
    <Original {...props} />
  </span>
);
`),
    expect: { outcome: 'pass', command: 'build', render: buttonRender('fc') },
  },
  {
    id: 'F1c-memo',
    title: 'must pass: override wrapped in memo()',
    catches: 'TYP',
    tags: ['typegate', 'must-pass'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), `import { memo } from 'react';
${ORIGINAL_BUTTON}
${CONTRACTS}

export const Button = memo(function Button(props: SlotProps['Button']) {
  return (
    <span data-sd="BRAND_BUTTON" data-ctx="memo">
      <Original {...props} />
    </span>
  );
});
`),
    expect: { outcome: 'pass', command: 'build', render: buttonRender('memo') },
  },
  {
    id: 'F1c-forwardRef',
    title: 'must pass: override written with forwardRef()',
    catches: 'TYP',
    tags: ['typegate', 'must-pass'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), `import { forwardRef } from 'react';
${ORIGINAL_BUTTON}
${CONTRACTS}

export const Button = forwardRef<HTMLButtonElement, Omit<SlotProps['Button'], 'ref'>>(function Button(props, ref) {
  return (
    <span data-sd="BRAND_BUTTON" data-ctx="forwardRef">
      <Original {...props} ref={ref} />
    </span>
  );
});
`),
    expect: { outcome: 'pass', command: 'build', render: buttonRender('forwardRef') },
  },
  {
    id: 'F1c-class',
    title: 'must pass: override written as a class component (Logo)',
    catches: 'TYP',
    tags: ['typegate', 'must-pass'],
    apply: (fx) => fx.write(fx.override('Logo.tsx'), `import { Component } from 'react';
${CONTRACTS}

export class Logo extends Component<SlotProps['Logo']> {
  render() {
    const size = this.props.size ?? 32;
    return <svg data-sd="BRAND_LOGO" data-ctx="class" width={size} height={size} viewBox="0 0 32 32" />;
  }
}
`),
    expect: { outcome: 'pass', command: 'build', render: { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'], sdk: { 'BRAND_LOGO(class)': 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3 } } },
  },
  {
    id: 'F1c-children',
    title: 'must pass: override that returns its children (no element of its own)',
    catches: 'TYP',
    tags: ['typegate', 'must-pass'],
    apply: (fx) => fx.write(fx.override('Button.tsx'), `${CONTRACTS}

export function Button(props: SlotProps['Button']) {
  return props.children;
}
`),
    expect: { outcome: 'pass', command: 'build', render: { app: [], sdk: { BRAND_BUTTON: 0, SDK_DEFAULT_BUTTON: 0, BRAND_PRICE: 3, BRAND_LOGO: 1 } } },
  },
];
