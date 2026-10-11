// Message formatting: one header, then one line per problem starting with a stable code ([F1]..[F9], [W7],
// [STALE], [TS-PNP], [X1], ...). tsc diagnostics in the check file are mapped back to the slot and file.
import path from 'node:path';
import { plural, posix } from './util.mjs';

export function header(p, n, what = 'injection error') {
  const sdk = p?.sdk ? ` (${p.sdk.name}@${p.sdk.version})` : '';
  return `stunt-double: ${plural(n, what)}${sdk}`;
}

export function formatProblems(p, problems = p.problems) {
  return `${header(p, problems.length)}\n  ${problems.join('\n  ')}`;
}

export function formatWarnings(p, warnings = p.warnings) {
  return `${header(p, warnings.length, 'warning')}\n  ${warnings.join('\n  ')}`;
}

/** Split `tsc --pretty false` output into diagnostics (continuation lines are folded into the message). */
export function parseTscOutput(output) {
  const out = [];
  for (const raw of String(output).split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(raw);
    if (m) { out.push({ file: m[1], line: +m[2], col: +m[3], category: m[4], code: m[5], message: m[6] }); continue; }
    const g = /^(error|warning) (TS\d+): (.*)$/.exec(raw.trim());
    if (g) { out.push({ file: null, line: 0, col: 0, category: g[1], code: g[2], message: g[3] }); continue; }
    if (/^\s+\S/.test(raw) && out.length) out.at(-1).message += ' ' + raw.trim();
  }
  return out;
}

function ignoredProps(message) {
  const m = /ignores these SDK props['"]?\s*:\s*(.+?);?\s*\}'?\.?$/.exec(message);
  return m ? m[1].replace(/;\s*$/, '').trim() : null;
}

/**
 * Map a failed gate run to `[Fx] Slot (file): ...` lines.
 * @returns {string[]} one line per diagnostic
 */
export function mapDiagnostics(p, output, map) {
  const lines = [];
  const checkAbs = p.checkFile;
  for (const d of parseTscOutput(output)) {
    const abs = d.file ? path.resolve(p.root, d.file) : null;
    const where = d.file ? `${posix(path.relative(p.root, abs))}(${d.line},${d.col})` : '';
    if (abs !== checkAbs) {
      lines.push(`[TS] ${where ? where + ': ' : ''}${d.category} ${d.code}: ${d.message}`);
      continue;
    }
    const info = map?.lines?.[d.line];
    const msg = `${d.code} ${d.message}`;
    if (!info) { lines.push(`[TS] ${where}: ${d.category} ${msg}`); continue; }
    const tag = `${info.slot} (${info.file})`;
    switch (info.role) {
      case 'abi':
        lines.push(`[STALE] ${where}: ${msg}   <- the installed ${p.sdk.name} differs from the one the check file was generated for: run \`npx stunt-double gen\``);
        break;
      case 'wiring':
        lines.push(`[F6] ${info.slot}: "${p.sdk.slotPackage}/${info.slot}" does not resolve to the generated shim (${msg}). Add "paths": {"${p.sdk.slotPackage}/*": ["./${posix(path.relative(p.root, p.genDir))}/*"]} to ${p.tsconfigRel ?? 'tsconfig.json'}, or link ${p.sdk.slotPackage}, then run npx stunt-double gen.`);
        break;
      case 'slotset':
        lines.push(`[STALE] ${where}: ${msg}   <- the SDK's slot set changed since generation: run \`npx stunt-double gen\``);
        break;
      case 'probe':
        lines.push(`[STALE] ${where}: ${msg}   <- ${posix(path.relative(p.root, p.overridesDir))}/${info.slot}.* now exists; run \`npx stunt-double gen\``);
        break;
      case 'import':
        lines.push(`[F5] ${tag}: ${msg}`);
        break;
      case 'declaresAll': {
        const props = ignoredProps(d.message);
        lines.push(props
          ? `[F1] ${tag}: override ignores these SDK props: ${props} (declare them, or list them in stunt-double.config.json map.${info.slot}.ignoresProps)`
          : `[F1] ${tag}: ${msg}`);
        break;
      }
      case 'notAsync':
        lines.push(`[F9] ${tag}: client slot override must not be an async component (${d.code}). Async components can only render in server slots.`);
        break;
      case 'isComponent':
        lines.push(`[F1] ${tag}: is not a React component (function, memo, forwardRef or class): ${msg}`);
        break;
      default:
        lines.push(`[F1] ${tag}: ${msg}`);
    }
  }
  return [...new Set(lines)];
}
