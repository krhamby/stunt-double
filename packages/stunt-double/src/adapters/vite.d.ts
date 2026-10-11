import type { GenerateOptions } from '../core/index.js';

/**
 * Options of `stuntDouble()`. All optional; any stunt-double.config.json key (overridesDir, outDir, map, ...)
 * may be given here and wins over the file. An unknown option is a [CFG] error, never silently ignored.
 */
export interface StuntDoubleViteOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate in `vite build` (and asynchronously in dev). Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit in `vite build`. Default true. */
  audit?: boolean;
}

/**
 * Vite 8 / Vitest 5 plugin (also a Rollup / Rolldown plugin). Typed structurally so it does not depend on a
 * particular Vite version's types: it is assignable to Vite's `PluginOption`. Order in `plugins` does not matter.
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
