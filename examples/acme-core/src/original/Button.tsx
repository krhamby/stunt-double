'use client';
import { useContext, type ReactNode, type Ref } from 'react';
import { CartContext } from '../cart-context.js';

/** Props every Button implementation receives from @acme/core. */
export interface ButtonProps {
  /** Button label. */
  children?: ReactNode;
  /** Visual style. */
  variant?: 'primary' | 'secondary';
  /** Click handler. */
  onClick?: () => void;
  /** Forwarded to the underlying <button>. */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The SDK's default Button. Reachable ONLY as '@acme/core/original/Button' (the wrapping escape hatch):
 * nothing inside @acme/core imports this file; SDK components render the `@acme/core-slots/Button` socket.
 */
export function Button({ children, variant = 'primary', onClick, ref }: ButtonProps) {
  const cart = useContext(CartContext);
  return (
    <button ref={ref} type="button" className={`acme-btn acme-btn-${variant}`} data-sd="SDK_DEFAULT_BUTTON" data-ctx={cart ? 'in-cart' : 'none'} onClick={onClick}>
      {children}
    </button>
  );
}
