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
import { generate, regenerate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, esbuildGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { adapterOptions } from '../core/config.mjs';
import { esc } from '../core/util.mjs';
import { externalGuards } from './esbuild.mjs';

/** @param {import('./bun.d.ts').StuntDoubleBunOptions} [opts] */
export function stuntDoubleBun(opts = {}) {
  const { flags, genOpts } = adapterOptions('stuntDoubleBun()', opts, { typecheck: true, audit: true });
  return {
    name: 'stunt-double',
    setup(build) {
      const root = path.resolve(genOpts.root ?? process.cwd());
      let p = generate({ ...genOpts, root, onError: 'return' });
      let fresh = true;
      if (flags.audit && build.config) build.config.metafile = true;

      build.onStart(async () => {
        if (!fresh) p = regenerate(p);
        fresh = false;
        const lines = [...p.problems, ...(p.sdk ? externalGuards('Bun.build', build.config, p.packages) : [])];
        if (lines.length) throw new StuntDoubleError(formatProblems(p, lines), lines);
        if (p.warnings.length) console.warn(formatWarnings(p));
        if (flags.typecheck) {
          const r = await runTypeGate(p);
          if (!r.ok) throw new StuntDoubleError(r.message, r.lines);
        }
      });

      if (!p.sdk) return; // fail closed: onStart throws, and the socket resolves to the registry placeholder
      build.onResolve({ filter: new RegExp(`^${esc(p.sdk.slotPackage)}/[A-Za-z0-9_]+$`) }, (a) => {
        const shim = p.socketShim(a.path);
        return shim ? { path: shim } : undefined; // not a slot: the placeholder answers, the dist scan reports it
      });

      build.onEnd((result) => {
        if (!flags.audit || !p.sdk || !result?.success || !result.metafile) return;
        const problems = auditGraph(p, esbuildGraph(result.metafile, root));
        if (problems.length) throw new StuntDoubleError(formatProblems(p, problems), problems);
      });
    },
  };
}

export default stuntDoubleBun;
