import { describe, expect, it } from '@jest/globals';
import { renderToString } from 'react-dom/server';
import { analytics, formatPrice } from '@acme/core';
import { App } from '../App';

// Jest runs through jest.config.mjs, so withStuntDouble() wires the same shims as the build.
describe('stunt doubles on set', () => {
  const html = renderToString(<App />);
  const section = (name: string) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';

  it('the app-level <Button> from @acme/core is the brand override wrapping the SDK default', () => {
    expect(section('app')).toContain('data-sd="BRAND_BUTTON" data-ctx="dark"');
    expect(section('app')).toContain('data-sd="SDK_DEFAULT_BUTTON" data-ctx="none"');
  });

  it('overrides render INSIDE the SDK <Checkout>, with the SDK cart context intact', () => {
    const sdk = section('sdk');
    expect(sdk.match(/data-sd="BRAND_BUTTON" data-ctx="dark"/g)).toHaveLength(3);
    expect(sdk.match(/data-sd="SDK_DEFAULT_BUTTON" data-ctx="in-cart"/g)).toHaveLength(3);
    expect(sdk.match(/data-sd="BRAND_PRICE"/g)).toHaveLength(3);
    expect(sdk).toContain('data-sd="BRAND_LOGO"');
  });

  it('the replaced PriceTag default never renders', () => {
    expect(html).not.toContain('SDK_DEFAULT_PRICETAG');
  });

  it('value slots: the SDK total uses the project formatPrice; app code gets the project services too', () => {
    expect(section('sdk')).toContain('data-sd="SDK_TOTAL" data-ctx="USD 19.99"');
    expect(formatPrice(9.5)).toBe('USD 9.50');
    expect(analytics.id).toBe('BRAND_ANALYTICS');
  });
});
