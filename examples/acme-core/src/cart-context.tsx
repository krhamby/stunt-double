'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface CartItem {
  id: string;
  name: string;
  price: number;
}

export interface Cart {
  items: CartItem[];
  count: number;
  total: number;
  add(item: CartItem): void;
}

/** Exported for SDK internals and advanced overrides; app code should use useCart(). */
export const CartContext = createContext<Cart | null>(null);

export function CartProvider({ children, initial = [] }: { children?: ReactNode; initial?: CartItem[] }) {
  const [items, setItems] = useState<CartItem[]>(initial);
  const value = useMemo<Cart>(
    () => ({ items, count: items.length, total: items.reduce((s, i) => s + i.price, 0), add: (item) => setItems((xs) => [...xs, item]) }),
    [items],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Throws outside <CartProvider>: a duplicated React or SDK instance (F8) shows up exactly here. */
export function useCart(): Cart {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart must be used within <CartProvider>');
  return cart;
}
