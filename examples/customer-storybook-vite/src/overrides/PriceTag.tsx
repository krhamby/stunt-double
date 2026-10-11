import { memo } from 'react';
import type { SlotProps } from '@acme/core/contracts';

/**
 * Stunt double for the "PriceTag" slot: REPLACES the SDK default entirely, so the default is absent from the
 * bundle. Written with memo() on purpose: memo / forwardRef / React.FC / class overrides all pass the contract.
 */
export const PriceTag = memo(function PriceTag({ amount, currency = 'USD' }: SlotProps['PriceTag']) {
  return (
    <strong className="brand-price" data-sd="BRAND_PRICE">
      {currency} {amount.toFixed(2)}
    </strong>
  );
});
