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

export type SlotName = keyof SlotProps;
export type RequiredSlot = 'Logo' | 'Footer';
/** Written by `stunt-double sdk-lint --write` at build time: hash(manifest + contracts). */
export type SlotAbi = 'unset';
export type { ButtonProps, PriceProps };
