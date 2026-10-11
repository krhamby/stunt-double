import { renderToString } from 'react-dom/server';
import { App } from './App';

/** SSR entry: farm.config.ssr.ts bundles @acme/core (and so the overrides) for Node. */
export function render(): string {
  return renderToString(<App />);
}
