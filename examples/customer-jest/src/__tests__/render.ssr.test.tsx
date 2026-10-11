/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from '@jest/globals';
import { renderToString } from 'react-dom/server';
import { App } from '../App';

// The node environment resolves the same shims: server rendering gets the same stunt doubles.
it('renders the app on the server', () => {
  const html = renderToString(<App />);
  expect(html).toContain('data-probe="sdk"');
  fs.mkdirSync(path.resolve('dist'), { recursive: true });
  fs.writeFileSync(path.resolve('dist/render.ssr.html'), html);
});
