// stunt-double/next: the Next.js 16 wrapper (Turbopack, the default, and `--webpack`).
//
//   // next.config.mjs
//   import { withStuntDouble } from 'stunt-double/next';
//   export default withStuntDouble({ ...yourConfig });
//
// What it does (spec §7.4):
//   config load   STA (generate, onError 'throw'): any injection mistake fails `next build` AND `next dev` startup
//   TYP           compiler.runAfterProductionCompile (next build only, both bundlers, awaited; a throw fails the
//                 build): the stunt-double type gate on the generated check file, independent of the app tsconfig
//                 and of typescript.ignoreBuildErrors. The user's own runAfterProductionCompile runs first.
//   transpilePackages   the SDK (+ layers): the Pages Router / route handlers would otherwise externalize it and
//                 Node would load @acme/core natively (the placeholder poison, or a .jsx shim Node refuses)
//   Turbopack     ONE wildcard resolveAlias '@acme/core-slots/*' -> './sdk-slots/gen/*.jsx'. The target MUST be
//                 relative ('./'): Turbopack silently ignores absolute or missing targets and falls back
//   webpack       exact-match aliases to the shims, exportsPresence 'error' (F5), the fingerprint folded into the
//                 persistent cache version, and a plugin reporting STA problems + the post-bundle audit (AUD)
//                 through compilation.errors (the type gate runs in runAfterProductionCompile for both bundlers).
import path from 'node:path';
import { generate, regenerate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, webpackGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';

const NAME = 'stunt-double';

/**
 * @template T
 * @param {T} nextConfig  a Next config object, or a config function `(phase, ctx) => config`
 * @param {import('./next.d.ts').StuntDoubleNextOptions} [opts]
 * @returns {T}
 */
export function withStuntDouble(nextConfig = {}, opts = {}) {
  if (typeof nextConfig === 'function')
    return /** @type {any} */ (async (phase, ...rest) => {
      const c = await nextConfig(phase, ...rest);
      return phase === PHASE_PRODUCTION_SERVER ? c : wrap(c, opts);
    });
  return /** @type {any} */ (isNextStart() ? nextConfig : wrap(nextConfig, opts));
}

// `next start` serves a build that was validated when it was built: nothing is bundled any more, so it must not
// depend on (or rewrite) the current source tree. Detected exactly through `phase` for config functions, and for
// config objects only when the process is unambiguously `next start` (anything else stays strict: fails loud).
const PHASE_PRODUCTION_SERVER = 'phase-production-server';
function isNextStart() {
  const [, bin = '', cmd] = process.argv;
  return cmd === 'start' && /[\\/]next(?:[\\/]dist[\\/]bin[\\/]next|\.js|\.cmd)?$/.test(bin);
}

// Next prints a config-load error's enumerable props after its message: keep `problems` (already in the
// message) out of that dump.
function fail(e) {
  if (e && Array.isArray(e.problems)) Object.defineProperty(e, 'problems', { value: e.problems, enumerable: false });
  throw e;
}

function wrap(nextConfig = {}, opts = {}) {
  try { return wrapUnsafe(nextConfig, opts); } catch (e) { fail(e); }
}

function wrapUnsafe(nextConfig, opts) {
  const { audit = true, typecheck = true, ...genOpts } = opts;
  const root = path.resolve(genOpts.root ?? process.cwd());
  const tsconfigPath = nextConfig.typescript?.tsconfigPath;
  const p = generate({ ...(tsconfigPath && !genOpts.tsconfig ? { tsconfig: tsconfigPath } : {}), ...genOpts, root, onError: 'throw' });
  if (!p.sdk) throw new StuntDoubleError(formatProblems(p), p.problems); // unreachable with onError 'throw'; belt and braces

  // [X2] (the app tsconfig does not include the check file) is not a gap here: the adapter runs its own gate.
  const otherWarnings = p.warnings.filter((w) => !w.startsWith('[X2]'));
  if (otherWarnings.length && !process.env.__STUNT_DOUBLE_NEXT_WARNED) {
    process.env.__STUNT_DOUBLE_NEXT_WARNED = '1';
    console.warn(formatWarnings(p, otherWarnings));
  }

  const slotPkg = p.sdk.slotPackage;
  // Turbopack: './'-relative target, posix separators (an absolute target is silently ignored).
  const rel = './' + path.relative(p.root, p.genDir).split(path.sep).join('/');
  const userWebpack = nextConfig.webpack;
  const userAfterCompile = nextConfig.compiler?.runAfterProductionCompile;

  return {
    ...nextConfig,
    transpilePackages: [...new Set([...(nextConfig.transpilePackages ?? []), ...p.packages])],
    turbopack: {
      ...nextConfig.turbopack,
      resolveAlias: { ...nextConfig.turbopack?.resolveAlias, [`${slotPkg}/*`]: `${rel}/*.jsx` },
    },
    compiler: {
      ...nextConfig.compiler,
      // TYP: `next build` only (never dev or start), Turbopack and webpack alike, in the main build process.
      async runAfterProductionCompile(meta) {
        if (userAfterCompile) await userAfterCompile(meta);
        if (typecheck === false) return;
        const r = await runTypeGate(p);
        if (!r.ok) fail(new StuntDoubleError(r.message, r.lines ?? [r.message]));
      },
    },
    webpack(config, ctx) {
      const c = userWebpack ? userWebpack(config, ctx) : config;
      return withWebpackSlots(c, p, { audit, dev: !!ctx?.dev });
    },
  };
}

// The piece of stunt-double/webpack that Next needs (no type gate: next build type-checks the check file).
function withWebpackSlots(config, p, { audit, dev }) {
  config.resolve ??= {};
  const alias = config.resolve.alias;
  const entries = Object.fromEntries(p.slots.map((s) => [`${p.sdk.slotPackage}/${s}$`, p.shimFile(s)]));
  if (Array.isArray(alias)) alias.push(...Object.entries(entries).map(([name, a]) => ({ name: name.slice(0, -1), alias: a, onlyModule: true })));
  else config.resolve.alias = { ...alias, ...entries };
  config.module ??= {};
  config.module.parser ??= {};
  config.module.parser.javascript = { ...config.module.parser.javascript, exportsPresence: 'error' }; // F5 for javascript/auto
  if (config.cache && typeof config.cache === 'object' && config.cache.type === 'filesystem')
    config.cache.version = `${config.cache.version ?? ''}|${NAME}:${p.fingerprint}`;
  (config.plugins ??= []).push(new StuntDoubleNextWebpackPlugin(p, { audit: audit && !dev, dev }));
  return config;
}

class StuntDoubleNextWebpackPlugin {
  constructor(p, opts) { this.p = p; this.opts = opts; }
  apply(compiler) {
    const { WebpackError } = compiler.webpack;
    // dev without `stunt-double watch`: regenerate when webpack notices a change (poisoned shims on mistakes)
    compiler.hooks.watchRun.tap(NAME, () => {
      try { this.p = regenerate(this.p, { onError: 'poison' }); } catch {}
    });
    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const err = (m) => compilation.errors.push(new WebpackError(m)); // never throw: a throw skips the dev overlay
      // dev: the poisoned shims report through Next's own channel (overlay / HTTP 500). Pushing the problems
      // here as well would also fail Next's error-page compilation, and the 500 page loses the message.
      if (!this.opts.dev && this.p.problems.length) err(formatProblems(this.p));
      compilation.contextDependencies.add(this.p.overridesDir);
      if (this.p.configFile) compilation.fileDependencies.add(this.p.configFile);
      if (!this.opts.audit) return;
      compilation.hooks.finishModules.tap(NAME, (modules) => {
        const problems = auditGraph(this.p, webpackGraph(compilation, modules));
        if (problems.length) err(formatProblems(this.p, problems));
      });
    });
  }
}

export default withStuntDouble;
