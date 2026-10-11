// stunt-double/parcel: a Parcel 2 resolver plugin. Parcel accepts resolver packages named parcel-resolver-* or a
// local file, so the project adds a one-line file and one .parcelrc entry:
//
//   parcel-resolver-stunt-double.mjs:  export { default } from 'stunt-double/parcel';
//   .parcelrc:                         { "extends": "@parcel/config-default",
//                                        "resolvers": ["./parcel-resolver-stunt-double.mjs", "..."] }
//
// What it does:
//   loadConfig  STA (generate into <root>/.stunt-double/) + CFG guards; in production builds also the TYP gate.
//               A problem throws the report, which fails `parcel build` (exit 1) and shows in `parcel serve`.
//               Parcel re-runs it when an override, the config or package.json changes, or a file appears in
//               the overrides directory.
//   resolve     @acme/core-slots/<Slot> -> <outDir>/gen/<Slot>.jsx (never Parcel `alias`: a typo'd alias key is
//               silently ignored)
// The SDK must be resolvable through its "exports" map: set "@parcel/resolver-default": { "packageExports": true }
// in package.json (an [F6] guard says so).
import fs from 'node:fs';
import path from 'node:path';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { formatReport, header } from '../core/diagnostics.mjs';
import { readJson } from '../core/util.mjs';

// @parcel/plugin's Resolver class only stores its options under this symbol; building the object directly keeps
// stunt-double free of a dependency on @parcel/plugin (which a strict package manager would not let it reach).
const PARCEL_PLUGIN_CONFIG = Symbol.for('parcel-plugin-config');

/** package.json settings under which Parcel could not resolve the SDK or would leave it to the runtime. */
function configGuards(root, p) {
  const out = [];
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  if (pkg['@parcel/resolver-default']?.packageExports !== true)
    out.push(`[F6] Parcel resolves ${p.sdk.name}'s subpaths (${p.sdk.originalSpecifier}<Slot>, ${p.sdk.name}/contracts) only through its "exports" map: add "@parcel/resolver-default": { "packageExports": true } to package.json.`);
  for (const [name, target] of Object.entries(pkg.targets ?? {})) {
    // Parcel bundles node_modules for browser targets and leaves them to the runtime for node targets by default
    const nodeLike = ['node', 'electron-main'].includes(target?.context);
    const inc = target?.includeNodeModules ?? !nodeLike;
    for (const n of p.packages) {
      const excluded = inc === false || (Array.isArray(inc) && !inc.includes(n)) || (inc && typeof inc === 'object' && !Array.isArray(inc) && inc[n] === false);
      if (excluded)
        out.push(`[F6] Parcel target "${name}" leaves ${n} to the runtime (includeNodeModules${target?.includeNodeModules === undefined ? ' defaults to false for node targets' : ''}): slot overrides could not apply there. Bundle it, e.g. "includeNodeModules": { "react": false, "react-dom": false } (unlisted packages are bundled).`);
    }
  }
  return out;
}

/** Parcel's reporter word-wraps diagnostics at the terminal width, splitting [Fx] lines: print the report verbatim too. */
function fail(message, lines) {
  process.stderr.write(`${message}\n`);
  throw new StuntDoubleError(message, lines);
}

/** @param {import('./parcel.d.ts').StuntDoubleParcelOptions} [opts] */
export function stuntDoubleParcel(opts = {}) {
  const { typecheck = true, ...genOpts } = opts ?? {};
  return {
    [PARCEL_PLUGIN_CONFIG]: {
      async loadConfig({ config, options }) {
        // the app: Parcel runs from it. (Its projectRoot is a monorepo's root, whose package.json has no SDK
        // dependency, and plugins are told nothing else: pass { root } to stuntDoubleParcel() otherwise.)
        const root = path.resolve(genOpts.root ?? process.cwd());
        const production = options.mode === 'production';
        const p = generate({ ...genOpts, root, onError: production ? 'return' : 'poison' });
        // re-run on: an override (or a file it imports), the config, package.json, a new file in the overrides dir
        for (const f of new Set([...p.implFiles, ...p.closureFiles, path.join(root, 'package.json'), p.configFile].filter(Boolean)))
          config.invalidateOnFileChange(f);
        config.invalidateOnFileCreate({ glob: `${p.overridesDir.split(path.sep).join('/')}/**/*` });
        if (fs.existsSync(path.join(root, 'stunt-double.config.json'))) config.invalidateOnFileChange(path.join(root, 'stunt-double.config.json'));
        const lines = [...p.problems, ...(p.sdk ? configGuards(root, p) : [])];
        if (lines.length) fail(formatReport(header(p, lines.length), lines), lines);
        if (production && typecheck !== false) {
          const r = await runTypeGate(p);
          if (!r.ok) fail(r.message, r.lines ?? []);
        }
        return { slotPackage: p.sdk.slotPackage, shims: Object.fromEntries(p.slots.map((s) => [s, p.shimFile(s)])) };
      },
      async resolve({ specifier, config }) {
        if (!config || !specifier.startsWith(`${config.slotPackage}/`)) return null;
        const file = config.shims[specifier.slice(config.slotPackage.length + 1)];
        return file ? { filePath: file } : null; // not a slot: the placeholder answers, the dist scan reports it
      },
    },
  };
}

export default stuntDoubleParcel();
