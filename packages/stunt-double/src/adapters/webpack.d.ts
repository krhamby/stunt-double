import type { GenerateOptions } from '../core/index.js';

export interface StuntDoubleWebpackOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate in production builds. Default true. */
  typecheck?: boolean;
  /** Run the post-bundle module-graph audit. Default true. */
  audit?: boolean;
  /** Override the compiler mode used to decide whether the type gate runs ("production" runs it). */
  mode?: 'production' | 'development' | 'none' | string;
}

/** Add the stunt-double alias, exportsPresence 'error' and the validation plugin to a webpack 5 / Rspack 2 config (mutates and returns it). */
export declare function withStuntDouble<C extends object>(config?: C, opts?: StuntDoubleWebpackOptions): C;

export declare class StuntDoublePlugin {
  constructor(p: unknown, opts?: StuntDoubleWebpackOptions);
  apply(compiler: unknown): void;
}

export default withStuntDouble;
