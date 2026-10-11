// V: value slots (kind "value"): services, functions and objects the SDK lets a project replace, not just
// components. The fixture SDK has two: `formatPrice` (a function: SDK_TOTAL's data-ctx is its output) and
// `analytics` (a service object the SDK's ProductCard reports add_to_cart to). Same stages as components: STA for
// naming, presence and cycles, TYP for the contract (SlotTypes['X'] instead of SlotProps['X']).
import { STANDARD_RENDER } from '../harness/expect.mjs';

const TYPES = `import type { SlotTypes } from '@acme/core/contracts';`;

/** The standard render, with the checkout total formatted as `total`. */
const withTotal = (total) => ({ ...STANDARD_RENDER, sdk: { ...STANDARD_RENDER.sdk, 'SDK_TOTAL(USD 19.99)': 0, [`SDK_TOTAL(${total})`]: 1 } });

export default [
  // ---- contract (TYP) --------------------------------------------------------------------------------------
  {
    id: 'V1a',
    title: 'value override does not fit its contract: formatPrice returns a number, not a string',
    catches: 'TYP',
    tags: ['typegate'],
    apply: (fx) => fx.write(fx.override('formatPrice.ts'), `/** Returns cents, which the SDK would print as "1999" next to "in cart". */
export const formatPrice = (amount: number) => Math.round(amount * 100);
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] formatPrice \([^)\n]*formatPrice\.ts\): does not fit the contract @acme\/core SlotTypes\['formatPrice'\][^\n]*TS2322/] },
  },
  {
    id: 'V1b',
    title: 'value override narrows a function parameter: formatPrice accepts only the two fixture prices',
    catches: 'TYP (argsFit)',
    tags: ['typegate'],
    apply: (fx) => fx.write(fx.override('formatPrice.ts'), `const LABELS = { 19.99: 'twenty-ish', 9.5: 'ten-ish' } as const;

// Accepts only two amounts: the SDK passes cart totals, which can be any number.
export function formatPrice(amount: 19.99 | 9.5) {
  return LABELS[amount];
}
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] formatPrice \([^)\n]*formatPrice\.ts\): narrows the parameters of the contract \[amount: number, currency\?: string/] },
  },
  {
    id: 'V1c',
    title: 'service override narrows a METHOD parameter (track(event: "page_view")), which TypeScript itself accepts',
    catches: 'TYP (argsFit)',
    tags: ['typegate'],
    apply: (fx) => fx.write(fx.override('analytics.ts'), `/** Only knows page views, but the SDK reports add_to_cart: plain TypeScript assignability lets this through. */
export const analytics = {
  id: 'BRAND_ANALYTICS',
  track(event: 'page_view', data?: Record<string, unknown>) {
    console.log(event.toUpperCase(), data);
  },
};
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] analytics \([^)\n]*analytics\.ts\): narrows the parameters of these members: "track"/] },
  },
  {
    id: 'V1d',
    title: 'service override is missing a member of its contract (no `id`)',
    catches: 'TYP',
    tags: ['typegate'],
    apply: (fx) => fx.write(fx.override('analytics.ts'), `export const analytics = {
  track(event: string) {
    console.log(event);
  },
};
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F1\] analytics \([^)\n]*analytics\.ts\): does not fit the contract[^\n]*\bid\b/] },
  },
  {
    id: 'V1e',
    title: 'must pass: a function declaration with fewer parameters than the contract, used inside the SDK',
    catches: 'TYP',
    tags: ['typegate', 'must-pass'],
    apply: (fx) => fx.write(fx.override('formatPrice.ts'), `/** Ignores the currency argument: fewer parameters always fit (the SDK's extra arguments are dropped). */
export function formatPrice(amount: number) {
  return \`EUR \${amount.toFixed(2)}\`;
}
`),
    expect: { outcome: 'pass', command: 'build', render: withTotal('EUR 19.99') },
  },
  {
    id: 'V-default',
    title: 'must pass: no value overrides, so the SDK defaults are used (the SDK formats the total itself)',
    catches: '-',
    tags: ['must-pass'],
    apply: (fx) => {
      fx.remove(fx.override('formatPrice.ts'));
      fx.remove(fx.override('analytics.ts'));
    },
    expect: { outcome: 'pass', command: 'build', render: withTotal('$19.99') },
  },

  // ---- naming, presence, cycles (STA) ----------------------------------------------------------------------
  {
    id: 'V2',
    title: 'typo in a value override file name (fromatPrice.ts)',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.rename(fx.override('formatPrice.ts'), fx.override('fromatPrice.ts')),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F2\][^\n]*fromatPrice\.ts[^\n]*unknown slot "fromatPrice"[^\n]*did you mean "formatPrice"/] },
  },
  {
    id: 'V5',
    title: 'value override uses a default export instead of the named export `analytics`',
    catches: 'STA',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('analytics.ts'), `${TYPES}

const analytics: SlotTypes['analytics'] = { id: 'BRAND_ANALYTICS', track() {} };
export default analytics;
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F5\][^\n]*analytics\.ts[^\n]*must export a named `analytics`[^\n]*default/] },
  },
  {
    id: 'V7',
    title: 'value override decorates "the SDK formatter" by importing itself from the barrel (a circular import)',
    catches: 'STA (F7 walk)',
    tags: ['sta'],
    apply: (fx) => fx.write(fx.override('formatPrice.ts'), `import { formatPrice as sdkFormat } from '@acme/core';
${TYPES}

// Meant to decorate the SDK formatter, but '@acme/core' re-exports the EFFECTIVE formatPrice: this very module.
export const formatPrice: SlotTypes['formatPrice'] = (amount, currency) => \`\${sdkFormat(amount, currency)} (incl. VAT)\`;
`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F7\][^\n]*formatPrice\.ts[^\n]*imports \{ formatPrice \} from "@acme\/core"[^\n]*a circular import/] },
  },
];
