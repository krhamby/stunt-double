// stunt-double/bun: a Bun 1.4 bundler plugin (Bun.build). Bun's runtime plugins never see bare specifiers, so
// this covers `Bun.build()` / `bun build` through a build script; run Bun's dev server or runtime on the
// universal tier (`stunt-double check &&`) instead.
//
//   import { stuntDoubleBun } from 'stunt-double/bun';
//   await Bun.build({ entrypoints: ['./src/main.tsx'], outdir: 'dist', plugins: [stuntDoubleBun()] });
//
// What it does:
//   setup      STA (generate into <root>/.stunt-double/)
//   onStart    every build: regenerate, STA problems + CFG guards, then the TYP gate. A problem throws the
//              report, which fails Bun.build() (exit 1); Bun reports a missing export only at runtime (R1), so
//              the static F5 check matters here
//   onResolve  @acme/core-slots/<Slot> -> <outDir>/gen/<Slot>.jsx
//   onEnd      AUD: post-bundle graph audit of the metafile (Bun writes esbuild's format) -> throws
import path from 'node:path';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, esbuildGraph } from '../core/audit.mjs';
import { formatProblems, formatReport, formatWarnings, header } from '../core/diagnostics.mjs';
import { DEFAULTS } from '../core/config.mjs';
import { esc } from '../core/util.mjs';

const PLUGIN = 'stunt-double';
const PLUGIN_OPTIONS = new Set(['typecheck', 'audit', 'root', 'configFile', ...Object.keys(DEFAULTS)]);

const externalMatches = (pattern, spec) => new RegExp(`^${String(pattern).split('*').map(esc).join('.*')}$`).test(spec);

/** Build options under which the SDK would load natively at runtime, where slot overrides cannot apply. */
function configGuards(config, p) {
  const out = [];
  for (const name of p.packages) {
    if (config?.packages === 'external')
      out.push(`[F6] Bun.build option packages: "external" leaves ${name} to the runtime: slot overrides could not apply there. Bundle it: list your other packages in "external" instead.`);
    const hit = (config?.external ?? []).find((x) => externalMatches(x, name));
    if (hit) out.push(`[F6] Bun.build option external: "${hit}" leaves ${name} to the runtime: slot overrides could not apply there. Remove it from "external".`);
  }
  return out;
}

/** @param {import('./bun.d.ts').StuntDoubleBunOptions} [opts] */
export function stuntDoubleBun(opts = {}) {
  const { typecheck = true, audit = true, ...genOpts } = opts ?? {};
  const optionProblems = Object.keys(opts ?? {}).filter((k) => !PLUGIN_OPTIONS.has(k))
    .map((k) => `[CFG] unknown stuntDoubleBun() option "${k}". Known options: ${[...PLUGIN_OPTIONS].join(', ')}.`);
  return {
    name: PLUGIN,
    setup(build) {
      const root = path.resolve(opts?.root ?? process.cwd());
      const load = () => generate({ ...genOpts, root, onError: 'return' });
      let p = load();
      let fresh = true;
      if (audit !== false && build.config) build.config.metafile = true;

      build.onStart(async () => {
        if (!fresh) p = load();
        fresh = false;
        const lines = [...optionProblems, ...p.problems, ...(p.sdk ? configGuards(build.config, p) : [])];
        if (lines.length) throw new StuntDoubleError(formatReport(header(p, lines.length), lines), lines);
        if (p.warnings.length) console.warn(formatWarnings(p));
        if (typecheck !== false) {
          const r = await runTypeGate(p);
          if (!r.ok) throw new StuntDoubleError(r.message, r.lines ?? []);
        }
      });

      if (!p.sdk) return; // fail closed: onStart throws, and the socket resolves to the registry placeholder
      const slotPackage = p.sdk.slotPackage;
      build.onResolve({ filter: new RegExp(`^${esc(slotPackage)}/[A-Za-z0-9_]+$`) }, (a) => {
        const slot = a.path.slice(slotPackage.length + 1);
        if (!p.sdk?.slots[slot]) return undefined; // not a slot: the placeholder answers, the dist scan reports it
        return { path: p.shimFile(slot) };
      });

      build.onEnd((result) => {
        if (audit === false || !p?.sdk || !result?.success || !result.metafile) return;
        const problems = auditGraph(p, esbuildGraph(result.metafile, root));
        if (problems.length) throw new StuntDoubleError(formatProblems(p, problems), problems);
      });
    },
  };
}

export default stuntDoubleBun;
