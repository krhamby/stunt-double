// F6: "the override is not applied" mistakes. The worst kind for runtime DI: nothing crashes, the SDK default
// just quietly renders. Each one must fail the build (or, F6h, be repaired automatically by the adapter).
export default [
  {
    id: 'F6a',
    title: 'installed SDK imports a slot default directly (1.0.0-bad-relative: Checkout -> ./original/Button.js)',
    catches: 'STA (dist scan of the installed SDK)',
    tags: ['sta', 'sdk-bug'],
    sdk: '1.0.0-bad-relative',
    apply: () => {},
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\][^\n]*Checkout\.js[^\n]*imports the default of slot "Button" directly/] },
  },
  {
    id: 'F6b-config',
    title: 'a second tool config WITHOUT the adapter resolves the registry placeholder and fails',
    catches: 'RES (registry placeholder)',
    tags: ['res'],
    needs: ['unwired'],
    apply: (fx, suite) => { for (const [rel, text] of Object.entries(suite.unwired.files ?? {})) fx.write(rel, text); },
    expect: { outcome: 'fail', command: 'unwired', messages: [/STUNT-DOUBLE-NOT-WIRED/] },
  },
  {
    id: 'F6b-node',
    title: 'plain Node imports the SDK (no tool at all): ERR_MODULE_NOT_FOUND on the placeholder poison',
    catches: 'RES (registry placeholder)',
    tags: ['res'],
    apply: () => {},
    expect: {
      outcome: 'fail',
      run: `node --input-type=module -e "const m = await import('@acme/core'); console.log('RENDERED-DEFAULTS', Object.keys(m).join(','))"`,
      messages: [/ERR_MODULE_NOT_FOUND/, /STUNT-DOUBLE-NOT-WIRED/],
      absent: [/RENDERED-DEFAULTS/],
    },
  },
  {
    id: 'F6g',
    title: 'app code outside the overrides imports @acme/core/original/Button (bypasses the slot at that call site)',
    catches: 'STA (bypass scan)',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.src('legacy/LegacyBanner.tsx'), `import { Button } from '@acme/core/original/Button';

export function LegacyBanner() {
  return <Button variant="secondary">Legacy</Button>;
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\][^\n]*legacy\/LegacyBanner\.tsx imports "@acme\/core\/original\/Button" outside [^\n]*overrides/] },
  },
  {
    id: 'F6h-add',
    title: 'override added after the last generation (no manual regen): the adapter regenerates, the override renders',
    catches: 'adapter regenerates at every start',
    tags: ['stale', 'must-pass'],
    apply: async (fx) => {
      fx.remove(fx.override('PriceTag.tsx'));
      const g = await fx.run('stunt-double gen');
      if (g.code !== 0) throw new Error(`stunt-double gen failed:\n${g.output}`);
      fx.restore(fx.override('PriceTag.tsx'));
    },
    expect: { outcome: 'pass', command: 'build', render: { sdk: { BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0 } } },
  },
  {
    id: 'F6h-remove',
    title: 'override removed after the last generation: the adapter regenerates, the SDK default renders again',
    catches: 'adapter regenerates at every start',
    tags: ['stale', 'must-pass'],
    apply: async (fx) => {
      const g = await fx.run('stunt-double gen');
      if (g.code !== 0) throw new Error(`stunt-double gen failed:\n${g.output}`);
      fx.remove(fx.override('PriceTag.tsx'));
    },
    expect: { outcome: 'pass', command: 'build', render: { sdk: { BRAND_PRICE: 0, SDK_DEFAULT_PRICETAG: 3, 'BRAND_BUTTON(dark)': 3, BRAND_LOGO: 1 } } },
  },
];
