import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App';

// jsdom + @testing-library/react. Jest loads jest.config.mjs, so withStuntDouble() maps @acme/core-slots/*
// (imported by @acme/core's barrel AND by its internal <Checkout>) to the project's generated shims.
describe('stunt doubles on set (jsdom)', () => {
  const markers = (el: Element) =>
    [...el.querySelectorAll('[data-sd]')].map((n) => n.getAttribute('data-sd') + (n.hasAttribute('data-ctx') ? `(${n.getAttribute('data-ctx')})` : ''));

  it('the app-level <Button> from @acme/core is the brand override wrapping the SDK default', () => {
    const { container } = render(<App />);
    expect(markers(container.querySelector('[data-probe="app"]')!)).toEqual(['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)']);
  });

  it('overrides render INSIDE the SDK <Checkout>, with the SDK cart context intact', () => {
    const { container } = render(<App />);
    const sdk = markers(container.querySelector('[data-probe="sdk"]')!);
    expect(sdk.filter((m) => m === 'BRAND_BUTTON(dark)')).toHaveLength(3);
    expect(sdk.filter((m) => m === 'SDK_DEFAULT_BUTTON(in-cart)')).toHaveLength(3);
    expect(sdk.filter((m) => m === 'BRAND_PRICE')).toHaveLength(3);
    expect(sdk).toContain('BRAND_LOGO');
    expect(sdk).not.toContain('SDK_DEFAULT_PRICETAG');
  });

  it('the wrapped SDK button still works: clicking "Add to cart" updates the SDK cart', () => {
    render(<App />);
    expect(screen.getByText('1 in cart')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Add to cart')[1]!);
    expect(screen.getByText('2 in cart')).toBeTruthy();
  });
});
