import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { App } from '../App';

// bunfig.toml preloads stunt-double/bun-test: it validates the overrides (STA + type gate; an injection error
// fails `bun test` with the [Fx] lines) and points @acme/core's socket imports at the generated shims.
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
