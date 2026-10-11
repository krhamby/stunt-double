// stunt-double/webpack: webpack 5 and Rspack 2 (and everything configured through them: Rsbuild, Next
// --webpack, CRA via craco, Gatsby, Storybook webpackFinal).
//
//   webpack.config.mjs:  export default withStuntDouble({ ...yourConfig })      (an object, array or function)
//   rspack.config.mjs:   export default withStuntDouble({ ...yourConfig })
//   rsbuild.config.ts:   tools: { rspack: (config) => withStuntDouble(config) }
//   craco.config.js:     webpack: { configure: (config) => withStuntDouble(config) }
//
// What it does:
//   config time   STA (generate into <root>/.stunt-double/) + one exact-match alias per slot:
//                 @acme/core-slots/<Slot>$ -> <outDir>/gen/<Slot>.jsx. Never resolve.plugins (Rspack ignores
//                 them) and never afterResolve replacement (loaders would be picked for the old path).
//                 module.parser.javascript.exportsPresence = 'error' (javascript/auto only WARNS on a missing
//                 export, F5). The fingerprint is folded into cache.version.
//   every run     regenerate (beforeRun / watchRun; watch mode writes poisoned shims so the dev overlay shows
//                 the report), STA problems -> compilation.errors (exit 1 + overlay; never a throw)
//   production    the TYP gate starts with the compilation and is awaited in finishModules -> compilation.errors
//   finishModules AUD: post-bundle graph audit; [F6] when the SDK became an external module (SSR externals)
import path from 'node:path';
import { generate, regenerate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, webpackGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { adapterOptions } from '../core/config.mjs';

const NAME = 'stunt-double';

/** The modules webpack / Rspack left to the runtime: their request strings. */
function externalRequests(modules) {
  const out = [];
  for (const m of modules) {
    let id = '';
    try { id = typeof m.identifier === 'function' ? m.identifier() : String(m.identifier ?? ''); } catch {}
    if (!/^external\b/.test(id) && m.constructor?.name !== 'ExternalModule') continue;
    const req = m.request ?? m.userRequest ?? /"([^"]+)"/.exec(id)?.[1];
    out.push(...[].concat(req ?? []).map(String));
  }
  return out;
}

/** The compiler plugin withStuntDouble() adds: regeneration, reports as compilation errors, the gate, the audit. */
class StuntDoublePlugin {
  constructor(p, flags) {
    this.p = p;
    this.flags = flags;
    this.fresh = true; // the generation made at config time is fresh for the first run
  }

  apply(compiler) {
    const { WebpackError } = compiler.webpack ?? {};
    const production = (compiler.options.mode ?? 'production') === 'production';
    const regen = (onError, changed) => {
      if (this.fresh) { this.fresh = false; return; }
      if (changed && !changed.some((f) => this.p.watches(f))) return; // an app file: nothing to regenerate
      this.p = regenerate(this.p, { onError });
      // Shim contents changed behind the same paths, and an override may have appeared where a stat said
      // "missing": drop both directories (purge takes path prefixes) from the cached input file system, or a
      // fixed mistake keeps failing on a stale "Can't resolve" until restart.
      compiler.inputFileSystem?.purge?.([this.p.overridesDir, this.p.genDir, ...this.p.changedFiles]);
    };
    compiler.hooks.beforeRun.tap(NAME, () => regen('return'));
    compiler.hooks.watchRun.tap(NAME, (c) => {
      const changed = c.modifiedFiles && [...c.modifiedFiles, ...(c.removedFiles ?? [])];
      regen('poison', changed);
    });

    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const p = this.p;
      const toError = (text) => {
        const e = WebpackError ? new WebpackError(text) : new Error(text);
        e.stack = ''; // the report is the whole message: no stunt-double / webpack frames
        return e;
      };
      if (p.problems.length) compilation.errors.push(toError(formatProblems(p)));
      if (p.warnings.length) compilation.warnings.push(toError(formatWarnings(p)));
      // watch mode: adding, removing or editing an override (or the config) starts a new compilation
      try { compilation.contextDependencies.add(p.overridesDir); } catch {}
      for (const f of p.watchFiles) try { compilation.fileDependencies.add(f); } catch {}
      if (!p.sdk) return;
      const gate = production && this.flags.typecheck && !p.problems.length ? runTypeGate(p) : null;
      compilation.hooks.finishModules.tapPromise(NAME, async (modules) => {
        const list = [...modules];
        const lines = [];
        for (const req of externalRequests(list))
          for (const name of p.packages)
            if (req === name || req.startsWith(`${name}/`))
              lines.push(`[F6] ${name} is an external module in this build ("${req}"): the runtime would load it natively and slot overrides could not apply there (it fails on the registry placeholder). Bundle it: remove it from "externals" (webpack-node-externals: allowlist: [/^${name.replace(/\//g, '\\/')}/]).`);
        if (this.flags.audit && !p.problems.length) lines.push(...auditGraph(p, webpackGraph(compilation, list)));
        const r = gate ? await gate : null;
        if (r && !r.ok) lines.push(...(r.lines.length ? r.lines : [r.message]));
        const unique = [...new Set(lines)];
        if (unique.length) compilation.errors.push(toError(formatProblems(p, unique)));
      });
    });
  }
}

/**
 * Apply a generated project to one webpack / Rspack configuration object (mutated and returned). The Next adapter
 * calls this with the project it generated at config load.
 */
export function applyTo(config, p, flags) {
  config.plugins = [...(config.plugins ?? []), new StuntDoublePlugin(p, flags)];
  if (!p.sdk) return config; // fail closed: the plugin reports why; the socket resolves to the registry placeholder
  config.resolve ??= {};
  const shims = Object.fromEntries(p.slots.map((s) => [`${p.sdk.slotPackage}/${s}$`, p.shimFile(s)]));
  // exact-match keys with explicit file targets; ours win over a user alias for the same socket
  config.resolve.alias = Array.isArray(config.resolve.alias)
    ? [...Object.entries(shims).map(([name, alias]) => ({ name: name.slice(0, -1), alias, onlyModule: true })), ...config.resolve.alias]
    : { ...config.resolve.alias, ...shims };
  config.module ??= {};
  config.module.parser ??= {};
  config.module.parser.javascript = { ...config.module.parser.javascript, exportsPresence: 'error' };
  if (config.cache && typeof config.cache === 'object' && config.cache.type === 'filesystem')
    config.cache.version = `${config.cache.version ?? ''}|stunt-double:${p.fingerprint}`;
  return config;
}

/**
 * Wrap a webpack 5 / Rspack 2 configuration: an object, an array of them (multi-compiler), or a function of
 * (env, argv) returning either (or a promise of either).
 * @param {object|object[]|Function} config
 * @param {import('./webpack.d.ts').StuntDoubleWebpackOptions} [opts]
 */
export function withStuntDouble(config = {}, opts = {}) {
  if (typeof config === 'function') return async (...args) => withStuntDouble(await config(...args), opts);
  const { flags, genOpts } = adapterOptions('withStuntDouble()', opts, { typecheck: true, audit: true });
  const projects = new Map(); // one generation per project root, however many compilers share it
  const apply = (c) => {
    const root = path.resolve(genOpts.root ?? c.context ?? process.cwd());
    if (!projects.has(root)) projects.set(root, generate({ ...genOpts, root, onError: 'return' }));
    return applyTo(c, projects.get(root), flags);
  };
  return Array.isArray(config) ? config.map(apply) : apply(config);
}

export default withStuntDouble;
