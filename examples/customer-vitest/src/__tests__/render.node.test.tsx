import fs from 'node:fs';
import { expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from '../App';

// Project "node": server rendering. vite.config.ts carries stuntDouble(), so Vitest aliases @acme/core-slots/*
// (imported by the @acme/core barrel AND by its internal <Checkout>) to the generated shims and inlines the SDK.
it('renders the app on the server', () => {
  const html = renderToString(<App />);
  expect(html).toContain('data-probe="sdk"');
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/render.node.html', html);
});
