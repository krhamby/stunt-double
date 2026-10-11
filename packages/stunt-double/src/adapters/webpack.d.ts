import type { GenerateOptions, Project } from '../core/index.d.ts';

export interface StuntDoubleWebpackOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /**
   * Run the contract type gate (.stunt-double/check.ts). Default true: every `webpack` / `rspack build` run,
   * and in watch / dev-server mode after each rebuild that touched an override, its imports or the check file.
   * 'build' = only in non-watch runs. false = never (then chain `stunt-double check &&`).
   */
  typecheck?: boolean | 'build';
  /** Post-bundle module-graph audit (F6 bypass / not-applied, F8 duplicate copies). Default true. */
  audit?: boolean;
  /** Accepted for craco's `configure: (c, { env }) => withStuntDouble(c, { mode: env })`; not needed. */
  mode?: string;
}

type ConfigLike = Record<string, any>;

/**
 * Wrap a webpack 5 / Rspack 2 configuration: exact aliases to the generated shims, exportsPresence 'error',
 * the generation fingerprint in the persistent cache version, and the StuntDoublePlugin. Accepts an object, an
 * array (multi-compiler), a promise, or a config function (returns a wrapped function).
 */
export declare function withStuntDouble<C extends ConfigLike | ConfigLike[]>(config: C, opts?: StuntDoubleWebpackOptions): C;
export declare function withStuntDouble<A extends unknown[], C>(config: (...args: A) => C, opts?: StuntDoubleWebpackOptions): (...args: A) => C;

/** The plugin that withStuntDouble() adds. Use it directly only if you install the aliases yourself. */
export declare class StuntDoublePlugin {
  constructor(p: Project, opts?: Pick<StuntDoubleWebpackOptions, 'typecheck' | 'audit'>);
  p: Project;
  apply(compiler: any): void;
}

export default withStuntDouble;
