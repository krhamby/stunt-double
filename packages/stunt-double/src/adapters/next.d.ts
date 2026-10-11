import type { GenerateOptions } from '../core/index.js';

/**
 * Options of `withStuntDouble()` (Next.js 16). All optional; any stunt-double.config.json key (overridesDir,
 * outDir, map, ...) may be given here and wins over the file. An unknown option is a [CFG] error.
 */
export interface StuntDoubleNextOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate when `next build` loads the config. Default true. */
  typecheck?: boolean;
  /** Run the post-bundle graph audit in `--webpack` builds. Default true. */
  audit?: boolean;
}

/** Any Next config object (typed structurally: no dependency on next's types). */
export type NextConfigObject = Record<string, any>;
export type NextConfigFunction = (phase: string, ctx: { defaultConfig: NextConfigObject }) => NextConfigObject | Promise<NextConfigObject>;

/**
 * Wrap a Next.js 16 config (object or phase function). Returns an async phase function: `next build` validates
 * the overrides and runs the contract type check before compiling (a mistake fails the build), Turbopack and
 * webpack get one alias per slot to the generated shims, the SDK is added to transpilePackages, and `next dev`
 * regenerates the shims live when overrides change.
 */
export declare function withStuntDouble(nextConfig?: NextConfigObject | NextConfigFunction, options?: StuntDoubleNextOptions): NextConfigFunction;
export default withStuntDouble;
