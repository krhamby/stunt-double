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
// Dev server (`bun ./index.html` / Bun.serve HTML routes, plugin listed in bunfig.toml [serve.static] plugins):
// Bun 1.4.2 runs onStart once, never onEnd, and rebuilds without calling back on file edits [V]. There the
// plugin writes POISONED shims and watches src/overrides itself, so every injection error shows up in Bun's
// error overlay as an unresolved './STUNT-DOUBLE-ERROR -- [Fx] ...' import, and clears on fix. The type gate
// runs in the background and prints to stderr (dev never blocks on types, like every dev server).
//
// Bun 1.4.2 [V]: a throw or rejected promise in setup, onStart or onEnd rejects the Bun.build() promise
// whether `throw` is true or false (it never becomes `{ success: false }`), so an unawaited-catch build
// script exits 1. Outputs are already on disk when onEnd runs, hence the cleanup.
import fs from 'node:fs';
import path from 'node:path';
import { generate, regenerate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { watchProject } from '../core/watch.mjs';
import { auditGraph, esbuildGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { esc, isInside } from '../core/util.mjs';

const PLUGIN = 'stunt-double';

/** @param {import('./bun.d.ts').StuntDoubleBunOptions} [opts] */
export function stuntDoubleBun(opts = {}) {
  const { typecheck = true, audit = true, ...genOpts } = opts;
  let p = null;
  let warned = false;
  let watcher = null;

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
      // Not build.config.root: that is Bun's output-layout root (default: the entrypoints' common ancestor).
      const root = path.resolve(opts.root ?? process.cwd());
      // Bun.build always has entrypoints; the static dev server's config has none (it bundles HTML routes).
      if (build.config && !build.config.entrypoints) return serveMode(build, root);
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

      resolveSockets(build);

      build.onEnd(async (result) => {
        if (audit === false || !p?.sdk || !result?.success) return;
        if (!result.metafile) fail(`stunt-double: Bun.build returned no metafile, so the post-bundle audit could not run (pass audit: false to skip it).`);
        // metafile keys are relative to the process cwd, whatever `root` is [V 1.4.2]
        const problems = [...await externalized(p, result.metafile, result.outputs), ...auditGraph(p, bunGraph(result.metafile, process.cwd()))];
        if (!problems.length) return;
        removeOutputs(result.outputs, build.config?.outdir);
        fail(formatProblems(p, problems), problems);
      });
    },
  };

  function resolveSockets(build) {
    const slotPackage = p?.sdk?.slotPackage;
    if (!slotPackage) return;
    build.onResolve({ filter: new RegExp(`^${esc(slotPackage)}/[A-Za-z0-9_]+$`) }, (args) => {
      const slot = args.path.slice(slotPackage.length + 1);
      // Unknown slot: let native resolution fail on the link (gen/<Slot>.jsx does not exist).
      return p.sdk?.slots[slot] ? { path: p.shimFile(slot) } : undefined;
    });
  }

  function serveMode(build, root) {
    const gate = (cur) => {
      if (typecheck === false || !cur.sdk || cur.problems.length) return;
      // force: the memo key covers decisions, not override contents (an edit can fix or break types)
      runTypeGate(cur, { force: true }).then((r) => { if (!r.ok) console.error(r.message); }, () => {});
    };
    if (!p) {
      p = generate({ ...genOpts, root, onError: 'poison' });
      if (p.problems.length) console.error(formatProblems(p));
      warn();
      gate(p);
    }
    if (p.sdk && !watcher) {
      watcher = watchProject(p, {
        onError: 'poison',
        onChange: (next, _prev, e) => {
          if (e) return console.error(`${PLUGIN}: ${e.message}`);
          p = next;
          if (next.problems.length) console.error(formatProblems(next));
          else { console.error(`${PLUGIN}: injection errors fixed`); gate(next); }
        },
      });
    }
    resolveSockets(build);
  }
}

/** Bun metafile -> graph. Keys are relative to the working directory; the namespace prefix is stripped. */
export function bunGraph(metafile, cwd) {
  return esbuildGraph(metafile, cwd);
}

/**
 * [F6] The SDK, a layer or a socket left external (`packages: 'external'`, `external: ['@acme/*']`): the runtime
 * would load it natively, where no override applies (the registry placeholder answers the sockets there). Bun
 * 1.4.2 builds that fine and fails only at boot [V]. An external socket alone never gets here: the plugin's
 * onResolve wins over `external` [V]. Types-only `<sdk>/contracts` may stay external.
 * Bun 1.4.2 also marks UNUSED re-exports of a sideEffects:false package as external in metafile.inputs (they are
 * tree-shaken, never resolved) and leaves metafile.outputs[].imports empty, so each candidate is confirmed
 * against the emitted code [V].
 */
export async function externalized(p, metafile, outputs = []) {
  const { name, slotPackage } = p.sdk;
  const pkgs = [...p.packages, slotPackage];
  const hit = (spec) => spec !== `${name}/contracts` && pkgs.some((n) => spec === n || spec.startsWith(n + '/'));
  const specs = new Set();
  for (const info of Object.values(metafile?.inputs ?? {})) for (const i of info.imports ?? []) if (i.external && hit(i.path)) specs.add(i.path);
  if (specs.size) {
    const code = (await Promise.all(outputs.filter((o) => /\.[cm]?js$/.test(o.path ?? '')).map((o) => o.text()))).join('\n');
    for (const s of specs) if (!code.includes(`"${s}"`) && !code.includes(`'${s}'`)) specs.delete(s);
  }
  if (!specs.size) return [];
  return [`[F6] Bun.build leaves ${[...specs].map((s) => `"${s}"`).join(', ')} external: the runtime would load ${specs.size > 1 ? 'them' : 'it'} natively, where slot overrides cannot apply (the registry placeholder answers the sockets there). Bundle ${name}: remove it from \`external\`, or replace \`packages: 'external'\` with an \`external\` list that does not match ${pkgs.join(' / ')}.`];
}

function removeOutputs(outputs, outdir) {
  if (!outdir) return;
  const dir = path.resolve(outdir);
  for (const o of outputs ?? []) {
    const f = path.resolve(o.path);
    if (isInside(f, dir)) try { fs.rmSync(f, { force: true }); } catch {}
  }
}



// bunfig.toml `[serve.static] plugins = ["stunt-double/bun"]` loads the DEFAULT export as a plugin object:
// make the factory usable as one too (default options).
Object.defineProperty(stuntDoubleBun, 'name', { value: PLUGIN });
stuntDoubleBun.setup = (build) => stuntDoubleBun().setup(build);
export default stuntDoubleBun;
