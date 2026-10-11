import { renderToString } from 'react-dom/server';
import { App } from './App';

/** SSR entry: the rsbuild "node" environment bundles @acme/core (and so the overrides) for Node. */
export function render(): string {
  return renderToString(<App />);
}
