import { renderToString } from 'react-dom/server';
import { App } from './App';

/** SSR entry: `vite build --ssr src/entry-server.tsx` bundles @acme/core (and so the overrides) for Node. */
export function render(): string {
  return renderToString(<App />);
}
