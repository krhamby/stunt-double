import type { GenerateOptions, Project } from '../core/index.js';

export interface StuntDoubleMetroOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /**
   * Run the contract type gate (tsc on src/stunt-double.check.ts) while the config loads.
   * "auto" (default): only in one-shot bundle commands (`metro build`, `react-native bundle`, `expo export`,
   * `expo export:embed`); async and non-blocking in the dev server. true: always, blocking (use it with Metro's
   * JS API, where no CLI command is visible). false: never (then chain `stunt-double check &&`).
   */
  typecheck?: 'auto' | boolean;
  /** Audit the bundled module graph (F6 bypass, socket resolved elsewhere, F8 duplicates). Default true. */
  audit?: boolean;
  /**
   * What is loading the config. Default: detected from process.argv ("build" for build / bundle / export,
   * "serve" for start / serve / run-*, otherwise "unknown", which behaves like "build" except for "auto" typecheck).
   * "serve" poisons the shims instead of throwing, so the dev server starts and shows the error per request.
   */
  command?: 'build' | 'serve' | 'unknown';
}

/**
 * The parts of a Metro config the adapter reads or extends. Structural, so it does not depend on a particular
 * metro-config version's types: the result is assignable wherever the input was.
 */
export interface MetroConfigLike {
  projectRoot?: string;
  resolver?: {
    resolveRequest?: ((context: any, moduleName: string, platform: string | null) => any) | null;
    [key: string]: unknown;
  };
  serializer?: {
    experimentalSerializerHook?: (graph: any, delta: any) => unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Wrap a Metro config: `module.exports = withStuntDouble(getDefaultConfig(__dirname))`. Accepts a promised config too. */
export declare function withStuntDouble<C extends MetroConfigLike>(config: C, opts?: StuntDoubleMetroOptions): C;
export declare function withStuntDouble<C extends MetroConfigLike>(config: Promise<C>, opts?: StuntDoubleMetroOptions): Promise<C>;

/** Which CLI command is loading the config (from process.argv). */
export declare function detectCommand(argv?: string[]): 'build' | 'serve' | 'unknown';
/** The type gate, synchronously. */
export declare function runTypeGateSync(p: Project): { ok: boolean; ms?: number; version?: string; message?: string };
/** Metro graph -> the core audit's [{ id, importers }]. */
export declare function metroGraph(graph: { dependencies: Map<string, { inverseDependencies: Iterable<string> }> }): Array<{ id: string; importers: string[] }>;
export default withStuntDouble;
