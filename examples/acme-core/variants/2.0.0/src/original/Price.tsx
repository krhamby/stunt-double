'use client';
import { formatPrice } from '../format.js';

/** Props every Price implementation receives (renamed from PriceTag in 2.0.0). */
export interface PriceProps {
  /** Amount in major units, e.g. 19.99. */
  amount: number;
  /** ISO 4217 currency code. Defaults to "USD". */
  currency?: string;
}

/** The SDK's default Price. Reachable ONLY as '@acme/core/original/Price'. */
export function Price({ amount, currency = 'USD' }: PriceProps) {
  return (
    <span className="acme-price" data-sd="SDK_DEFAULT_PRICE">
      {formatPrice(amount, currency)}
    </span>
  );
}
