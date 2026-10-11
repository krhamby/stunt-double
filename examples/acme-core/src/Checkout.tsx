'use client';
import { Button } from '@acme/core-slots/Button';
import { Logo } from '@acme/core-slots/Logo'; // required slot: @acme/core ships no default
import { PriceTag } from '@acme/core-slots/PriceTag';
import { CartProvider, useCart, type CartItem } from './cart-context.js';
import { ProductCard } from './ProductCard.js';

export interface CheckoutProps {
  products: CartItem[];
  onPay?: () => void;
}

function Summary({ onPay }: { onPay?: () => void }) {
  const cart = useCart();
  return (
    <footer className="acme-summary">
      <span>{cart.count} in cart</span>
      <PriceTag amount={cart.total} />
      <Button onClick={onPay}>Pay</Button>
    </footer>
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
      </section>
    </CartProvider>
  );
}
