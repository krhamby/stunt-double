import { Button, Checkout } from '@acme/core';
import { products } from '../products';
import { ThemeProvider } from '../theme';

// A SERVER Component. It imports the SDK barrel and renders the app's own <Button> and the SDK's <Checkout>;
// both reach the stunt doubles. The overrides need no "use client" of their own: the generated shims carry it.
export default function Home() {
  return (
    <ThemeProvider value="dark">
      <main>
        <h1>customer-next (App Router, Server Component)</h1>
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
