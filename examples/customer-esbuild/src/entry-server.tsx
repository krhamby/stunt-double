import { renderToString } from 'react-dom/server';
import { App } from './App';

/** SSR entry: build.mjs bundles @acme/core (and so the overrides) for Node. */
export function render(): string {
  return renderToString(<App />);
}
