import type { GenerateOptions } from '../core/index.js';

export interface StuntDoubleViteOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate in `vite build` (and asynchronously in dev). Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit in `vite build`. Default true. */
  audit?: boolean;
}

/**
 * Vite 8 / Vitest 5 plugin (also a Rollup / Rolldown plugin). Typed structurally so it does not depend on a
 * particular Vite version's types: it is assignable to Vite's `PluginOption`.
 */
export interface StuntDoublePlugin {
  name: 'stunt-double';
  enforce: 'pre';
  [hook: string]: unknown;
}

export declare function stuntDouble(opts?: StuntDoubleViteOptions): StuntDoublePlugin;
/** Alias entries only (no validation, no gate): for configs that cannot take plugins. Chain `stunt-double check &&`. */
export declare function stuntDoubleAlias(opts?: StuntDoubleViteOptions): Array<{ find: RegExp; replacement: string }>;
export default stuntDouble;
