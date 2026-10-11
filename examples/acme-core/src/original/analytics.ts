import type { Analytics } from '../contracts.js';

/**
 * The SDK's default analytics service (a VALUE slot: an object with methods). It records nothing. Reachable ONLY
 * as '@acme/core/original/analytics'; SDK code calls the `@acme/core-slots/analytics` socket.
 */
export const analytics: Analytics = {
  id: 'SDK_DEFAULT_ANALYTICS',
  track() {},
};
