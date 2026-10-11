import type { GenerateOptions } from '../core/index.js';

/**
 * Options of `stuntDoubleBun()`. All optional; any stunt-double.config.json key (overridesDir, outDir, map, ...)
 * may be given here and wins over the file. An unknown option is a [CFG] error, never silently ignored.
 */
export interface StuntDoubleBunOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate at every build start. Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit (turns on `metafile`). Default true. */
  audit?: boolean;
}

/** Bun bundler plugin, typed structurally so it does not depend on a particular bun-types version. */
export interface StuntDoubleBunPlugin {
  name: 'stunt-double';
  setup(build: any): void;
}

/**
 * The Bun.build() plugin: validates overrides and runs the contract type check at every build start (a mistake
 * makes Bun.build() fail), and answers @acme/core-slots/* with the generated shims. Bun's runtime and dev server
 * cannot use it (runtime plugins never see bare specifiers): use the universal tier there.
 */
export declare function stuntDoubleBun(options?: StuntDoubleBunOptions): StuntDoubleBunPlugin;
export default stuntDoubleBun;
