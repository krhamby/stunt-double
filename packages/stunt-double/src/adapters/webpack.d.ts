import type { GenerateOptions, Project } from '../core/index.js';

/**
 * Options of `withStuntDouble()` (webpack 5 / Rspack 2). All optional; any stunt-double.config.json key
 * (overridesDir, outDir, map, ...) may be given here and wins over the file. An unknown option is a [CFG] error.
 */
export interface StuntDoubleWebpackOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate in production compilations. Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit. Default true. */
  audit?: boolean;
  /** Treat compilations as this mode (default: the compiler's `mode`). The gate runs in 'production'. */
  mode?: 'production' | 'development' | 'none';
}

/** Any webpack / Rspack configuration object (typed structurally: no dependency on webpack's types). */
export type WebpackConfig = Record<string, any>;

/**
 * Wrap a webpack 5 / Rspack 2 configuration: an object, an array (multi-compiler), or a function of
 * (env, argv). Adds one exact-match alias per slot, `exportsPresence: 'error'`, the cache fingerprint, and the
 * StuntDoublePlugin (validation, type gate and audit as compilation errors).
 */
export declare function withStuntDouble<C extends WebpackConfig | WebpackConfig[] | ((...args: any[]) => any)>(config?: C, options?: StuntDoubleWebpackOptions): C extends (...args: any[]) => any ? (...args: Parameters<C>) => Promise<WebpackConfig | WebpackConfig[]> : C;
export default withStuntDouble;

/** The plugin withStuntDouble() adds. Use it directly only if you manage the slot aliases yourself. */
export declare class StuntDoublePlugin {
  constructor(project: Project, options?: { typecheck?: boolean; audit?: boolean; mode?: string; problems?: string[]; generate?: Partial<GenerateOptions> });
  p: Project;
  apply(compiler: any): void;
}
