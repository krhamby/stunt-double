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
import { generate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, webpackGraph } from '../core/audit.mjs';
import { formatReport, formatWarnings, header } from '../core/diagnostics.mjs';
import { DEFAULTS } from '../core/config.mjs';

const NAME = 'stunt-double';
const OPTIONS = new Set(['typecheck', 'audit', 'root', 'configFile', 'mode', ...Object.keys(DEFAULTS)]);

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

/** The webpack / Rspack plugin. withStuntDouble() adds it; use it directly when you manage aliases yourself. */
export class StuntDoublePlugin {
  /**
   * @param {object} p      the generated project (from generate())
   * @param {object} [opts] { typecheck, audit, mode, problems: extra [CFG] lines }
   */
  constructor(p, opts = {}) {
    this.p = p;
    this.opts = opts;
    this.fresh = true;
  }

  apply(compiler) {
    const { WebpackError } = compiler.webpack ?? {};
    const mode = this.opts.mode ?? compiler.options.mode ?? 'production';
    const genOpts = this.opts.generate ?? {};
    const regen = (onError) => {
      // the generation made by withStuntDouble() at config time is fresh for the first run
      if (this.fresh) { this.fresh = false; return; }
      this.p = generate({ ...genOpts, root: this.p.root, onError });
      // Shim contents changed behind the same paths, and an override may have appeared where a stat said
      // "missing": drop both directories (purge takes path prefixes) from the cached input file system, or a
      // fixed mistake keeps failing on a stale "Can't resolve" until restart.
      const fsys = compiler.inputFileSystem;
      if (typeof fsys?.purge === 'function') fsys.purge([this.p.overridesDir, this.p.genDir, ...this.p.changedFiles]);
    };
    compiler.hooks.beforeRun.tap(NAME, () => regen('return'));
    compiler.hooks.watchRun.tap(NAME, () => regen('poison'));

    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const p = this.p;
      const report = (lines) => {
        if (!lines.length) return;
        const text = formatReport(header(p, lines.length), lines);
        const e = WebpackError ? new WebpackError(text) : new Error(text);
        e.stack = ''; // the report is the whole message: no stunt-double / webpack frames
        compilation.errors.push(e);
      };
      const problems = [...(this.opts.problems ?? []), ...p.problems];
      report(problems);
      if (p.warnings.length) {
        const w = WebpackError ? new WebpackError(formatWarnings(p)) : new Error(formatWarnings(p));
        w.stack = '';
        compilation.warnings.push(w);
      }
      // watch mode: adding, removing or editing an override (or the config) starts a new compilation
      try { compilation.contextDependencies.add(p.overridesDir); } catch {}
      for (const f of [p.configFile, path.join(p.root, 'package.json')].filter(Boolean)) try { compilation.fileDependencies.add(f); } catch {}
      if (!p.sdk) return;
      const gate = mode === 'production' && this.opts.typecheck !== false && !problems.length ? runTypeGate(p) : null;
      compilation.hooks.finishModules.tapPromise(NAME, async (modules) => {
        const list = [...modules];
        const lines = [];
        for (const req of externalRequests(list))
          for (const name of p.packages)
            if (req === name || req.startsWith(`${name}/`))
              lines.push(`[F6] ${name} is an external module in this build ("${req}"): the runtime would load it natively and slot overrides could not apply there (it fails on the registry placeholder). Bundle it: remove it from "externals" (webpack-node-externals: allowlist: [/^${name.replace(/\//g, '\\/')}/]).`);
        if (this.opts.audit !== false && !problems.length) lines.push(...auditGraph(p, webpackGraph(compilation, list)));
        const r = gate ? await gate : null;
        if (r && !r.ok) lines.push(...(r.lines?.length ? r.lines.map((l, i) => (i === 0 ? `${l} (tsc ${r.version}, ${r.ms} ms)` : l)) : [r.message]));
        report([...new Set(lines)]);
      });
    });
  }
}

/** Apply stunt-double to one webpack / Rspack configuration object (mutated and returned). */
function applyTo(config, opts) {
  const { typecheck = true, audit = true, mode, ...genOpts } = opts;
  const problems = Object.keys(opts).filter((k) => !OPTIONS.has(k))
    .map((k) => `[CFG] unknown withStuntDouble() option "${k}". Known options: ${[...OPTIONS].join(', ')}.`);
  const root = path.resolve(genOpts.root ?? config.context ?? process.cwd());
  const p = generate({ ...genOpts, root, onError: 'return' });
  config.plugins = [...(config.plugins ?? []), new StuntDoublePlugin(p, { typecheck, audit, mode, problems, generate: genOpts })];
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
  if (Array.isArray(config)) return config.map((c) => applyTo(c, opts ?? {}));
  return applyTo(config, opts ?? {});
}

export default withStuntDouble;
