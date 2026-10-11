import type { GenerateOptions } from '../core/index.js';

export interface StuntDoubleParcelOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Project root. Default process.cwd(); pass `import.meta.dirname` from the local plugin file. */
  root?: string;
  /** Run the contract type gate inside Parcel (build and serve). Default true. */
  typecheck?: boolean;
}

/**
 * A Parcel 2 resolver plugin instance (what `new Resolver({...})` from @parcel/plugin returns), typed
 * structurally so stunt-double does not depend on @parcel/plugin. Export it as the default export of a local
 * file listed in .parcelrc "resolvers" (Parcel rejects "stunt-double/parcel" as a plugin name).
 */
export interface StuntDoubleParcelResolver {
  readonly [key: symbol]: unknown;
}

export declare function stuntDouble(opts?: StuntDoubleParcelOptions): StuntDoubleParcelResolver;
export default stuntDouble;
