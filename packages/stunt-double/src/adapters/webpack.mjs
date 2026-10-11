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
  }

  // Server targets: externals run on the raw request BEFORE resolve.alias, so webpack-node-externals and
  // friends would hand @acme/core (or a socket) to Node, which then loads the SDK natively and the overrides
  // never apply (or crashes on the .jsx shim). Keep the SDK, its layers and its sockets bundled.
  if (p.sdk && config.externals) config.externals = guardExternals(config.externals, keepBundled(p));

  config.module ??= {};
  config.module.parser ??= {};
  config.module.parser.javascript = { ...config.module.parser.javascript, exportsPresence: 'error' };

  foldFingerprint(config, p.fingerprint);

  (config.plugins ??= []).push(new StuntDoublePlugin(p, { typecheck, audit }));
  return config;
}

/** request -> true when it names the SDK, a brand layer or the slot package (or a subpath of one). */
function keepBundled(p) {
  const names = [...p.packages, p.sdk.slotPackage];
  return (req) => typeof req === 'string' && names.some((n) => req === n || req.startsWith(`${n}/`));
}

/**
 * Function externals (webpack-node-externals, Next-style handlers, custom ones) are wrapped so they never see
 * our packages. Strings, RegExps and objects that name them are left alone: the graph audit reports them ([F6]).
 */
function guardExternals(externals, keep) {
  if (Array.isArray(externals)) return externals.map((e) => guardExternals(e, keep));
  if (typeof externals !== 'function') return externals;
  const fn = externals;
  if (fn.length === 3) {
    // webpack 4 style (context, request, callback), still accepted by webpack 5
    return function stuntDoubleExternals(context, request, callback) {
      return keep(request) ? callback() : fn.call(this, context, request, callback);
    };
  }
  return function stuntDoubleExternals(data, callback) {
    return keep(data?.request) ? (callback ? callback() : Promise.resolve(undefined)) : fn.call(this, data, callback);
  };
}

/** External modules (webpack ExternalModule / Rspack external) whose request names the SDK or a socket. */
function capturedExternals(modules, keep) {
  const out = new Set();
  for (const m of modules) {
    const isExternal = m?.externalType !== undefined || m?.constructor?.name === 'ExternalModule' || /^external /.test(String(m?.identifier?.() ?? ''));
    if (!isExternal) continue;
    const req = m.userRequest ?? (Array.isArray(m.request) ? m.request[0] : typeof m.request === 'string' ? m.request : null);
    if (keep(req)) out.add(req);
  }
  return [...out];
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
      announceRemovals(c, this.p.overridesDir);
    });

    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const p = this.p;
      const ours = new Set();
      const report = (message) => { const e = makeError(message); ours.add(e); compilation.errors.push(e); };
      // webpack sorts module-less errors after every module error, and CRA prints only the first error: put the
      // [Fx] errors first, they explain the module errors that follow (e.g. a stale shim's "Module not found").
      // (Rspack has no processErrors and its hooks getter THROWS for unknown hooks: guard, don't optional-chain.)
      try { compilation.hooks.processErrors?.tap(NAME, (errors) => [...errors.filter((e) => ours.has(e)), ...errors.filter((e) => !ours.has(e))]); } catch {}
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
          for (const req of capturedExternals(modules, keepBundled(p)))
            problems.push(`[F6] "${req}" is external in this ${compiler.options.target ?? 'web'} build: the runtime would load ${p.sdk.name} natively and slot overrides could not apply. Remove it from "externals" (webpack-node-externals: allowlist: [/^${p.packages.concat(p.sdk.slotPackage).map((n) => n.replace(/[/.]/g, (c) => `\\${c}`)).join('|^')}/]).`);
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
