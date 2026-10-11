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
    this.seen = shimContents(p, new Map()); // shim contents this compiler last compiled against
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
      // Multi-compiler (webpack config arrays, Rsbuild environments): every compiler regenerates, but only the
      // first one in a rebuild sees changedFiles. Compare with what THIS compiler last saw instead.
      const changed = [...new Set([...this.p.changedFiles, ...shimChanges(this.p, this.seen)])];
      if (changed.length) invalidate(c, changed);
      if (changed.length || this.p.problems.join() !== prev.problems.join() || touches(this.p, c)) gateDirty = true;
    });

    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const p = this.p;
      const report = (message) => { compilation.errors.push(makeError(message)); };
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

function shimContents(p, into) {
  for (const s of p.sdk?.slotNames ?? []) {
    const f = p.shimFile(s);
    let c = null;
    try { c = fs.readFileSync(f, 'utf8'); } catch {}
    into.set(f, c);
  }
  return into;
}

/** Shim files whose content differs from the last snapshot (updates the snapshot). */
function shimChanges(p, seen) {
  const before = new Map(seen);
  shimContents(p, seen);
  return [...seen].filter(([f, c]) => before.get(f) !== c).map(([f]) => f);
}

/** Did this watch rebuild touch a file the type gate reads (overrides, their imports, the check file)? */
function touches(p, compiler) {
  const files = [...(compiler.modifiedFiles ?? []), ...(compiler.removedFiles ?? [])];
  if (!compiler.modifiedFiles) return true;
  return files.some((f) => f === p.checkFile || p.closureFiles.has(f) || isInside(f, p.overridesDir) || isInside(f, p.genDir));
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
