/** Shared money formatting (also handy for project overrides: import { formatPrice } from '@acme/core'). */
export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}
