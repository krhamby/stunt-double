import type { GenerateOptions } from '../core/index.js';

export interface StuntDoubleBunOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate before every Bun.build (onStart). Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit on the metafile (onEnd; forces `metafile: true`). Default true. */
  audit?: boolean;
}

/**
 * Bun 1.4 bundler plugin for `Bun.build({ plugins: [stuntDoubleBun()] })`. Typed structurally so it does not
 * depend on bun-types: it is assignable to `Bun.BunPlugin`. Any injection error rejects the Bun.build() promise.
 * Not for `Bun.plugin()` / bunfig preload (the runtime and `bun test` resolve sockets through the link instead).
 */
export interface StuntDoubleBunPlugin {
  name: 'stunt-double';
  setup(build: any): void;
}

export declare function stuntDoubleBun(opts?: StuntDoubleBunOptions): StuntDoubleBunPlugin;
/** Bun metafile (paths relative to `cwd`) -> the audit graph. */
export declare function bunGraph(metafile: { inputs: Record<string, { imports?: Array<{ path: string; external?: boolean }> }> }, cwd: string): Array<{ id: string; importers: string[] }>;
export default stuntDoubleBun;
