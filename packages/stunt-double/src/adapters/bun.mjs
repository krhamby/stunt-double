// stunt-double/bun: the Bun 1.4 bundler plugin (Bun.build only; the `bun build` CLI cannot load plugins).
//
//   await Bun.build({ entrypoints: ['src/main.tsx'], outdir: 'dist', plugins: [stuntDoubleBun()] });
//
// What it does (spec §7.7):
//   setup      STA (generate, onError 'return'); forces `metafile: true` for the audit; starts the type gate
//   onStart    regenerate (every rebuild), STA problems -> throw; TYP gate -> throw
//   onResolve  @acme/core-slots/<Slot> -> <root>/sdk-slots/gen/<Slot>.jsx (Bun.build sees bare specifiers
//              from node_modules files; the Bun RUNTIME / `bun test` does not: those use the workspace link)
//   onEnd      AUD: metafile graph audit -> remove the written outputs and throw
//
// Bun 1.4.2 [V]: a throw or rejected promise in setup, onStart or onEnd rejects the Bun.build() promise
// whether `throw` is true or false (it never becomes `{ success: false }`), so an unawaited-catch build
// script exits 1. Outputs are already on disk when onEnd runs, hence the cleanup.
import fs from 'node:fs';
import path from 'node:path';
import { generate, regenerate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, esbuildGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { esc, isInside } from '../core/util.mjs';

const PLUGIN = 'stunt-double';

/** @param {import('./bun.d.ts').StuntDoubleBunOptions} [opts] */
export function stuntDoubleBun(opts = {}) {
  const { typecheck = true, audit = true, ...genOpts } = opts;
  let p = null;
  let warned = false;

  const fail = (message, problems = []) => {
    const e = new StuntDoubleError(message, problems);
    Object.defineProperty(e, 'problems', { enumerable: false }); // Bun prints enumerable props: the message has them
    throw e;
  };
  const warn = () => {
    if (warned || !p?.warnings.length) return;
    warned = true;
    console.warn(formatWarnings(p));
  };

  return {
    name: PLUGIN,
    setup(build) {
      const root = path.resolve(opts.root ?? build.config?.root ?? process.cwd());
      // generate() is synchronous and cheap; setup may run once per target, the result is identical.
      p ??= generate({ ...genOpts, root, onError: 'return' });
      if (audit !== false && build.config) build.config.metafile = true;
      if (p.sdk && !p.problems.length && typecheck !== false) runTypeGate(p).catch(() => {}); // warm the memo

      build.onStart(async () => {
        p = regenerate(p, { onError: 'return' });
        if (p.problems.length) fail(formatProblems(p), p.problems);
        warn();
        if (typecheck === false) return;
        const r = await runTypeGate(p);
        if (!r.ok) fail(r.message, r.lines ?? []);
      });

      const slotPackage = p.sdk?.slotPackage;
      if (slotPackage) {
        build.onResolve({ filter: new RegExp(`^${esc(slotPackage)}/[A-Za-z0-9_]+$`) }, (args) => {
          const slot = args.path.slice(slotPackage.length + 1);
          // Unknown slot: let native resolution fail on the link (gen/<Slot>.jsx does not exist).
          return p.sdk?.slots[slot] ? { path: p.shimFile(slot) } : undefined;
        });
      }

      build.onEnd((result) => {
        if (audit === false || !p?.sdk || !result?.success) return;
        if (!result.metafile) fail(`stunt-double: Bun.build returned no metafile, so the post-bundle audit could not run (pass audit: false to skip it).`);
        const cwd = build.config?.root ? path.resolve(build.config.root) : process.cwd();
        const problems = auditGraph(p, bunGraph(result.metafile, cwd));
        if (!problems.length) return;
        removeOutputs(result.outputs, build.config?.outdir);
        fail(formatProblems(p, problems), problems);
      });
    },
  };
}

/** Bun metafile -> graph. Keys are relative to the working directory; the namespace prefix is stripped. */
export function bunGraph(metafile, cwd) {
  return esbuildGraph(metafile, cwd);
}

function removeOutputs(outputs, outdir) {
  if (!outdir) return;
  const dir = path.resolve(outdir);
  for (const o of outputs ?? []) {
    const f = path.resolve(o.path);
    if (isInside(f, dir)) try { fs.rmSync(f, { force: true }); } catch {}
  }
}

export default stuntDoubleBun;
