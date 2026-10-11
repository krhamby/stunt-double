import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from '../App';

// Project "node": server rendering through the same shims.
describe('stunt doubles on set (node)', () => {
  const html = renderToString(<App />);
  const section = (name: string) => html.split(`data-probe="${name}"`)[1]?.split('</section>')[0] ?? '';

  it('the app-level <Button> is the brand override wrapping the SDK default', () => {
    expect(section('app')).toContain('data-sd="BRAND_BUTTON" data-ctx="dark"');
    expect(section('app')).toContain('data-sd="SDK_DEFAULT_BUTTON" data-ctx="none"');
  });

  it('overrides render INSIDE the SDK <Checkout>, and the replaced PriceTag default never renders', () => {
    const sdk = section('sdk');
    expect(sdk.match(/data-sd="BRAND_BUTTON" data-ctx="dark"/g)).toHaveLength(3);
    expect(sdk.match(/data-sd="SDK_DEFAULT_BUTTON" data-ctx="in-cart"/g)).toHaveLength(3);
    expect(sdk.match(/data-sd="BRAND_PRICE"/g)).toHaveLength(3);
    expect(sdk).toContain('data-sd="BRAND_LOGO"');
    expect(html).not.toContain('SDK_DEFAULT_PRICETAG');
  });
});
