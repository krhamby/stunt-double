// stunt-double/next: Next.js 16, Turbopack (the default) and webpack (`--webpack`).
//
//   next.config.mjs:  export default withStuntDouble({ ...yourNextConfig })   (an object or a (phase, ctx) function)
//
// Turbopack has no resolver API, only static aliases and loaders, so the decision has to be static: one exact
// alias per slot to the generated shim, whose CONTENT says override or default. The returned config is an async
// function of Next's phase:
//   next build   STA at config load (a problem throws: `next build` exits 1 before compiling anything), then
//                the TYP gate (same: it throws on a contract mismatch). Next's own type check does not include
//                the check file, so the adapter runs the gate itself; typescript.ignoreBuildErrors cannot skip it.
//   next dev     generate with poisoned shims on problems (every request shows the report in Next's error
//                overlay / HTTP 500), and watch the overrides in-process: add, remove and edit without a restart.
//   both         turbopack.resolveAlias + transpilePackages (the server bundle must contain the SDK, or its slot
//                imports would load natively), and the webpack adapter for `--webpack` (aliases, F5 as an error,
//                the post-bundle audit). [F6] when the SDK is listed in serverExternalPackages.
import path from 'node:path';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { watchProject } from '../core/watch.mjs';
import { formatProblems, formatWarnings, formatReport, header } from '../core/diagnostics.mjs';
import { DEFAULTS } from '../core/config.mjs';
import { posix } from '../core/util.mjs';
import { withStuntDouble as withWebpack } from './webpack.mjs';

const OPTIONS = new Set(['typecheck', 'audit', 'root', 'configFile', ...Object.keys(DEFAULTS)]);
const PHASE_BUILD = 'phase-production-build';
const PHASE_DEV = 'phase-development-server';
const WATCHING = Symbol.for('stunt-double.next.watching');

const fail = (p, lines) => { throw new StuntDoubleError(formatReport(header(p, lines.length), lines), lines); };

/** Start (once per process) the in-process watcher of `next dev`: regenerate on override / config changes. */
function watchInDev(p) {
  globalThis[WATCHING] ??= new Map();
  if (globalThis[WATCHING].has(p.root)) return;
  const w = watchProject(p, {
    onChange: (next, _prev, e) => {
      if (e) return console.error(`stunt-double: ${e.message}`);
      if (next.problems.length) console.error(formatProblems(next));
      else console.log(`stunt-double: overrides regenerated (${next.changedFiles.length} file(s) changed)`);
    },
  });
  globalThis[WATCHING].set(p.root, w);
}

/**
 * @param {object|Function} [nextConfig]  the project's Next config, or a (phase, ctx) function returning it
 * @param {import('./next.d.ts').StuntDoubleNextOptions} [opts]
 */
export function withStuntDouble(nextConfig = {}, opts = {}) {
  return async function stuntDoubleNextConfig(phase, ctx) {
    const base = (typeof nextConfig === 'function' ? await nextConfig(phase, ctx) : nextConfig) ?? {};
    const { typecheck = true, audit = true, ...genOpts } = opts ?? {};
    const optionProblems = Object.keys(opts ?? {}).filter((k) => !OPTIONS.has(k))
      .map((k) => `[CFG] unknown withStuntDouble() option "${k}". Known options: ${[...OPTIONS].join(', ')}.`);
    const root = path.resolve(genOpts.root ?? process.cwd());
    const dev = phase === PHASE_DEV;
    const p = generate({ ...genOpts, root, onError: dev ? 'poison' : 'return' });

    const lines = [...optionProblems, ...p.problems];
    for (const name of p.sdk ? p.packages : [])
      if ((base.serverExternalPackages ?? []).includes(name))
        lines.push(`[F6] serverExternalPackages lists ${name}: the server would load it natively and slot overrides could not apply there. Remove it.`);
    if (phase === PHASE_BUILD) {
      if (lines.length) fail(p, lines);
      if (p.warnings.length) console.warn(formatWarnings(p));
      if (typecheck !== false) {
        const r = await runTypeGate(p);
        if (!r.ok) throw new StuntDoubleError(r.message, r.lines ?? []);
      }
    } else if (dev) {
      if (lines.length) console.error(formatReport(header(p, lines.length), lines));
      if (p.sdk) watchInDev(p);
    }
    if (!p.sdk) return base; // fail closed: the socket resolves to the registry placeholder

    // Turbopack: exact aliases with "./"-relative targets (it silently ignores absolute ones)
    const rel = (f) => `./${posix(path.relative(root, f))}`;
    const aliases = Object.fromEntries(p.slots.map((s) => [`${p.sdk.slotPackage}/${s}`, rel(p.shimFile(s))]));
    const userWebpack = base.webpack;
    return {
      ...base,
      transpilePackages: [...new Set([...(base.transpilePackages ?? []), ...p.packages])],
      turbopack: { ...base.turbopack, resolveAlias: { ...base.turbopack?.resolveAlias, ...aliases } },
      webpack(config, wctx) {
        const c = userWebpack ? userWebpack(config, wctx) : config;
        // the gate already ran at config load; the webpack side adds aliases, F5-as-error and the audit
        return withWebpack(c, { ...genOpts, root, typecheck: false, audit });
      },
    };
  };
}

export default withStuntDouble;
