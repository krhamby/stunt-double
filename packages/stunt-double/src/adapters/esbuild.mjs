// stunt-double/esbuild: a native esbuild plugin (never unplugin's esbuild adapter: it drops errors and bundles
// overrides twice). esbuild's CLI cannot load JS plugins, so a project builds through the JS API:
//
//   import * as esbuild from 'esbuild';
//   import { stuntDoubleEsbuild } from 'stunt-double/esbuild';
//   await esbuild.build({ entryPoints: ['src/main.tsx'], bundle: true, plugins: [stuntDoubleEsbuild()] });
//
// What it does:
//   setup      STA (generate into <root>/.stunt-double/), metafile on (for AUD)
//   onStart    every build and every watch/serve rebuild: regenerate, STA problems + CFG guards -> errors,
//              then the TYP gate -> errors. esbuild reports them and build() rejects (exit 1).
//   onResolve  @acme/core-slots/<Slot> -> <outDir>/gen/<Slot>.jsx, watching the overrides directory so adding,
//              removing or editing an override triggers a rebuild in watch / serve mode
//   onEnd      AUD: post-bundle graph audit of the metafile -> errors
import path from 'node:path';
import { generate, regenerate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, esbuildGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { adapterOptions } from '../core/config.mjs';
import { esc } from '../core/util.mjs';

const PLUGIN = 'stunt-double';

/** esbuild "external" entries support one `*` wildcard. */
const externalMatches = (pattern, spec) => new RegExp(`^${String(pattern).split('*').map(esc).join('.*')}$`).test(spec);

/**
 * CFG guards (esbuild and Bun.build share these options): settings under which the SDK would not go through the
 * plugin, so slot overrides could not apply (it would load natively at runtime and hit the registry placeholder).
 */
export function externalGuards(tool, options, packages) {
  const out = [];
  for (const name of packages) {
    if (options?.packages === 'external')
      out.push(`[F6] ${tool} option packages: "external" leaves ${name} to the runtime: slot overrides could not apply there (it fails on the registry placeholder at startup). Bundle it: remove packages: "external", or list your other packages in "external" instead.`);
    const hit = (options?.external ?? []).find((x) => externalMatches(x, name) || externalMatches(x, `${name}/index`));
    if (hit) out.push(`[F6] ${tool} option external: "${hit}" leaves ${name} to the runtime: slot overrides could not apply there. Remove it from "external".`);
  }
  return out;
}

/** @param {import('./esbuild.d.ts').StuntDoubleEsbuildOptions} [opts] */
export function stuntDoubleEsbuild(opts = {}) {
  const { flags, genOpts } = adapterOptions('stuntDoubleEsbuild()', opts, { typecheck: true, audit: true });
  return {
    name: PLUGIN,
    setup(build) {
      const io = build.initialOptions;
      const root = path.resolve(genOpts.root ?? io.absWorkingDir ?? process.cwd());
      let p = generate({ ...genOpts, root, onError: 'return' });
      let fresh = true;
      if (flags.audit) io.metafile = true;
      const error = (text) => [{ text, pluginName: PLUGIN }];

      build.onStart(async () => {
        if (!fresh) p = regenerate(p); // watch / serve / context.rebuild(): regenerate, like every adapter start
        fresh = false;
        const lines = [...p.problems, ...(p.sdk ? externalGuards('esbuild', io, p.packages) : [])];
        if (lines.length) return { errors: error(formatProblems(p, lines)) };
        const warnings = p.warnings.length ? error(formatWarnings(p)) : [];
        if (flags.typecheck) {
          const r = await runTypeGate(p);
          if (!r.ok) return { errors: error(r.message), warnings };
        }
        return { warnings };
      });

      // Without a manifest there is no socket to answer: the build fails in onStart, and the socket itself
      // resolves to the registry placeholder (fail closed).
      if (!p.sdk) return;
      build.onResolve({ filter: new RegExp(`^${esc(p.sdk.slotPackage)}/[A-Za-z0-9_]+$`) }, (a) => {
        const shim = p.socketShim(a.path);
        if (!shim) return undefined; // not a slot: the placeholder answers, the dist scan reports it
        const watch = { watchDirs: [p.overridesDir], watchFiles: p.watchFiles };
        // onStart already failed this build with the report: keep esbuild from adding resolve errors of stale
        // shims to it (nothing is written; the next rebuild after the fix resolves normally)
        return p.problems.length ? { path: a.path, external: true, ...watch } : { path: shim, ...watch };
      });

      build.onEnd((result) => {
        if (!flags.audit || !p.sdk || result.errors.length || !result.metafile) return;
        const problems = auditGraph(p, esbuildGraph(result.metafile, io.absWorkingDir ?? process.cwd()));
        if (problems.length) return { errors: error(formatProblems(p, problems)) };
      });
    },
  };
}

export default stuntDoubleEsbuild;
