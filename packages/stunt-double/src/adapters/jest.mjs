// stunt-double/jest: Jest 30.
//
//   jest.config.mjs:  export default withStuntDouble({ testEnvironment: 'node', ...yourConfig })
//
// Jest has no bundler graph to hook, but it does have one static resolution table: moduleNameMapper. The
// adapter returns an async config (Jest accepts one) that:
//   - validates the overrides when Jest loads the config: any injection mistake fails `jest` (exit 1) before a
//     single test runs, with the same [Fx] report as the build
//   - maps @acme/core-slots/<Slot> to the generated shim, for requires from node_modules too (the SDK's own)
//   - transforms the ESM SDK (and brand layers) instead of ignoring them under node_modules
//   - optionally runs the contract type gate ({ typecheck: true }; off by default: babel-jest and @swc/jest do
//     not type-check, so CI runs `stunt-double check` or the build for that)
// ts-jest is not supported as a gate: it has no TypeScript 7 support and forces Node10 resolution.
import path from 'node:path';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { formatReport, formatWarnings, header } from '../core/diagnostics.mjs';
import { DEFAULTS } from '../core/config.mjs';
import { esc, posix } from '../core/util.mjs';

const OPTIONS = new Set(['typecheck', 'root', 'configFile', ...Object.keys(DEFAULTS)]);

/**
 * @param {object|Function} [config]  the Jest config, or a (possibly async) function returning it
 * @param {import('./jest.d.ts').StuntDoubleJestOptions} [opts]
 */
export function withStuntDouble(config = {}, opts = {}) {
  return async function stuntDoubleJestConfig(...args) {
    const base = (typeof config === 'function' ? await config(...args) : config) ?? {};
    const { typecheck = false, ...genOpts } = opts ?? {};
    const lines = Object.keys(opts ?? {}).filter((k) => !OPTIONS.has(k))
      .map((k) => `[CFG] unknown withStuntDouble() option "${k}". Known options: ${[...OPTIONS].join(', ')}.`);
    const rootDir = path.resolve(base.rootDir ?? genOpts.root ?? process.cwd());
    const p = generate({ ...genOpts, root: genOpts.root ?? rootDir, onError: 'return' });
    lines.push(...p.problems);
    if (lines.length) throw new StuntDoubleError(formatReport(header(p, lines.length), lines), lines);
    if (p.warnings.length) console.warn(formatWarnings(p));
    if (typecheck) {
      const r = await runTypeGate(p);
      if (!r.ok) throw new StuntDoubleError(r.message, r.lines ?? []);
    }
    const gen = `<rootDir>/${posix(path.relative(rootDir, p.genDir))}`;
    const transformable = p.packages.map(esc).join('|');
    return {
      ...base,
      // ours first: an exact socket must never fall through to a user pattern (or the registry placeholder)
      moduleNameMapper: { [`^${esc(p.sdk.slotPackage)}/([A-Za-z0-9_]+)$`]: `${gen}/$1.jsx`, ...base.moduleNameMapper },
      transformIgnorePatterns: base.transformIgnorePatterns ?? [`/node_modules/(?!(${transformable})/)`],
    };
  };
}

export default withStuntDouble;
