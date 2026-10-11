// stunt-double/jest: the Jest 30 config wrapper.
//
//   // jest.config.mjs
//   import { withStuntDouble } from 'stunt-double/jest';
//   export default withStuntDouble({ testEnvironment: 'jsdom' });
//
// What it does (spec §7.5):
//   config load     STA (generate, onError 'throw'): any injection error makes `jest` exit 1 before a test runs
//   moduleNameMapper ONE static mapping  ^@acme/core-slots/<Slot>$ -> <root>/sdk-slots/gen/<Slot>.jsx. jest-resolve
//                   applies it to requires from node_modules too, so SDK-internal sockets get the overrides
//   transform       transformIgnorePatterns let babel-jest / @swc/jest compile the ESM SDK (and pnpm's .pnpm layout);
//                   a user pattern that would skip the SDK or the shims is refused (CFG)
//   watch           a watch plugin regenerates (poisoned shims on errors) before every `jest --watch` run
//   typecheck       opt-in: { typecheck: true } returns a Promise config that also runs the contract type gate
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { esc } from '../core/util.mjs';

const WATCH_PLUGIN = fileURLToPath(new URL('./jest-watch.mjs', import.meta.url));

/** transformIgnorePatterns that keep the SDK (and its layers) transformed, including under pnpm's .pnpm/ store. */
export function transformIgnorePatternsFor(packages) {
  return [`/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(${packages.map(esc).join('|')})/)`];
}

/**
 * @param {object} [config]  your Jest config
 * @param {import('./jest.d.ts').StuntDoubleJestOptions} [opts]
 */
export function withStuntDouble(config = {}, opts = {}) {
  const { typecheck = false, watch = true, ...genOpts } = opts;
  const root = path.resolve(opts.root ?? config.rootDir ?? process.cwd());
  const p = generate({ ...genOpts, root, onError: 'throw' });   // STA: a throw at config load fails `jest` with exit 1
  if (p.warnings.length) console.warn(formatWarnings(p));

  // CFG: the SDK and the shims must go through the transformer, or Jest cannot load them at all.
  const probes = [path.join(p.sdk.realDir, 'index.js'), ...p.layers.map((l) => path.join(l.realDir, 'index.js')), p.shimFile(p.slots[0] ?? 'X')];
  for (const pattern of [].concat(config.transformIgnorePatterns ?? [])) {
    const hit = probes.find((f) => new RegExp(pattern).test(f.split(path.sep).join('/')));
    if (hit) throw new StuntDoubleError(formatProblems(p, [
      `[F6] Jest transformIgnorePatterns entry ${JSON.stringify(pattern)} skips ${p.rel(hit)}: the ESM ${p.packages.join(', ')} and the slot shims must be transformed. Remove the entry, or build yours from transformIgnorePatternsFor() exported by stunt-double/jest.`,
    ]));
  }
  for (const [key, target] of Object.entries(config.moduleNameMapper ?? {})) {
    if (new RegExp(key).test(`${p.sdk.slotPackage}/${p.slots[0] ?? 'X'}`) && !String(target).includes(p.rel(p.genDir)))
      console.warn(`stunt-double: moduleNameMapper ${JSON.stringify(key)} also matches ${p.sdk.slotPackage}/*; stunt-double's mapping is applied first.`);
  }

  const out = {
    ...config,
    moduleNameMapper: {
      [`^${esc(p.sdk.slotPackage)}/([A-Za-z0-9_]+)$`]: `${p.genDir.split(path.sep).join('/')}/$1.jsx`,
      ...config.moduleNameMapper,
    },
    transformIgnorePatterns: config.transformIgnorePatterns ?? transformIgnorePatternsFor(p.packages),
    ...(watch ? { watchPlugins: [...(config.watchPlugins ?? []), [WATCH_PLUGIN, { root: p.root, configFile: opts.configFile ?? null }]] } : {}),
  };
  if (!typecheck) return out;
  return runTypeGate(p).then((r) => {
    if (!r.ok) throw new StuntDoubleError(r.message);
    return out;
  });
}

export default withStuntDouble;
