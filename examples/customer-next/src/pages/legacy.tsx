import { Button, Checkout } from '@acme/core';
import { products } from '../products';
import { ThemeProvider } from '../theme';

// A PAGES ROUTER page. Next would externalize node_modules here (Node would load @acme/core natively and the
// slots could not be redirected); withStuntDouble() adds the SDK to transpilePackages so they are.
export default function Legacy() {
  return (
    <ThemeProvider value="dark">
      <main>
        <h1>customer-next (Pages Router)</h1>
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
