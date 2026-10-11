/**
 * @jest-environment node
 */
import { expect, it } from '@jest/globals';
import { renderToString } from 'react-dom/server';
import { App } from '../App';

// The node environment resolves the same shims: server rendering gets the same stunt doubles.
it('renders the overrides on the server, and never the replaced PriceTag default', () => {
  const html = renderToString(<App />);
  expect(html).toContain('data-sd="BRAND_BUTTON" data-ctx="dark"');
  expect(html.match(/data-sd="BRAND_PRICE"/g)).toHaveLength(3);
  expect(html).toContain('data-sd="BRAND_LOGO"');
  expect(html).not.toContain('SDK_DEFAULT_PRICETAG');
});
