import type { BadgeProps } from './original/Badge.js';
import type { ButtonProps } from './original/Button.js';
import type { PriceTagProps } from './original/PriceTag.js';

/** Props every Logo implementation receives. @acme/core ships NO default: the project must provide one. */
export interface LogoProps {
  /** Rendered height in px. */
  size?: number;
}

/** Props every implementation of a slot must accept. */
export interface SlotProps {
  /** The primary action button (rendered by ProductCard, Checkout, and app code). */
  Button: ButtonProps;
  /** Formats and shows a price (rendered by ProductCard and Checkout). */
  PriceTag: PriceTagProps;
  /** The brand logo in the Checkout header. REQUIRED. */
  Logo: LogoProps;
  /** Stock badge on each ProductCard (new in 1.1.0, optional). */
  Badge: BadgeProps;
}

/** The money formatter every PriceTag and the checkout total use. */
export type FormatPrice = (amount: number, currency?: string) => string;

/** The analytics service the SDK reports user actions to. */
export interface Analytics {
  /** Which backend this is (shown in debug tooling). */
  readonly id: string;
  /** Record one event, e.g. track('add_to_cart', { product: 'tee' }). */
  track(event: string, data?: Record<string, unknown>): void;
}

/** Types every implementation of a VALUE slot must have (services, functions, config: anything but a component). */
export interface SlotTypes {
  /** Formats money for display (called by PriceTag and the checkout total). */
  formatPrice: FormatPrice;
  /** Receives SDK events such as add_to_cart (called by ProductCard). */
  analytics: Analytics;
}

export type SlotName = keyof SlotProps | keyof SlotTypes;
export type RequiredSlot = 'Logo';
/** Written by `stunt-double sdk-lint --write` at build time: hash(manifest + contracts). */
export type SlotAbi = 'unset';
export type { BadgeProps, ButtonProps, PriceTagProps };
