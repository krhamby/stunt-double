import { Button, Checkout } from '@acme/core';
import { products } from '../products';
import { ThemeProvider } from '../theme';

// Rendered at build time only (no client directive): static HTML from Astro's server graph.
export function App() {
  return (
    <ThemeProvider value="dark">
      <section data-probe="app">
        <Button variant="primary">Sign in</Button>
      </section>
      <section data-probe="sdk">
        <Checkout products={products} />
      </section>
    </ThemeProvider>
  );
}
