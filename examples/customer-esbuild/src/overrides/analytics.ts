import type { Analytics } from '@acme/core';

/**
 * Stunt double for the "analytics" VALUE slot: a service object, the Swinject-style registration of a protocol
 * implementation. Every event the SDK reports (ProductCard's add_to_cart, ...) lands here instead of the SDK's
 * no-op default, which is then absent from the bundle.
 */
class BrandAnalytics implements Analytics {
  readonly id = 'BRAND_ANALYTICS';
  readonly events: Array<{ event: string; data?: Record<string, unknown> }> = [];

  track(event: string, data?: Record<string, unknown>) {
    this.events.push({ event, data });
  }
}

export const analytics = new BrandAnalytics();
