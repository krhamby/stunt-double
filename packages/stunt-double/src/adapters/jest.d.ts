import type { GenerateOptions } from '../core/index.js';

/**
 * Options of `withStuntDouble()` (Jest 30). All optional; any stunt-double.config.json key (overridesDir, outDir,
 * map, ...) may be given here and wins over the file. An unknown option is a [CFG] error.
 */
export interface StuntDoubleJestOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /**
   * Also run the contract type gate when Jest loads the config. Default false: babel-jest and @swc/jest do not
   * type-check, and the build or `stunt-double check` in CI is the gate.
   */
  typecheck?: boolean;
}

/** Any Jest config object (typed structurally: no dependency on Jest's types). */
export type JestConfigObject = Record<string, any>;

/**
 * Wrap a Jest 30 config (object or function). Returns an async config function: Jest refuses to start on any
 * injection mistake, maps @acme/core-slots/* to the generated shims, and transforms the ESM SDK.
 */
export declare function withStuntDouble(config?: JestConfigObject | ((...args: any[]) => JestConfigObject | Promise<JestConfigObject>), options?: StuntDoubleJestOptions): () => Promise<JestConfigObject>;
export default withStuntDouble;
