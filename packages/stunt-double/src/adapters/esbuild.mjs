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
import { generate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, esbuildGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings, formatReport, header } from '../core/diagnostics.mjs';
import { DEFAULTS } from '../core/config.mjs';
import { esc } from '../core/util.mjs';

const PLUGIN = 'stunt-double';
const PLUGIN_OPTIONS = new Set(['typecheck', 'audit', 'root', 'configFile', ...Object.keys(DEFAULTS)]);

/** esbuild "external" entries support one `*` wildcard. */
const externalMatches = (pattern, spec) => new RegExp(`^${String(pattern).split('*').map(esc).join('.*')}$`).test(spec);

/**
 * CFG guards: build options under which the SDK would not go through this plugin, so slot overrides could not
 * apply (it would load natively at runtime and hit the registry placeholder, or worse, a stale copy).
 */
function configGuards(io, p) {
  const out = [];
  for (const name of p.packages) {
    if (io.packages === 'external')
      out.push(`[F6] esbuild option packages: "external" leaves ${name} to the runtime: slot overrides could not apply there (it fails on the registry placeholder at startup). Bundle it: remove packages: "external", or list your other packages in "external" instead.`);
    const hit = (io.external ?? []).find((x) => externalMatches(x, name) || externalMatches(x, `${name}/index`));
    if (hit) out.push(`[F6] esbuild option external: "${hit}" leaves ${name} to the runtime: slot overrides could not apply there. Remove it from "external".`);
  }
  return [...new Set(out)];
}

/** @param {import('./esbuild.d.ts').StuntDoubleEsbuildOptions} [opts] */
export function stuntDoubleEsbuild(opts = {}) {
  const { typecheck = true, audit = true, ...genOpts } = opts ?? {};
  const optionProblems = Object.keys(opts ?? {}).filter((k) => !PLUGIN_OPTIONS.has(k))
    .map((k) => `[CFG] unknown stuntDoubleEsbuild() option "${k}". Known options: ${[...PLUGIN_OPTIONS].join(', ')}.`);
  return {
    name: PLUGIN,
    setup(build) {
      const io = build.initialOptions;
      const root = path.resolve(opts?.root ?? io.absWorkingDir ?? process.cwd());
      const load = () => generate({ ...genOpts, root, onError: 'return' });
      let p = load();
      let fresh = true;
      if (audit !== false) io.metafile = true;
      const errors = (lines) => ({ errors: [{ text: formatReport(header(p, lines.length), lines), pluginName: PLUGIN }] });

      build.onStart(async () => {
        if (!fresh) p = load(); // watch / serve / context.rebuild(): regenerate, like every adapter start
        fresh = false;
        const lines = [...optionProblems, ...p.problems, ...(p.sdk ? configGuards(io, p) : [])];
        if (lines.length) return errors(lines);
        const warnings = p.warnings.length ? [{ text: formatWarnings(p), pluginName: PLUGIN }] : [];
        if (typecheck !== false) {
          const r = await runTypeGate(p);
          if (!r.ok) return { errors: [{ text: r.message, pluginName: PLUGIN }], warnings };
        }
        return { warnings };
      });

      // Without a manifest there is no socket to answer: the build fails in onStart, and the socket itself
      // resolves to the registry placeholder (fail closed).
      if (!p.sdk) return;
      const slotPackage = p.sdk.slotPackage;
      const watch = { watchDirs: [p.overridesDir], watchFiles: [p.configFile, path.join(root, 'package.json')].filter(Boolean) };
      build.onResolve({ filter: new RegExp(`^${esc(slotPackage)}/[A-Za-z0-9_]+$`) }, (a) => {
        const slot = a.path.slice(slotPackage.length + 1);
        if (!p.sdk?.slots[slot]) return undefined; // not a slot: the placeholder answers, the dist scan reports it
        // onStart already failed this build with the report: keep esbuild from adding resolve errors of stale
        // shims to it (nothing is written; the next rebuild after the fix resolves normally)
        if (p.problems.length) return { path: a.path, external: true, ...watch };
        return {
          path: p.shimFile(slot),
          ...watch,
        };
      });

      build.onEnd((result) => {
        if (audit === false || !p?.sdk || result.errors.length || !result.metafile) return;
        const problems = auditGraph(p, esbuildGraph(result.metafile, io.absWorkingDir ?? process.cwd()));
        if (problems.length) return { errors: [{ text: formatProblems(p, problems), pluginName: PLUGIN }] };
      });
    },
  };
}

export default stuntDoubleEsbuild;
