// F2-F5 and CFG: naming, presence and export mistakes. Caught by static validation (STA) at every adapter start.
const CONTRACTS = `import type { SlotProps } from '@acme/core/contracts';`;

const LOGO_BODY = `<svg data-sd="BRAND_LOGO" width={size} height={size} viewBox="0 0 32 32" />`;

export default [
  {
    id: 'F2a',
    title: 'typo in an override file name (Buton.tsx)',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.rename(fx.override('Button.tsx'), fx.override('Buton.tsx')),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F2\][^\n]*Buton\.tsx[^\n]*unknown slot "Buton"[^\n]*did you mean "Button"/] },
  },
  {
    id: 'F2a-stray',
    title: 'stray file in the overrides directory (Button.override.tsx)',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('Button.override.tsx'), fx.read(fx.override('Button.tsx'))),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F2\][^\n]*Button\.override\.tsx[^\n]*unknown slot/] },
  },
  {
    id: 'F2b',
    title: 'SDK major upgrade (2.0.0) renames the PriceTag slot the project overrides',
    catches: 'STA',
    tags: ['sta', 'upgrade'],
    sdk: '2.0.0',
    apply: () => {},
    expect: { outcome: 'fail', command: 'build', messages: [/\[F2\][^\n]*PriceTag[^\n]*RENAMED to "Price"/] },
  },
  {
    id: 'F3a',
    title: 'required slot Logo has no implementation',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.remove(fx.override('Logo.tsx')),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F3\][^\n]*required slot "Logo"/] },
  },
  {
    id: 'F3b',
    title: 'SDK major upgrade (2.0.0) adds the required slot Footer (PriceTag override already renamed to Price)',
    catches: 'STA',
    tags: ['sta', 'upgrade'],
    sdk: '2.0.0',
    apply: (fx) => {
      fx.remove(fx.override('PriceTag.tsx'));
      fx.write(fx.override('Price.tsx'), `${CONTRACTS}

export function Price({ amount, currency = 'USD' }: SlotProps['Price']) {
  return <strong data-sd="BRAND_PRICE">{currency} {amount.toFixed(2)}</strong>;
}
`);
    },
    expect: { outcome: 'fail', command: 'build', messages: [/\[F3\][^\n]*required slot "Footer"/], absent: [/RENAMED/] },
  },
  {
    id: 'F4',
    title: 'slot claimed twice: Button.tsx and Button/index.tsx',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('Button/index.tsx'), `import { Button as Original } from '@acme/core/original/Button';
${CONTRACTS}

export function Button(props: SlotProps['Button']) {
  return <Original {...props} />;
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F4\][^\n]*slot "Button" is claimed by 2 files/] },
  },
  {
    id: 'F5a',
    title: 'override uses a default export instead of the named export `Logo`',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('Logo.tsx'), `${CONTRACTS}

export default function Logo({ size = 32 }: SlotProps['Logo']) {
  return ${LOGO_BODY};
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F5\][^\n]*Logo\.tsx[^\n]*must export a named `Logo`[^\n]*default/] },
  },
  {
    id: 'F5b',
    title: 'override exports the wrong name (BrandLogo instead of Logo)',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('Logo.tsx'), `${CONTRACTS}

export function BrandLogo({ size = 32 }: SlotProps['Logo']) {
  return ${LOGO_BODY};
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F5\][^\n]*Logo\.tsx[^\n]*must export a named `Logo`[^\n]*BrandLogo/] },
  },
  {
    id: 'CFG',
    title: 'typo in a stunt-double config key ("overidesDir")',
    catches: 'STA',
    tags: ['sta', 'config'],
    apply: (fx) => fx.config({ overidesDir: 'src/overrides' }),
    expect: { outcome: 'fail', command: 'build', messages: [/\[CFG\][^\n]*unknown key "overidesDir"/] },
  },
  {
    id: 'UPG-minor',
    title: 'SDK minor upgrade (1.1.0, new optional slot Badge) just works: Badge renders the SDK default',
    catches: '-',
    tags: ['upgrade', 'must-pass'],
    sdk: '1.1.0',
    apply: () => {},
    expect: {
      outcome: 'pass',
      command: 'build',
      render: { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'], sdk: { SDK_DEFAULT_BADGE: 2, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, BRAND_LOGO: 1, SDK_DEFAULT_PRICETAG: 0 } },
    },
  },
];
