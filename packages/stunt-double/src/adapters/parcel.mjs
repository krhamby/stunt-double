// stunt-double/parcel: the Parcel 2.16 resolver plugin, the default Parcel setup. It resolves every
// '<slotPackage>/<Slot>' import to the generated shim (no link needed) and runs STA and the type gate INSIDE
// `parcel build` / `parcel serve`. Without it, Parcel needs the universal tier (`init --universal` link +
// `stunt-double check && parcel build`).
//
// .parcelrc only accepts plugin names "parcel-resolver-*", "@scope/parcel-resolver[-*]" or relative paths
// (@parcel/core ParcelConfig.schema.js validatePackageName), so "stunt-double/parcel" cannot be listed there
// directly. The project adds a two-line local file and lists that (docs/tools/parcel.md):
//
//   // parcel-resolver-stunt-double.cjs   (CommonJS: an .mjs plugin makes Parcel warn on every build)
//   const { stuntDouble } = require('stunt-double/parcel');
//   module.exports = stuntDouble({ root: __dirname });
//
//   // .parcelrc
//   { "extends": "@parcel/config-default", "resolvers": ["./parcel-resolver-stunt-double.cjs", "..."] }
//
// What it does:
//   loadConfig  STA (generate) + [CFG] package exports on, then the TYP gate (awaited). An error fails
//               `parcel build` (thrown here) or shows on the `parcel serve` error page (thrown from resolve).
//               Invalidations: startup, the overrides dir (create), every file in it and mapped
//               implementations, config files and the SDK manifest (change/delete)
//   resolve     '<slotPackage>/<Slot>' -> p.shimFile(Slot), content-addressed (unknown slots fall through to
//               the default resolver: the registry placeholder or the link, never an SDK default)
// Never uses Parcel `alias`: a typo'd alias key is silently ignored.
import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';

// The same symbol @parcel/plugin's Resolver class sets: no dependency on @parcel/plugin needed.
const PARCEL_PLUGIN = Symbol.for('parcel-plugin-config');

// Parcel prints `error.codeFrame ?? error.stack` under the message (@parcel/diagnostic errorToDiagnostic): an
// empty code frame keeps the output to the [Fx] lines instead of a stack trace into Parcel internals.
const fail = (message) => Object.assign(new Error(message), { name: 'StuntDoubleError', codeFrame: '' });

function listFiles(dir) {
  try {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.join(d.parentPath, d.name));
  } catch { return []; }
}

/** @param {import('./parcel.d.ts').StuntDoubleParcelOptions} [opts] */
export function stuntDouble(opts = {}) {
  const { typecheck = true, ...genOpts } = opts;
  return {
    [PARCEL_PLUGIN]: {
      async loadConfig({ config, options, logger }) {
        const root = path.resolve(opts.root ?? process.cwd());
        // Rerun at every Parcel start: the persistent .parcel-cache must never replay an old decision.
        config.invalidateOnStartup();
        const p = generate({ ...genOpts, root, onError: 'return' });
        // Globs must be relative to Parcel's projectRoot: Config.invalidateOnFileCreate stores them verbatim
        // (only filePath entries are converted) and an absolute glob never matches (verified, Parcel 2.16.4).
        config.invalidateOnFileCreate({ glob: `${path.relative(options.projectRoot, p.overridesDir).split(path.sep).join('/')}/**/*` });
        config.invalidateOnFileChange(path.join(root, 'package.json'));
        if (p.configFile) config.invalidateOnFileChange(p.configFile);
        else config.invalidateOnFileCreate({ filePath: path.join(root, 'stunt-double.config.json') });
        if (p.sdk) config.invalidateOnFileChange(p.sdk.manifestFile);
        // change = edit or delete: every file under the overrides dir (stray ones too, so deleting a typo'd
        // Buton.tsx clears the error in `parcel serve`) and implementations mapped from elsewhere.
        for (const f of new Set([...listFiles(p.overridesDir), ...p.implFiles])) config.invalidateOnFileChange(f);
        // Dev (serve / watch): Parcel records a config's invalidations only when loadConfig RETURNS (verified,
        // Parcel 2.16.4: after a throw, neither fixing nor deleting the file triggers a rebuild until restart).
        // So in dev the error travels in the result and resolve() throws it for every socket import instead.
        const dev = options.hmrOptions != null || options.serveOptions !== false;
        // CFG: '<sdk>/original/*' (wrapping a default) and every exports-only subpath need package exports, which
        // Parcel 2.16 leaves off. Same lookup as @parcel/resolver-default (the package.json at Parcel's project
        // root: the nearest directory with a lockfile or .git), so this sees exactly what the resolver will.
        const exp = await config.getConfig([], { packageKey: '@parcel/resolver-default' });
        if (p.sdk && exp?.contents?.packageExports !== true)
          p.problems.push(`[CFG] Parcel resolves without package "exports", so "${p.sdk.originalSpecifier}*" cannot resolve: add "@parcel/resolver-default": { "packageExports": true } to ${path.join(options.projectRoot, 'package.json')} (Parcel's project root: the nearest directory with a lockfile or .git).`);
        let error = null;
        if (p.problems.length) error = formatProblems(p);
        else if (typecheck !== false) {
          // force: the memo key ignores override CONTENTS, and loadConfig only reruns when something changed.
          const r = await runTypeGate(p, { force: true });
          if (!r.ok) error = r.message;
        }
        if (error && (!dev || !p.sdk)) throw fail(error);
        if (p.warnings.length) logger.warn({ message: formatWarnings(p) });
        // Parcel serializes the config result into its cache: plain data only.
        return {
          slotPackage: p.sdk.slotPackage,
          shims: Object.fromEntries(p.slots.map((s) => [s, p.shimFile(s)])),
          fingerprint: p.fingerprint,
          error,
        };
      },

      resolve({ specifier, config }) {
        if (!config || !specifier.startsWith(config.slotPackage + '/')) return null;
        if (config.error) throw fail(config.error);
        const file = config.shims[specifier.slice(config.slotPackage.length + 1)];
        if (!file) return null;
        // Pass the shim text as `code`: Parcel's asset id hashes it, so a regenerated shim is a new asset. With
        // filePath alone, a warm .parcel-cache replays the PREVIOUS shim (generate rewrites it mid-build, after
        // Parcel has diffed the file system), i.e. the previous override decision.
        let code;
        try { code = fs.readFileSync(file, 'utf8'); } catch { return null; }
        return { filePath: file, code, invalidateOnFileChange: [file] };
      },
    },
  };
}

export default stuntDouble;
