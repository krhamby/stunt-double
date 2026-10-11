import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from '@jest/globals';
import { render } from '@testing-library/react';
import { App } from '../App';

// jsdom (the default environment in jest.config.mjs): a real DOM render through @testing-library/react. Jest
// loads jest.config.mjs, so withStuntDouble() maps @acme/core-slots/* (imported by the @acme/core barrel AND by
// its internal <Checkout>) to the project's generated shims. The HTML is written for probes/render.mjs.
it('renders the app in jsdom', () => {
  const { container } = render(<App />);
  expect(container.querySelector('[data-probe="sdk"]')).not.toBeNull();
  fs.mkdirSync(path.resolve('dist'), { recursive: true });
  fs.writeFileSync(path.resolve('dist/render.dom.html'), container.innerHTML);
});
