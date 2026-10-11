import type { ReactNode } from 'react';
import type { ButtonProps } from './original/Button.js';
import type { PriceProps } from './original/Price.js';

/** Props every Logo implementation receives. REQUIRED slot. */
export interface LogoProps {
  /** Rendered height in px. */
  size?: number;
}

/** Props every Footer implementation receives. REQUIRED slot (new in 2.0.0). */
export interface FooterProps {
  children?: ReactNode;
}

/** Props every implementation of a slot must accept. */
export interface SlotProps {
  Button: ButtonProps;
  /** Renamed from PriceTag in 2.0.0. */
  Price: PriceProps;
  Logo: LogoProps;
  /** New REQUIRED slot in 2.0.0. */
  Footer: FooterProps;
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
export type RequiredSlot = 'Logo' | 'Footer';
/** Written by `stunt-double sdk-lint --write` at build time: hash(manifest + contracts). */
export type SlotAbi = 'unset';
export type { ButtonProps, PriceProps };
