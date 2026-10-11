import type { GenerateOptions } from '../core/index.js';

/**
 * Options of `stuntDoubleEsbuild()`. All optional; any stunt-double.config.json key (overridesDir, outDir, map, ...)
 * may be given here and wins over the file. An unknown option is a [CFG] error, never silently ignored.
 */
export interface StuntDoubleEsbuildOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate at every build start. Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit (turns on `metafile`). Default true. */
  audit?: boolean;
}

/** esbuild plugin, typed structurally so it does not depend on a particular esbuild version's types. */
export interface StuntDoubleEsbuildPlugin {
  name: 'stunt-double';
  setup(build: any): void;
}

/**
 * The esbuild plugin: validates overrides at every build start (and every watch / serve rebuild), answers
 * @acme/core-slots/* with the generated shims, runs the contract type check and the post-bundle audit. Any
 * injection mistake makes `build()` reject. esbuild's CLI cannot load plugins: build through the JS API.
 */
export declare function stuntDoubleEsbuild(options?: StuntDoubleEsbuildOptions): StuntDoubleEsbuildPlugin;
export default stuntDoubleEsbuild;
