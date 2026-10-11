// stunt-double/esbuild: native esbuild 0.28 plugin (NOT unplugin: its esbuild adapter drops this.error and
// bundles overrides twice).
//
//   await esbuild.build({ entryPoints: ['src/main.tsx'], bundle: true, plugins: [stuntDoubleEsbuild()] })
//
// What it does (spec §7.2):
//   setup     STA (generate) once; forces metafile: true (needed for AUD)
//   onStart   regenerate on rebuilds (context / watch), STA problems + TYP gate -> errors (the build fails)
//   onResolve the ONE static mapping  @acme/core-slots/<Slot> -> <root>/sdk-slots/gen/<Slot>.jsx
//   onEnd     AUD: post-bundle graph audit of the metafile -> errors (the build fails)
//
// Zero-plugin alternative: `alias: stuntDoubleAlias()` (no validation: chain `stunt-double check &&`).
import fs from 'node:fs';
import path from 'node:path';
import { generate, regenerate } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { auditGraph, esbuildGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings } from '../core/diagnostics.mjs';
import { esc } from '../core/util.mjs';

const PLUGIN = 'stunt-double';
const msg = (text) => ({ text, pluginName: PLUGIN });

/** @param {import('./esbuild.d.ts').StuntDoubleEsbuildOptions} [opts] */
export function stuntDoubleEsbuild(opts = {}) {
  const { typecheck = true, audit = true, ...genOpts } = opts;
  return {
    name: PLUGIN,
    setup(build) {
      const cwd = path.resolve(build.initialOptions.absWorkingDir ?? process.cwd());
      const root = path.resolve(cwd, opts.root ?? '.');
      let p = null;
      let fatal = null;
      const gen = (prev) => {
        try { p = prev ? regenerate(prev, { onError: 'return' }) : generate({ ...genOpts, root, onError: 'return' }); fatal = null; }
        catch (e) { fatal = String(e?.message ?? e); }
      };
      gen(null);
      build.initialOptions.metafile = true; // AUD reads the metafile
      // esbuild writes the output BEFORE onEnd runs, so a failed audit would still leave a deployable bundle on
      // disk. Hold the write and do it in onEnd once the audit passed.
      const holdWrite = audit !== false && build.initialOptions.write !== false;
      if (holdWrite) build.initialOptions.write = false;
      let first = true;

      build.onStart(async () => {
        const rebuild = !first;
        if (rebuild && p) gen(p); // context.rebuild() / watch: pick up added, removed or renamed overrides
        first = false;
        if (fatal) return { errors: [msg(`${PLUGIN}: ${fatal}`)] };
        const warnings = p.warnings.length ? [msg(formatWarnings(p))] : [];
        if (p.problems.length) return { errors: [msg(formatProblems(p))], warnings };
        if (typecheck !== false) {
          // The gate memo is keyed on decisions + check-file text, not on override CONTENTS: force it on rebuilds.
          const r = await runTypeGate(p, { force: rebuild });
          if (!r.ok) return { errors: [msg(r.message)], warnings };
        }
        return { warnings };
      });

      // The socket filter is static (identical for every override set); unknown slots fall through to
      // package resolution, which fails on the link (no such shim) or on the registry placeholder.
      const slotPackage = p?.sdk?.slotPackage;
      if (slotPackage) {
        build.onResolve({ filter: new RegExp(`^${esc(slotPackage)}/[A-Za-z0-9_]+$`) }, (a) => {
          // esbuild keeps bundling after onStart errors. The build already fails with the [Fx] lines, so park
          // the sockets instead of adding "Cannot read file .../gen/Footer.jsx" noise for unwritten shims.
          if (fatal || p.problems.length) return { path: a.path, external: true };
          const slot = a.path.slice(slotPackage.length + 1);
          return p?.sdk?.slots[slot] ? { path: p.shimFile(slot) } : undefined;
        });
      }

      build.onEnd((result) => {
        if (audit === false || result.errors.length) return;
        const problems = p?.sdk && result.metafile ? [...externalized(p, result.metafile), ...auditGraph(p, esbuildGraph(result.metafile, cwd))] : [];
        if (!problems.length) {
          if (holdWrite) for (const f of result.outputFiles ?? []) {
            fs.mkdirSync(path.dirname(f.path), { recursive: true });
            fs.writeFileSync(f.path, f.contents);
          }
          return;
        }
        const errors = [msg(formatProblems(p, problems))];
        // esbuild 0.28 fails the build on onEnd errors but never LOGS them (only the rejection carries them),
        // so a script that catches and exits would be silent. Print them like esbuild prints its own.
        if (build.initialOptions.logLevel !== 'silent') {
          const color = build.initialOptions.color ?? !!process.stderr.isTTY;
          process.stderr.write(build.esbuild.formatMessagesSync(errors, { kind: 'error', color }).join(''));
        }
        return { errors };
      });
    },
  };
}

/**
 * [F6] The SDK (or a socket) left external, e.g. `packages: 'external'` or `external: ['@acme/*']` in a server
 * build: Node would load the SDK natively, where no override can apply (it hits the registry placeholder or the
 * .jsx shims at boot). Types-only `<sdk>/contracts` may stay external.
 */
function externalized(p, metafile) {
  const { name, slotPackage } = p.sdk;
  const hit = (spec) => spec === slotPackage || spec.startsWith(slotPackage + '/') || spec === name || (spec.startsWith(name + '/') && spec !== `${name}/contracts`);
  const specs = new Set();
  for (const info of Object.values(metafile.inputs ?? {})) for (const i of info.imports ?? []) if (i.external && hit(i.path)) specs.add(i.path);
  if (!specs.size) return [];
  return [`[F6] esbuild leaves ${[...specs].map((s) => `"${s}"`).join(', ')} external: the runtime would load ${specs.size > 1 ? 'them' : 'it'} natively, where slot overrides cannot apply (the registry placeholder answers the sockets there). Bundle ${name}: remove it from \`external\`, or replace \`packages: 'external'\` with an \`external\` list that does not match ${name} / ${slotPackage}.`];
}

/**
 * Zero-plugin variant: esbuild `alias` entries (subpath keys -> absolute shim paths). No validation, no type
 * gate, no audit: the build script MUST be `stunt-double check && node build.mjs`.
 * @param {import('./esbuild.d.ts').StuntDoubleEsbuildOptions} [opts]
 */
export function stuntDoubleAlias(opts = {}) {
  const { typecheck, audit, ...genOpts } = opts;
  const p = generate({ ...genOpts, root: path.resolve(opts.root ?? process.cwd()), onError: 'throw' });
  return Object.fromEntries(p.slots.map((s) => [`${p.sdk.slotPackage}/${s}`, p.shimFile(s)]));
}

export default stuntDoubleEsbuild;
