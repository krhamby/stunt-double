'use client';
import { Button } from '@acme/core-slots/Button';
import { Footer } from '@acme/core-slots/Footer'; // new REQUIRED slot in 2.0.0
import { Logo } from '@acme/core-slots/Logo';
import { Price } from '@acme/core-slots/Price';
import { CartProvider, useCart, type CartItem } from './cart-context.js';
import { ProductCard } from './ProductCard.js';

export interface CheckoutProps {
  products: CartItem[];
  onPay?: () => void;
}

function Summary({ onPay }: { onPay?: () => void }) {
  const cart = useCart();
  return (
    <div className="acme-summary">
      <span>{cart.count} in cart</span>
      <Price amount={cart.total} />
      <Button onClick={onPay}>Pay</Button>
    </div>
  );
}

export function Checkout({ products, onPay }: CheckoutProps) {
  return (
    <CartProvider initial={products.slice(0, 1)}>
      <section className="acme-checkout">
        <header>
          <Logo size={24} />
        </header>
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
        <Summary onPay={onPay} />
        <Footer>Secure checkout by Acme</Footer>
      </section>
    </CartProvider>
  );
}
