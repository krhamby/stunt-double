'use client';
import { useState } from 'react';
import { Button } from '@acme/core';
import { ThemeProvider } from '../../theme';

// A CLIENT page: the app-level Button (the stunt double) with an interactive handler.
export default function ClientPage() {
  const [clicks, setClicks] = useState(0);
  return (
    <ThemeProvider value="light">
      <main>
        <h1>customer-next (App Router, client page)</h1>
        <section data-probe="app">
          <Button variant="primary" onClick={() => setClicks((n) => n + 1)}>
            Clicked <span data-probe="clicks">{clicks}</span>
          </Button>
        </section>
      </main>
    </ThemeProvider>
  );
}
