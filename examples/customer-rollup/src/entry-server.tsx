import { renderToString } from 'react-dom/server';
import { App } from './App';

/** SSR entry: rollup.config.mjs bundles @acme/core (and so the overrides) for Node. */
export function render(): string {
  return renderToString(<App />);
}
