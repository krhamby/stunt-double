// Types for stunt-double/next.
import type { GenerateOptions } from '../core/index.d.ts';

export interface StuntDoubleNextOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** `next build`: run the slot contract type gate (src/stunt-double.check.ts) after compiling. Default true. */
  typecheck?: boolean;
  /** `next build --webpack`: post-bundle module-graph audit (F6/F8) through compilation.errors. Default true. */
  audit?: boolean;
}

/**
 * Wrap a Next.js 16 config (object or `(phase, ctx) => config` function). Generates shims at config load and
 * throws on any injection mistake, so `next build` and `next dev` fail to start; adds `transpilePackages`, the
 * Turbopack `resolveAlias` and the webpack wiring. `next build` type-checks src/stunt-double.check.ts natively.
 */
export declare function withStuntDouble<T>(nextConfig?: T, opts?: StuntDoubleNextOptions): T;
export default withStuntDouble;
