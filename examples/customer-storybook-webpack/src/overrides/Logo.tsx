import type { SlotProps } from '@acme/core/contracts';

/** The REQUIRED "Logo" slot: @acme/core ships no default, so without this file every build fails with [F3]. */
export function Logo({ size = 32 }: SlotProps['Logo']) {
  return (
    <svg data-sd="BRAND_LOGO" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Customer brand">
      <circle cx="16" cy="16" r="14" fill="currentColor" />
    </svg>
  );
}
