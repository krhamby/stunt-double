// The barrel re-exports SOCKETS, so app-level imports get the effective (possibly overridden) component too.
export { Button } from '@acme/core-slots/Button';
export { PriceTag } from '@acme/core-slots/PriceTag';
export { Logo } from '@acme/core-slots/Logo';
export { ProductCard, type ProductCardProps } from './ProductCard.js';
export { Checkout, type CheckoutProps } from './Checkout.js';
export { CartProvider, useCart, type Cart, type CartItem } from './cart-context.js';
export { formatPrice } from '@acme/core-slots/formatPrice';
export { analytics } from '@acme/core-slots/analytics';
export type { SlotProps, SlotTypes, FormatPrice, Analytics, SlotName, RequiredSlot, SlotAbi, ButtonProps, PriceTagProps, LogoProps } from './contracts.js';
