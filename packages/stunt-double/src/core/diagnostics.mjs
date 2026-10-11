// Message formatting: one header, then one line per problem starting with a stable code ([F1]..[F9], [W7],
// [STALE], [TS-PNP], [X1], ...). tsc diagnostics in the check file are mapped back to the slot and file.
import path from 'node:path';
import { plural, posix } from './util.mjs';

export const DOCS_BASE = 'https://github.com/krhamby/stunt-double/blob/main/docs/';

/** Message code -> section of docs/errors.md (GitHub heading anchors). */
export const ANCHORS = {
  F1: 'f1--contract-mismatch',
  F2: 'f2--unknown-slot',
  F3: 'f3--missing-implementation',
  F4: 'f4--slot-claimed-twice',
  F5: 'f5--wrong-export',
  F6: 'f6--override-not-applied',
  F7: 'f7--override-renders-itself',
  W7: 'w7--possible-render-cycle',
  F8: 'f8--duplicate-react-or-sdk',
  F9: 'f9--server-and-client-mismatch',
  STALE: 'stale--generated-files-out-of-date',
  'TS-PNP': 'ts-pnp--typescript-7-under-yarn-pnp',
  X1: 'x1--ignorebuilderrors-in-nextjs',
  X2: 'x2--check-file-not-in-tsconfig',
  X3: 'ts-pnp--typescript-7-under-yarn-pnp',
  X4: 'x4--two-typescript-versions-installed',
  'STUNT-DOUBLE-NOT-WIRED': 'stunt-double-not-wired--resolve-error',
  'STUNT-DOUBLE-ERROR': 'stunt-double-error--poisoned-shim-in-dev',
  TS: 'ts--type-error-in-an-override',
  CFG: 'cfg--invalid-config',
  SETUP: 'setup--sdk-or-typescript-not-found',
  L1: 'l1-and-l2--brand-layer-mismatch',
  L2: 'l1-and-l2--brand-layer-mismatch',
  DOCTOR: 'doctor--setup-check',
};

/** The reference URL for one message code ("F2", "[F7?]", "SDK1", ...), or null for an unknown code. */
export function docsUrl(code) {
  const c = String(code).replace(/^\[|\??\]$/g, '');
  if (/^SDK\d*$/.test(c)) return `${DOCS_BASE}sdk-authors.md#sdk-lint-reference`;
  return ANCHORS[c] ? `${DOCS_BASE}errors.md#${ANCHORS[c]}` : null;
}

/** One "see <url>" footer line per distinct code among `lines` (in first-seen order). */
export function docsFooter(lines) {
  const urls = [];
  for (const l of lines) {
    const m = /^\s*\[([A-Z][A-Z0-9-]*)\??\]/.exec(String(l));
    const u = m && docsUrl(m[1]);
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls.map((u) => `see ${u}`);
}

export function header(p, n, what = 'injection error') {
  const sdk = p?.sdk ? ` (${p.sdk.name}@${p.sdk.version})` : '';
  return `stunt-double: ${plural(n, what)}${sdk}`;
}

/** A complete report: header, one line per item, then the reference footer. */
export function formatReport(head, lines) {
  return [head, ...lines, ...docsFooter(lines)].join('\n  ');
}

export function formatProblems(p, problems = p.problems) {
  return formatReport(header(p, problems.length), problems);
}

export function formatWarnings(p, warnings = p.warnings) {
  return formatReport(header(p, warnings.length, 'warning'), warnings);
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

/** "narrows the parameters of ...: X" from a value slot's argsFit diagnostic, or null. */
function narrowedArgs(message) {
  const m = /'\[F1\] (narrows the parameters of (?:the contract|these members))'\s*:\s*(.+?);?\s*\}'?\.?$/.exec(message);
  if (!m) return null;
  const what = m[2].replace(/;\s*$/, '').trim();
  return m[1].endsWith('the contract') ? `narrows the parameters of the contract ${what}` : `narrows the parameters of these members: ${what}`;
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
        lines.push(`[STALE] ${where}: ${msg}   <- the generated shim of slot "${info.slot}" is missing or out of date: run \`npx stunt-double gen\``);
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
      case 'fits':
        lines.push(`[F1] ${tag}: does not fit the contract ${p.sdk?.name ?? 'SDK'} SlotTypes['${info.slot}']: ${msg}`);
        break;
      case 'argsFit': {
        const narrowed = narrowedArgs(d.message);
        lines.push(narrowed
          ? `[F1] ${tag}: ${narrowed} (the SDK may pass any value its contract allows: accept the contract's parameter types)`
          : `[F1] ${tag}: ${msg}`);
        break;
      }
      default:
        lines.push(`[F1] ${tag}: ${msg}`);
    }
  }
  return [...new Set(lines)];
}
