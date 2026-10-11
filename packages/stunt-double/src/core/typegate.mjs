// The type gate: tsc on the generated check program. TypeScript 7 has no classic JS API, so the CLI is
// always spawned, resolved BY PACKAGE NAME (cfg.typescript, so an npm alias like "typescript5" works and a
// second TypeScript's .bin/tsc can never be picked by accident). ANY non-zero exit fails (TS 7: 1, TS 5.9: 2).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readJson, writeIfChanged, relSpec, findPackageJson, sha, posix } from './util.mjs';
import { mapDiagnostics, header } from './diagnostics.mjs';

export function resolveTypeScript(p) {
  const name = p.cfg.typescript ?? 'typescript';
  const pj = findPackageJson(name, p.root);
  if (!pj) return { error: `[SETUP] the type gate needs the "${name}" package (cfg "typescript"), but it is not installed in ${p.root}: npm i -D ${name === 'typescript' ? 'typescript' : `${name}@npm:typescript@5.9`}` };
  const ts = readJson(pj);
  const binRel = typeof ts.bin === 'string' ? ts.bin : ts.bin?.tsc;
  if (!binRel) return { error: `[SETUP] package "${name}" (${ts.name}@${ts.version}) has no tsc bin.` };
  return { name, version: ts.version, major: Number(String(ts.version).split('.')[0]), bin: path.join(path.dirname(pj), binRel) };
}

/** Write <genDir>/tsconfig.check.json: extends the app tsconfig, program = the check file only (+ what it imports). */
export function writeCheckTsconfig(p) {
  const file = path.join(p.genDir, 'tsconfig.check.json');
  const base = { noEmit: true, skipLibCheck: true, incremental: false, composite: false, noUnusedLocals: false, noUnusedParameters: false, declaration: false, declarationMap: false, emitDeclarationOnly: false, tsBuildInfoFile: null };
  const json = p.tsconfig
    ? { extends: relSpec(p.genDir, p.tsconfig), compilerOptions: base, files: [relSpec(p.genDir, p.checkFile)], include: [] }
    : {
        compilerOptions: { ...base, target: 'es2022', lib: ['es2022', 'dom'], module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, types: [], paths: { [`${p.sdk.slotPackage}/*`]: ['./*'] } },
        files: [relSpec(p.genDir, p.checkFile)], include: [],
      };
  writeIfChanged(file, JSON.stringify(json, null, 2) + '\n');
  return file;
}

const memo = new Map();

/**
 * @returns {Promise<{ ok: boolean, ms?: number, version?: string, message?: string, lines?: string[], output?: string }>}
 */
export function runTypeGate(p, { force = false } = {}) {
  if (p.problems?.length) return Promise.resolve({ ok: false, message: `stunt-double: the type gate did not run because of the injection errors above.`, lines: [] });
  const ts = resolveTypeScript(p);
  if (ts.error) return Promise.resolve({ ok: false, message: `${header(p, 1)}\n  ${ts.error}`, lines: [ts.error] });
  if (p.isPnP && ts.major >= 7) {
    const line = `[TS-PNP] TypeScript ${ts.version} cannot resolve modules under Yarn Plug'n'Play: set "typescript": "typescript5" (npm alias of typescript@5.9) in stunt-double.config.json.`;
    return Promise.resolve({ ok: false, message: `${header(p, 1)}\n  ${line}`, lines: [line] });
  }
  const checkText = (() => { try { return fs.readFileSync(p.checkFile, 'utf8'); } catch { return ''; } })();
  const key = `${p.root}|${p.fingerprint}|${sha(checkText)}|${ts.bin}|${ts.version}`;
  if (!force && memo.has(key)) return memo.get(key);
  const tsconfigFile = writeCheckTsconfig(p);
  const run = new Promise((done) => {
    const t0 = performance.now();
    execFile(process.execPath, [ts.bin, '-p', tsconfigFile, '--pretty', 'false'], { cwd: p.root, maxBuffer: 1 << 26, env: { ...process.env, NODE_OPTIONS: '' } }, (err, stdout, stderr) => {
      const ms = Math.round(performance.now() - t0);
      const output = `${stdout ?? ''}${stderr ?? ''}`;
      if (!err) return done({ ok: true, ms, version: ts.version, output });
      const map = readJson(path.join(p.genDir, 'check.map.json'));
      let lines = mapDiagnostics(p, output, map);
      if (!lines.length) lines = [`[TS] tsc exited with ${err.code ?? err.signal}: ${output.trim().split('\n').slice(0, 5).join(' | ') || err.message}`];
      const suffix = ` (tsc ${ts.version}, ${ms} ms)`;
      const message = `${header(p, lines.length)}\n  ${lines.map((l, i) => (i === 0 ? l + suffix : l)).join('\n  ')}`;
      done({ ok: false, ms, version: ts.version, output, lines, message, tsconfig: posix(path.relative(p.root, tsconfigFile)) });
    });
  });
  memo.set(key, run);
  return run;
}
