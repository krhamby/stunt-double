import { Checkout } from '@acme/core';
import { products } from '../products';
import { ThemeProvider } from '../theme';

// A React island (client:load): prerendered into the HTML and then hydrated from the client bundle in dist/_astro.
export function CartIsland() {
  return (
    <ThemeProvider value="dark">
      <Checkout products={products} />
    </ThemeProvider>
  );
}
