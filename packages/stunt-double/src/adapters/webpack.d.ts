import type { GenerateOptions } from '../core/index.js';

/**
 * Options of `withStuntDouble()` (webpack 5 / Rspack 2). All optional; any stunt-double.config.json key
 * (overridesDir, outDir, map, ...) may be given here and wins over the file. An unknown option is a [CFG] error.
 */
export interface StuntDoubleWebpackOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate in production compilations. Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit. Default true. */
  audit?: boolean;
}

/** Any webpack / Rspack configuration object (typed structurally: no dependency on webpack's types). */
export type WebpackConfig = Record<string, any>;

/**
 * Wrap a webpack 5 / Rspack 2 configuration: an object, an array (multi-compiler), or a function of
 * (env, argv). Adds one exact-match alias per slot, `exportsPresence: 'error'`, the cache fingerprint, and a
 * plugin that reports validation, type gate and audit failures as compilation errors.
 */
export declare function withStuntDouble<C extends WebpackConfig | WebpackConfig[] | ((...args: any[]) => any)>(config?: C, options?: StuntDoubleWebpackOptions): C extends (...args: any[]) => any ? (...args: Parameters<C>) => Promise<WebpackConfig | WebpackConfig[]> : C;
export default withStuntDouble;

