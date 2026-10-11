'use client';
import { useContext, type ReactNode, type Ref } from 'react';
import { CartContext } from '../cart-context.js';

/** Props every Button implementation receives from @acme/core. */
export interface ButtonProps {
  /** Button label. */
  children?: ReactNode;
  /** Visual style. 1.1.0 adds 'danger'. */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Size (new in 1.1.0). */
  size?: 'sm' | 'md' | 'lg';
  /** Click handler. */
  onClick?: () => void;
  /** Forwarded to the underlying <button>. */
  ref?: Ref<HTMLButtonElement>;
}

/** The SDK's default Button. Reachable ONLY as '@acme/core/original/Button'. */
export function Button({ children, variant = 'primary', size = 'md', onClick, ref }: ButtonProps) {
  const cart = useContext(CartContext);
  return (
    <button ref={ref} type="button" className={`acme-btn acme-btn-${variant} acme-btn-${size}`} data-sd="SDK_DEFAULT_BUTTON" data-ctx={cart ? 'in-cart' : 'none'} onClick={onClick}>
      {children}
    </button>
  );
}
