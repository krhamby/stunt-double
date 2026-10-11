'use client';
import { Badge } from '@acme/core-slots/Badge';
import { analytics } from '@acme/core-slots/analytics'; // a value slot: the project's analytics service, if any
import { Button } from '@acme/core-slots/Button';
import { PriceTag } from '@acme/core-slots/PriceTag';
import { useCart, type CartItem } from './cart-context.js';

export interface ProductCardProps {
  product: CartItem;
}

export function ProductCard({ product }: ProductCardProps) {
  const cart = useCart();
  const addToCart = () => {
    analytics.track('add_to_cart', { product: product.id });
    cart.add(product);
  };
  return (
    <article className="acme-product" data-product={product.id}>
      <h3>{product.name}</h3>
      <Badge label="In stock" tone="success" />
      <PriceTag amount={product.price} />
      <Button variant="secondary" size="sm" onClick={addToCart}>
        Add to cart
      </Button>
    </article>
  );
}
