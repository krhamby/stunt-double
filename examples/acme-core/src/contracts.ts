// Published as '@acme/core/contracts' (types only). Props are imported RELATIVELY from the originals, never
// through '@acme/core-slots': a project's tsconfig "paths" would otherwise compare an override with itself.
import type { ButtonProps } from './original/Button.js';
import type { PriceTagProps } from './original/PriceTag.js';

/** Props every Logo implementation receives. @acme/core ships NO default: the project must provide one. */
export interface LogoProps {
  /** Rendered height in px. */
  size?: number;
}

/** Props every implementation of a slot must accept. JSDoc here is what `stunt-double ls` and the IDE show. */
export interface SlotProps {
  /** The primary action button (rendered by ProductCard, Checkout, and app code). */
  Button: ButtonProps;
  /** Formats and shows a price (rendered by ProductCard and Checkout). */
  PriceTag: PriceTagProps;
  /** The brand logo in the Checkout header. REQUIRED. */
  Logo: LogoProps;
}

export type SlotName = keyof SlotProps;
export type RequiredSlot = 'Logo';
/** Written by `stunt-double sdk-lint --write` at build time: hash(manifest + contracts). */
export type SlotAbi = 'unset';
export type { ButtonProps, PriceTagProps };
