import { Button, Checkout } from '@acme/core';
import { products } from '../products';
import { ThemeProvider } from '../theme';

export function meta() {
  return [{ title: 'customer-react-router: stunt-double example' }];
}

// Both positions get the stunt doubles, on the server (SSR HTML) and after hydration: the app's own <Button>
// (through the @acme/core barrel) and every Button / PriceTag / Logo that the SDK's <Checkout> renders.
export default function Home() {
  return (
    <ThemeProvider value="dark">
      <main>
        <h1>customer-react-router</h1>
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
