import fs from 'node:fs';
import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../App';

// Project "jsdom": a real DOM render through @testing-library/react. The HTML is written for probes/render.mjs.
it('renders the app in jsdom', () => {
  const { container } = render(<App />);
  expect(container.querySelector('[data-probe="sdk"]')).not.toBeNull();
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/render.dom.html', container.innerHTML);
});
