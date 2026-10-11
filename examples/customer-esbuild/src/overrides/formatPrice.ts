import type { SlotTypes } from '@acme/core/contracts';

/**
 * Stunt double for the "formatPrice" VALUE slot: a plain function, not a component. The SDK calls it wherever it
 * shows money (its PriceTag default, the checkout total), so "USD 19.99" replaces "$19.99" everywhere. Typed by
 * its contract, so the build fails if it stops fitting (wrong return type, narrowed parameters, ...).
 */
export const formatPrice: SlotTypes['formatPrice'] = (amount, currency = 'USD') => `${currency} ${amount.toFixed(2)}`;
