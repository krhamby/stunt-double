import type { GenerateOptions } from '../core/index.js';

export interface StuntDoubleEsbuildOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate in onStart. Default true. */
  typecheck?: boolean;
  /** Run the post-bundle metafile audit in onEnd. Default true. */
  audit?: boolean;
}

/** Structurally an esbuild `Plugin` (no dependency on a particular esbuild version's types). */
export interface StuntDoubleEsbuildPlugin {
  name: 'stunt-double';
  setup(build: any): void;
}

/** esbuild 0.28 plugin: STA + type gate in onStart, the socket mapping in onResolve, the audit in onEnd. */
export declare function stuntDoubleEsbuild(opts?: StuntDoubleEsbuildOptions): StuntDoubleEsbuildPlugin;
/** `alias` entries only (no validation, no gate, no audit). Chain `stunt-double check &&` in the script. */
export declare function stuntDoubleAlias(opts?: StuntDoubleEsbuildOptions): Record<string, string>;
export default stuntDoubleEsbuild;
