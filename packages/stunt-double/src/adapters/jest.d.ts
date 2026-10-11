import type { GenerateOptions } from '../core/index.js';

export interface StuntDoubleJestOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /**
   * Also run the contract type gate (src/stunt-double.check.ts) at config load. withStuntDouble() then returns
   * a Promise of the config (Jest accepts that) and `jest` exits 1 on [F1]/[F9]. Default false: CI runs
   * `stunt-double check` (or `tsc`) instead, because babel-jest and @swc/jest never type-check.
   */
  typecheck?: boolean;
  /** Add the watch plugin that regenerates shims during `jest --watch`. Default true. */
  watch?: boolean;
}

/** The parts of a Jest config stunt-double reads and writes (typed loosely so any Jest version's Config fits). */
export interface JestConfigLike {
  rootDir?: string;
  moduleNameMapper?: Record<string, string | string[]>;
  transformIgnorePatterns?: string[];
  watchPlugins?: Array<string | [string, Record<string, unknown>]>;
  [key: string]: unknown;
}

/** Validates the overrides at config load (throws on any injection error) and maps the SDK's slot sockets to the generated shims. */
export declare function withStuntDouble<C extends JestConfigLike>(config: C, opts: StuntDoubleJestOptions & { typecheck: true }): Promise<C & JestConfigLike>;
export declare function withStuntDouble<C extends JestConfigLike>(config?: C, opts?: StuntDoubleJestOptions): C & JestConfigLike;
/** The default transformIgnorePatterns: everything in node_modules except the SDK (and layers), pnpm layout included. */
export declare function transformIgnorePatternsFor(packages: string[]): string[];
export default withStuntDouble;
