import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { App } from '../App';

// bun test runs WITHOUT a bundler plugin: the Bun runtime resolves '@acme/core-slots/*' from inside
// node_modules/@acme/core through the "workspace:*" link (sdk-slots/ -> gen/*.jsx). `stunt-double check &&`
// in the "test" script supplies validation (bun test has no STA / type gate of its own).
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
});
