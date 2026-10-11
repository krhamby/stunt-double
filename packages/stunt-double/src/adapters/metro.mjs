// stunt-double/metro: the Metro (React Native / Expo) config wrapper.
//
//   // metro.config.js (CommonJS is fine: Node >= 22.12 require()s this ES module synchronously)
//   const { getDefaultConfig } = require('@react-native/metro-config');   // or 'expo/metro-config'
//   const { withStuntDouble } = require('stunt-double/metro');
//   module.exports = withStuntDouble(getDefaultConfig(__dirname));
//
// Metro has no build-start hook, so everything that must fail a bundle runs while the config loads, where a
// throw IS the gate (`metro build`, `react-native bundle`, `expo export` all exit 1):
//   config load        STA (generate, onError 'throw')                          -> throw
//                      TYP (sync tsc) in one-shot bundle commands (typecheck 'auto') -> throw
//   resolveRequest     ONE static rule  @acme/core-slots/<Slot> -> <genDir>/<Slot>.jsx (p.shimFile),
//                      chained in front of any previous resolveRequest
//   serializer hook    AUD: the bundled module graph (F6 bypass / socket resolved elsewhere, F8) -> throw
//   dev (start/serve)  STA problems poison the shims instead (the server starts, every bundle request shows the
//                      [Fx] text in the red box), a watcher regenerates on override edits, TYP runs async.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate, resolveTypeScript, writeCheckTsconfig } from '../core/typegate.mjs';
import { auditGraph } from '../core/audit.mjs';
import { formatProblems, formatWarnings, formatReport, mapDiagnostics, header } from '../core/diagnostics.mjs';
import { watchProject } from '../core/watch.mjs';
import { readJson } from '../core/util.mjs';

const BUILD_COMMANDS = new Set(['build', 'bundle', 'ram-bundle', 'export', 'export:embed']);
const SERVE_COMMANDS = new Set(['start', 'serve', 'run-ios', 'run-android', 'run:ios', 'run:android']);

/** The CLI command that is loading this config: metro build|serve, react-native bundle|start, expo export|start. */
export function detectCommand(argv = process.argv) {
  const cmd = argv.slice(2).find((a) => !a.startsWith('-'));
  if (BUILD_COMMANDS.has(cmd)) return 'build';
  if (SERVE_COMMANDS.has(cmd)) return 'serve';
  return 'unknown';
}

/** TYP, synchronously (a Metro config cannot await before it is returned without breaking other wrappers). */
export function runTypeGateSync(p) {
  if (p.problems.length) return { ok: false, message: formatProblems(p) };
  const ts = resolveTypeScript(p);
  if (ts.error) return { ok: false, message: formatReport(header(p, 1), [ts.error]) };
  if (p.isPnP && ts.major >= 7) {
    const line = `[TS-PNP] TypeScript ${ts.version} cannot resolve modules under Yarn Plug'n'Play: set "typescript": "typescript5" (npm alias of typescript@5.9) in stunt-double.config.json.`;
    return { ok: false, message: formatReport(header(p, 1), [line]) };
  }
  const tsconfigFile = writeCheckTsconfig(p);
  const t0 = performance.now();
  try {
    execFileSync(process.execPath, [ts.bin, '-p', tsconfigFile, '--pretty', 'false'], { cwd: p.root, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } });
    return { ok: true, ms: Math.round(performance.now() - t0), version: ts.version };
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    let lines = mapDiagnostics(p, output, readJson(p.mapFile));
    if (!lines.length) lines = [`[TS] tsc exited with ${err.status ?? err.signal}: ${output.trim().split('\n').slice(0, 5).join(' | ') || err.message}`];
    const suffix = ` (tsc ${ts.version}, ${ms} ms)`;
    return { ok: false, ms, version: ts.version, message: formatReport(header(p, lines.length), lines.map((l, i) => (i === 0 ? l + suffix : l))) };
  }
}

/** Metro graph (graph.dependencies: Map<absolute path, Module>) -> [{ id, importers }]. */
export function metroGraph(graph) {
  const out = [];
  for (const [id, m] of graph?.dependencies ?? []) out.push({ id, importers: [...(m?.inverseDependencies ?? [])] });
  return out;
}

/**
 * @param {import('./metro.d.ts').MetroConfigLike | Promise<import('./metro.d.ts').MetroConfigLike>} config
 * @param {import('./metro.d.ts').StuntDoubleMetroOptions} [opts]
 */
export function withStuntDouble(config, opts = {}) {
  if (config && typeof config.then === 'function') return config.then((c) => withStuntDouble(c, opts));
  const { typecheck = 'auto', audit = true, command = detectCommand(), ...genOpts } = opts;
  const root = path.resolve(genOpts.root ?? config?.projectRoot ?? process.cwd());
  const serve = command === 'serve';

  // STA. Outside the dev server a problem throws: Metro's config loader rethrows it and the command exits 1.
  let p = generate({ ...genOpts, root, onError: serve ? 'poison' : 'throw' });
  if (p.problems.length) console.error(formatProblems(p));
  else if (p.warnings.length) console.warn(formatWarnings(p));
  if (!p.sdk) throw new StuntDoubleError(formatProblems(p), p.problems); // even in dev: nothing to resolve to

  // TYP. One-shot bundles (and typecheck: true) block on it; the dev server reports it without blocking.
  if (typecheck === true || (typecheck === 'auto' && command === 'build')) {
    const r = runTypeGateSync(p);
    if (!r.ok) throw new StuntDoubleError(r.message);
  } else if (serve && typecheck !== false && !p.problems.length) {
    runTypeGate(p).then((r) => { if (!r.ok) console.error(r.message); }, () => {});
  }

  let watcher = null;
  if (serve) {
    watcher = watchProject(p, {
      onChange(next, _prev, error) {
        if (error) return console.error(String(error?.message ?? error));
        if (next.problems.length) return console.error(formatProblems(next));
        console.log('stunt-double: overrides regenerated');
        if (typecheck !== false) runTypeGate(next).then((r) => { if (!r.ok) console.error(r.message); }, () => {});
      },
    });
  }
  const current = () => watcher?.current ?? p;

  const prefix = p.sdk.slotPackage + '/';
  const prevResolve = config?.resolver?.resolveRequest;
  const prevHook = config?.serializer?.experimentalSerializerHook;

  return {
    ...config,
    resolver: {
      ...config?.resolver,
      resolveRequest(ctx, moduleName, platform) {
        if (moduleName.startsWith(prefix)) {
          const cur = current();
          const slot = moduleName.slice(prefix.length);
          if (cur.sdk?.slots[slot]) return { type: 'sourceFile', filePath: cur.shimFile(slot) };
        }
        return (prevResolve ?? ctx.resolveRequest)(ctx, moduleName, platform);
      },
    },
    serializer: {
      ...config?.serializer,
      // Called with the full graph after every (re)build, before serialization; a throw fails the bundle.
      experimentalSerializerHook(graph, delta) {
        const cur = current();
        if (audit !== false && !cur.problems.length) {
          const problems = auditGraph(cur, metroGraph(graph));
          if (problems.length) throw new StuntDoubleError(formatProblems(cur, problems), problems);
        }
        return prevHook?.(graph, delta);
      },
    },
  };
}

export default withStuntDouble;
