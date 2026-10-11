import { Button, Checkout } from '@acme/core';
import { products } from './products';
import { ThemeProvider } from './theme';

// Both positions get the stunt doubles: the app's own <Button> (through the @acme/core barrel) and every
// Button / PriceTag / Logo that the SDK's <Checkout> renders internally.
export function App() {
  return (
    <ThemeProvider value="dark">
      <main>
        <h1>customer-rsbuild</h1>
        <section data-probe="app">
          <Button variant="primary">Sign in</Button>
        </section>
        <section data-probe="sdk">
          <Checkout products={products} />
        </section>
      </main>
    </ThemeProvider>
  );
}
