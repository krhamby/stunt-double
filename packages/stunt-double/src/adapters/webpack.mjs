// stunt-double/webpack: webpack 5 / Rspack 2 config wrapper (spec §7.3). Also the entry point for Storybook
// builder-webpack5 (`webpackFinal: (c) => withStuntDouble(c)`), Rsbuild `tools.rspack`, craco and Gatsby.
//
//   export default withStuntDouble({ ...yourConfig })
//
// What it does:
//   config load     STA (generate) + ONE static alias per slot  @acme/core-slots/<Slot>$ -> <root>/sdk-slots/gen/<Slot>.jsx,
//                   exportsPresence 'error' (F5), cache.version folds the fingerprint (F6e)
//   thisCompilation STA problems -> compilation.errors (exit 1 + dev overlay; never throw)
//   finishModules   AUD (graph audit) + TYP (type gate, production mode only) -> compilation.errors
//   watchRun        regenerate (poisoned shims on problems) so dev picks up override changes
import path from 'node:path';
import { generate, regenerate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, webpackGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';

const NAME = 'stunt-double';

/** @param {import('./webpack.d.ts').StuntDoubleWebpackOptions} [opts] */
export function withStuntDouble(config = {}, opts = {}) {
  const { typecheck = true, audit = true, mode, ...genOpts } = opts;
  const root = path.resolve(opts.root ?? process.cwd());
  const p = generate({ ...genOpts, root, onError: 'return' });
  config.resolve ??= {};
  if (p.sdk) {
    const entries = p.slots.map((s) => [`${p.sdk.slotPackage}/${s}$`, p.shimFile(s)]); // exact-match, explicit file targets
    const alias = config.resolve.alias;
    if (Array.isArray(alias)) alias.unshift(...entries.map(([name, target]) => ({ name: name.slice(0, -1), alias: target, onlyModule: true })));
    else config.resolve.alias = { ...Object.fromEntries(entries), ...(alias ?? {}) };
  }
  config.module ??= {};
  config.module.parser ??= {};
  config.module.parser.javascript = { ...config.module.parser.javascript, exportsPresence: 'error' }; // F5: javascript/auto only warns
  if (config.cache && typeof config.cache === 'object') config.cache.version = `${config.cache.version ?? ''}|${NAME}:${p.fingerprint}`;
  (config.plugins ??= []).push(new StuntDoublePlugin(p, { typecheck, audit, mode }));
  return config;
}

export class StuntDoublePlugin {
  constructor(p, opts = {}) { this.p = p; this.opts = opts; this.warned = false; }

  apply(compiler) {
    const { WebpackError } = compiler.webpack;
    const prod = (this.opts.mode ?? compiler.options.mode) === 'production';
    compiler.hooks.watchRun.tap(NAME, () => {
      this.p = regenerate(this.p, { onError: 'poison' });
      if (this.p.changedFiles.length) {
        if (typeof compiler.inputFileSystem?.purge === 'function') compiler.inputFileSystem.purge(this.p.changedFiles);
      }
    });
    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const p = this.p;
      const err = (m) => compilation.errors.push(new WebpackError(m)); // never throw: a throw skips the dev overlay
      if (p.problems.length) err(formatProblems(p));
      if (p.warnings.length && !this.warned) { this.warned = true; compilation.warnings.push(new WebpackError(formatWarnings(p))); }
      if (!p.sdk) return;
      compilation.contextDependencies.add(p.overridesDir);
      if (p.configFile) compilation.fileDependencies.add(p.configFile);
      // Main compilation only (child compilers, e.g. html-webpack-plugin). runTypeGate memoizes per fingerprint.
      const gate = prod && this.opts.typecheck !== false && !p.problems.length && !compilation.compiler.isChild() ? runTypeGate(p) : null;
      compilation.hooks.finishModules.tapPromise(NAME, async (modules) => {
        if (this.opts.audit !== false && !compilation.compiler.isChild()) {
          const a = auditGraph(p, webpackGraph(compilation, modules));
          if (a.length) err(formatProblems(p, a));
        }
        const r = await gate;
        if (r && !r.ok) err(r.message);
      });
    });
  }
}

export default withStuntDouble;
