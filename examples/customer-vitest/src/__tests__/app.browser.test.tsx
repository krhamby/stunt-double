import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App';

// Browser mode (vitest.browser.config.ts, real Chromium): the overrides render app-level and inside the SDK,
// and the wrapped SDK button still drives the SDK cart.
afterEach(cleanup);

const markers = (el: Element) =>
  [...el.querySelectorAll('[data-sd]')].map((n) => n.getAttribute('data-sd') + (n.hasAttribute('data-ctx') ? `(${n.getAttribute('data-ctx')})` : ''));

describe('stunt doubles on set (Chromium)', () => {
  it('app-level and SDK-internal positions render the overrides', () => {
    const { container } = render(<App />);
    expect(markers(container.querySelector('[data-probe="app"]')!)).toEqual(['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)']);
    const sdk = markers(container.querySelector('[data-probe="sdk"]')!);
    expect(sdk.filter((m) => m === 'BRAND_BUTTON(dark)')).toHaveLength(3);
    expect(sdk.filter((m) => m === 'SDK_DEFAULT_BUTTON(in-cart)')).toHaveLength(3);
    expect(sdk.filter((m) => m === 'BRAND_PRICE')).toHaveLength(3);
    expect(sdk).toContain('BRAND_LOGO');
    expect(sdk).not.toContain('SDK_DEFAULT_PRICETAG');
  });

  it('the wrapped SDK button still drives the SDK cart', () => {
    render(<App />);
    expect(screen.getByText('1 in cart')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Add to cart')[1]!);
    expect(screen.getByText('2 in cart')).toBeTruthy();
  });
});
