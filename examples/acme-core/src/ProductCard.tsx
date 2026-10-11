'use client';
// Sockets, never './original/*': the project decides what renders here.
import { Button } from '@acme/core-slots/Button';
import { PriceTag } from '@acme/core-slots/PriceTag';
import { useCart, type CartItem } from './cart-context.js';

export interface ProductCardProps {
  product: CartItem;
}

export function ProductCard({ product }: ProductCardProps) {
  const cart = useCart();
  return (
    <article className="acme-product" data-product={product.id}>
      <h3>{product.name}</h3>
      <PriceTag amount={product.price} />
      <Button variant="secondary" onClick={() => cart.add(product)}>
        Add to cart
      </Button>
    </article>
  );
}
