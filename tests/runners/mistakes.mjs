// The injection mistakes (DESIGN.md §2.3) as mutations of an example project that has the customer-vite
// overrides: src/overrides/Button.tsx (wraps the default), PriceTag.tsx (memo, replaces), Logo.tsx (required).
// Each apply() edits the workspace; ws.reset() undoes it.

export const MISTAKES = {
  F1a: {
    title: 'override requires a prop the SDK never passes (contract mismatch)',
    apply(ws) {
      ws.edit('src/overrides/Button.tsx', (s) => s
        .replace("export function Button(props: SlotProps['Button']) {", "export function Button(props: SlotProps['Button'] & { tone: 'loud' }) {")
        .replace('data-ctx={theme}>', 'data-ctx={theme} data-tone={props.tone}>'));
    },
  },
  F1b: {
    title: 'override ignores contract props (declares fewer)',
    apply(ws) {
      ws.write('src/overrides/PriceTag.tsx', `import { memo } from 'react';
export const PriceTag = memo(function PriceTag({ amount }: { amount: number }) {
  return <strong className="brand-price" data-sd="BRAND_PRICE">USD {amount.toFixed(2)}</strong>;
});
`);
    },
  },
  F9c: {
    title: 'async (server-shaped) override in a client slot',
    apply(ws) {
      ws.write('src/overrides/Logo.tsx', `import type { SlotProps } from '@acme/core/contracts';
export async function Logo({ size = 32 }: SlotProps['Logo']) {
  return <svg data-sd="BRAND_LOGO" width={size} height={size} />;
}
`);
    },
  },
  F2a: {
    title: 'typo in an override file name',
    apply(ws) { ws.write('src/overrides/Buton.tsx', ws.read('src/overrides/Button.tsx')); },
  },
  F2b: {
    title: 'SDK upgrade renamed a slot (@acme/core 2.0.0: PriceTag -> Price)',
    apply(ws) { ws.swapPackage('@acme/core', 'acme-core-2.0.0.tgz'); },
  },
  F3: {
    title: 'required slot Logo not provided',
    apply(ws) { ws.remove('src/overrides/Logo.tsx'); },
  },
  F4: {
    title: 'two files claim the same slot',
    apply(ws) { ws.write('src/overrides/Button/index.tsx', ws.read('src/overrides/Button.tsx').replaceAll("'../theme'", "'../../theme'")); },
  },
  F5: {
    title: 'wrong export (default instead of named)',
    apply(ws) { ws.edit('src/overrides/Logo.tsx', (s) => s.replace('export function Logo', 'export default function Logo')); },
  },
  F6a: {
    title: 'installed SDK imports a slot default relatively (@acme/core 1.0.0-bad-relative)',
    apply(ws) { ws.swapPackage('@acme/core', 'acme-core-1.0.0-bad-relative.tgz'); },
  },
  F6b: {
    title: 'not wired: @acme/core-slots is the registry placeholder (no link)',
    apply(ws) { ws.swapPackage('@acme/core-slots', 'acme-core-slots-0.0.1.tgz'); },
  },
  F6g: {
    title: 'app code imports @acme/core/original/Button outside src/overrides (bypass)',
    apply(ws) {
      ws.write('src/legacy/LegacyButton.tsx', `import { Button } from '@acme/core/original/Button';
export const LegacyButton = () => <Button>legacy</Button>;
`);
    },
  },
  F7: {
    title: 'override imports its own slot through the barrel (infinite render)',
    apply(ws) {
      ws.edit('src/overrides/Button.tsx', (s) => s.replace("import { Button as Original } from '@acme/core/original/Button';", "import { Button as Original } from '@acme/core';"));
    },
  },
  F8: {
    title: 'duplicate React: the installed SDK bundles its own react',
    apply(ws) { ws.swapPackage('@acme/core', 'acme-core-1.0.0-nested-react.tgz'); },
  },
};

/** The sentinel text the registry placeholder makes every resolver print. */
export const NOT_WIRED = 'STUNT-DOUBLE-NOT-WIRED';
