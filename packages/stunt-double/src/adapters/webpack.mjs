// stunt-double/webpack: one adapter for webpack 5, Rspack 2, Rsbuild 2 (tools.rspack), CRA via craco, Gatsby
// (onCreateWebpackConfig), Storybook webpackFinal and Next --webpack.
//
//   export default withStuntDouble({ ...yourConfig })
//
// What it does (spec §7.3):
//   config load   STA (generate) + one EXACT alias per slot  @acme/core-slots/<Slot>$ -> <root>/sdk-slots/gen/<Slot>.jsx,
//                 module.parser.javascript.exportsPresence = 'error' (F5: javascript/auto only warns otherwise),
//                 the generation fingerprint folded into the persistent cache version (F6e)
//   watchRun      regenerate (poison mode) and invalidate the rewritten shims so THIS compilation reads them
//   compilation   problems -> compilation.errors (non-zero exit, dev overlay; never a throw)
//   finishModules TYP gate (started in thisCompilation) + AUD module-graph audit -> compilation.errors
//
// Never resolve.plugins (Rspack silently ignores it), never module replacement in afterResolve (loaders were
// already chosen for the old path), never fork-ts-checker with TypeScript 7 (it crashes and the build passes).
import fs from 'node:fs';
import path from 'node:path';
import { generate, regenerate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, webpackGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { isInside } from '../core/util.mjs';

const NAME = 'stunt-double';

/**
 * Wrap a webpack / Rspack configuration. Accepts a config object, an array of them (multi-compiler), or a
 * config function `(env, argv) => config` (returns a wrapped function). Mutates and returns the config.
 * @param {any} config
 * @param {import('./webpack.d.ts').StuntDoubleWebpackOptions} [opts]
 */
export function withStuntDouble(config, opts = {}) {
  if (typeof config === 'function') return (...args) => withAny(config(...args), opts);
  return withAny(config, opts);
}

function withAny(config, opts) {
  if (config && typeof config.then === 'function') return config.then((c) => withAny(c, opts));
  if (Array.isArray(config)) return config.map((c) => withOne(c, opts));
  return withOne(config ?? {}, opts);
}

function withOne(config, opts) {
  const { typecheck = true, audit = true, mode: _mode, ...genOpts } = opts;
  const root = path.resolve(opts.root ?? config.context ?? process.cwd());
  const p = generate({ ...genOpts, root, onError: 'return' });
  // A bailing run (CRA's production config sets bail: true) aborts at the first module error, typically the
  // previous shim of a renamed override, so the [Fx] problems would never be printed. Report them instead.
  if (p.problems.length && config.bail) config.bail = false;

  if (p.sdk) {
    config.resolve ??= {};
    const targets = p.slots.map((s) => [`${p.sdk.slotPackage}/${s}`, p.shimFile(s)]);
    if (Array.isArray(config.resolve.alias)) {
      // webpack's array form: [{ name, alias, onlyModule }]; our entries go first so they win.
      config.resolve.alias.unshift(...targets.map(([name, alias]) => ({ name, alias, onlyModule: true })));
    } else {
      // Exact match ("$"), explicit file targets: no prefix aliasing of unknown sockets, no directory lookup.
      config.resolve.alias = { ...Object.fromEntries(targets.map(([k, v]) => [`${k}$`, v])), ...(config.resolve.alias ?? {}) };
      for (const [k, v] of targets) config.resolve.alias[`${k}$`] = v;
    }
    // CRA's ModuleScopePlugin rejects imports from src/ that resolve outside src/: allow exactly the shims, so app
    // code can import the public socket '@acme/core-slots/X' as with every other tool.
    for (const rp of config.resolve.plugins ?? [])
      if (rp?.allowedFiles instanceof Set && Array.isArray(rp.appSrcs)) for (const [, shim] of targets) rp.allowedFiles.add(shim);
  }

  config.module ??= {};
  config.module.parser ??= {};
  config.module.parser.javascript = { ...config.module.parser.javascript, exportsPresence: 'error' };

  foldFingerprint(config, p.fingerprint);

  (config.plugins ??= []).push(new StuntDoublePlugin(p, { typecheck, audit }));
  return config;
}

/** F6e defence in depth: a decision change also changes the persistent-cache version. */
function foldFingerprint(config, fingerprint) {
  const tag = `stunt-double:${fingerprint}`;
  const fold = (c) => {
    const base = c.version == null ? '' : String(c.version).replace(/\|?stunt-double:[0-9a-f]+/, '');
    c.version = base ? `${base}|${tag}` : tag;
  };
  // webpack 5: cache: { type: 'filesystem', version }. Rspack 2: cache: { type: 'persistent', version }.
  if (config.cache && typeof config.cache === 'object' && /^(filesystem|persistent)$/.test(config.cache.type ?? '')) fold(config.cache);
  // Rspack 1.x style (still accepted by some Rspack 2 wrappers): experiments.cache: { type: 'persistent' }.
  const ec = config.experiments?.cache;
  if (ec && typeof ec === 'object' && ec.type === 'persistent') fold(ec);
}

export class StuntDoublePlugin {
  /**
   * @param {any} p  the generated project (from generate())
   * @param {{ typecheck?: boolean | 'build', audit?: boolean }} [opts]
   */
  constructor(p, opts = {}) {
    this.p = p;
    this.opts = opts;
    this.lastGate = null; // dev: the last type-gate result, re-reported until the next relevant change
  }

  apply(compiler) {
    const { WebpackError } = compiler.webpack ?? {};
    const makeError = (message) => {
      const e = WebpackError ? new WebpackError(message) : new Error(message);
      e.name = 'StuntDoubleError';
      e.hideStack = true;
      e.stack = '';
      return e;
    };
    let watching = false;
    let gateDirty = true;

    compiler.hooks.watchRun.tap(NAME, (c) => {
      watching = true;
      const prev = this.p;
      this.p = regenerate(prev, { onError: 'poison' });
      const changed = this.p.changedFiles;
      if (changed.length) invalidate(c, changed);
      if (changed.length || this.p.problems.join() !== prev.problems.join() || touches(this.p, c)) gateDirty = true;
      announceRemovals(c, this.p.overridesDir);
    });

    // A one-shot build with an injection error must fail the process even when the wrapper prints compilation
    // errors and exits 0 (CRA's build with TSC_COMPILE_ON_ERROR=true does that for every error).
    compiler.hooks.done.tap(NAME, (stats) => {
      if (!watching && stats.compilation.errors.some((e) => e?.name === 'StuntDoubleError')) process.exitCode = 1;
    });

    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const p = this.p;
      const ours = new Set();
      const report = (message) => { const e = makeError(message); ours.add(e); compilation.errors.push(e); };
      // webpack sorts module-less errors after every module error, and CRA prints only the first error: put the
      // [Fx] errors first, they explain the module errors that follow (e.g. a stale shim's "Module not found").
      compilation.hooks.processErrors?.tap(NAME, (errors) => [...errors.filter((e) => ours.has(e)), ...errors.filter((e) => !ours.has(e))]);
      if (p.problems.length) report(formatProblems(p));
      if (p.warnings.length && !this.warned) { this.warned = true; compilation.warnings.push(makeError(formatWarnings(p))); }
      compilation.contextDependencies.add(p.overridesDir);
      for (const f of [p.configFile, path.join(p.root, 'package.json'), ...p.closureFiles]) if (f) compilation.fileDependencies.add(f);

      const typecheck = this.opts.typecheck ?? true;
      let gate = null;
      if (!p.problems.length && p.sdk && typecheck && !(watching && typecheck === 'build')) {
        if (!watching) gate = runTypeGate(p);
        else if (gateDirty || !this.lastGate) { gateDirty = false; gate = this.lastGate = runTypeGate(p, { force: true }); }
        else gate = this.lastGate;
      }

      compilation.hooks.finishModules.tapPromise(NAME, async (modules) => {
        if (this.opts.audit !== false && p.sdk && !p.problems.length) {
          const problems = auditGraph(p, webpackGraph(compilation, modules));
          if (problems.length) report(formatProblems(p, problems));
        }
        if (gate) {
          const r = await gate;
          if (!r.ok) report(r.message);
        }
      });
    });
  }
}

/** Did this watch rebuild touch a file the type gate reads (overrides, their imports, the check file)? */
function touches(p, compiler) {
  const files = [...(compiler.modifiedFiles ?? []), ...(compiler.removedFiles ?? [])];
  if (!compiler.modifiedFiles) return true;
  return files.some((f) => f === p.checkFile || p.closureFiles.has(f) || isInside(f, p.overridesDir) || isInside(f, p.genDir));
}

/**
 * Inside a watched context directory (the overrides dir) watchpack reports a deleted file as 'remove' followed
 * by 'change' with no mtime. fork-ts-checker 6 (CRA's dev type checker) ignores the mtime and records a change,
 * so TypeScript never sees the delete and, once the file is back, keeps a stale TS2307 for it (e.g. in
 * src/stunt-double.check.ts after a rename and its fix). Re-announce real removals; only 'remove' listeners
 * see this (webpack and webpack-dev-server listen for 'change').
 */
function announceRemovals(compiler, dir) {
  const watcher = compiler.watchFileSystem?.watcher ?? compiler.watchFileSystem?.wfs?.watcher;
  if (typeof watcher?.emit !== 'function') return;
  for (const f of new Set([...(compiler.modifiedFiles ?? []), ...(compiler.removedFiles ?? [])]))
    if (isInside(f, dir) && !fs.existsSync(f)) watcher.emit('remove', f, 'rename');
}

/**
 * Shims rewritten in watchRun must be read by the compilation that is about to start, not one rebuild later:
 * drop them from the input file system's caches and from the watcher's timestamp snapshot (webpack), and
 * mark them modified (webpack's and Rspack's incremental rebuilds both consult compiler.modifiedFiles).
 */
function invalidate(compiler, files) {
  const fs = compiler.inputFileSystem;
  if (typeof fs?.purge === 'function') { try { fs.purge(files); } catch {} }
  for (const map of [compiler.fileTimestamps]) if (map && typeof map.delete === 'function') for (const f of files) map.delete(f);
  if (compiler.modifiedFiles && typeof compiler.modifiedFiles.add === 'function') {
    for (const f of files) { try { compiler.modifiedFiles.add(f); } catch {} }
  }
}

export default withStuntDouble;
