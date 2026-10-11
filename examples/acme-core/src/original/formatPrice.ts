import type { FormatPrice } from '../contracts.js';

/**
 * The SDK's default money formatter (a VALUE slot: a function, not a component). Reachable ONLY as
 * '@acme/core/original/formatPrice'; SDK code calls the `@acme/core-slots/formatPrice` socket.
 */
export const formatPrice: FormatPrice = (amount, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
