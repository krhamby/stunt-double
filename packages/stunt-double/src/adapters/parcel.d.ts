import type { GenerateOptions } from '../core/index.js';

/**
 * Options of `stuntDoubleParcel()`. All optional; any stunt-double.config.json key (overridesDir, outDir, map, ...)
 * may be given here and wins over the file.
 */
export interface StuntDoubleParcelOptions extends Omit<GenerateOptions, 'onError' | 'write'> {
  /** Run the contract type gate in production builds. Default true. */
  typecheck?: boolean;
}

/** A Parcel 2 resolver plugin object (what @parcel/plugin's `new Resolver(...)` produces). */
export type StuntDoubleParcelResolver = object;

/** Build a resolver with options; re-export it from a local `parcel-resolver-*.mjs` file. */
export declare function stuntDoubleParcel(options?: StuntDoubleParcelOptions): StuntDoubleParcelResolver;

/**
 * The resolver with default options. Parcel needs a `parcel-resolver-*` package or a local file, so add
 * `parcel-resolver-stunt-double.mjs` with `export { default } from 'stunt-double/parcel';` and list
 * `"./parcel-resolver-stunt-double.mjs"` before `"..."` in `.parcelrc` "resolvers".
 */
declare const resolver: StuntDoubleParcelResolver;
export default resolver;
