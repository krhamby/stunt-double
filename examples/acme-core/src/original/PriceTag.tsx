'use client';
import { formatPrice } from '@acme/core-slots/formatPrice'; // a value slot: the project's formatter if it has one

/** Props every PriceTag implementation receives from @acme/core. */
export interface PriceTagProps {
  /** Amount in major units, e.g. 19.99. */
  amount: number;
  /** ISO 4217 currency code. Defaults to "USD". */
  currency?: string;
}

/** The SDK's default PriceTag. Reachable ONLY as '@acme/core/original/PriceTag'. */
export function PriceTag({ amount, currency = 'USD' }: PriceTagProps) {
  return (
    <span className="acme-price" data-sd="SDK_DEFAULT_PRICETAG">
      {formatPrice(amount, currency)}
    </span>
  );
}
