// Scan an INSTALLED SDK (or layer) package: every JS file's edges. Always run, cached per package content.
//   F6a: a dist file imports a slot default directly (relative path or `<sdk>/original/X`): overrides can never
//        reach that position (spec R2). The same scanner is the SDK's publish gate (`stunt-double sdk-lint`).
//   socketConsumers: which dist files import `<slotPackage>/X` (used by the post-bundle audit).
import fs from 'node:fs';
import path from 'node:path';
import { parseModule } from './parse.mjs';
import { listFiles, posix, real, sha, readJson, writeIfChanged, fileExists } from './util.mjs';

const JS = ['.js', '.mjs', '.cjs', '.jsx'];

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, ...JS.map((e) => base + e), ...JS.map((e) => path.join(base, 'index' + e))]) if (fileExists(c)) return real(c);
  return null;
}

function contentKey(files) {
  const parts = files.map((f) => { try { const s = fs.statSync(f); return `${f}:${s.size}:${s.mtimeMs}`; } catch { return f; } });
  return sha(parts.join('|'), 16);
}

/**
 * @param {object} o
 * @param {{name, version, dir, realDir, slots, slotNames, slotPackage, originalSpecifier, defaultFile}} o.sdk
 * @param {string} o.pkgDir     package directory to scan (the SDK itself or a layer)
 * @param {string} o.label      package name for messages
 * @param {(f:string)=>string} o.rel
 * @param {string} [o.cacheFile]
 * @returns {{ problems: string[], edges: Array<{file, spec, slot, how}>, socketConsumers: Record<string,string[]>, unknownSockets: Array<{file,slot}>, files: string[], directives: Record<string,string|null> }}
 */
export function scanDist({ sdk, pkgDir, label = sdk.name, rel, cacheFile = null, allowFiles = [] }) {
  const files = listFiles(pkgDir, { exts: JS }).filter((f) => !/\.d\.[cm]?ts$/.test(f));
  const key = `${label}|${sdk.hash}|${contentKey(files)}`;
  if (cacheFile) {
    const c = readJson(cacheFile);
    if (c && c.key === key) return c.result;
  }
  const defaults = new Map();
  for (const s of sdk.slotNames) { const d = sdk.defaultFile(s); if (d) defaults.set(real(d), s); }
  const allow = new Set(allowFiles.map((f) => real(f)));
  const edges = [];
  const socketConsumers = {};
  const unknownSockets = [];
  const directives = {};
  const problems = [];
  for (const file of files) {
    const info = parseModule(file);
    const rf = real(file);
    directives[posix(path.relative(pkgDir, file))] = info.directive;
    for (const e of info.edges) {
      if (e.spec.startsWith(sdk.slotPackage + '/')) {
        const s = e.spec.slice(sdk.slotPackage.length + 1);
        if (sdk.slots[s]) (socketConsumers[s] ??= []).push(rf);
        else unknownSockets.push({ file: rf, slot: s });
        continue;
      }
      let slot = null;
      let how = null;
      if (e.spec.startsWith(sdk.originalSpecifier)) {
        slot = e.spec.slice(sdk.originalSpecifier.length).replace(/\.js$/, '');
        how = 'original';
      } else if (e.spec.startsWith('.')) {
        const target = resolveRelative(file, e.spec);
        if (target && target !== rf && defaults.has(target)) { slot = defaults.get(target); how = 'relative'; }
      }
      if (slot && sdk.slots[slot] && !allow.has(rf)) edges.push({ file: rf, display: file, spec: e.spec, slot, how });
    }
  }
  for (const e of edges) {
    const comp = path.basename(e.display).replace(/\.[^.]+$/, '');
    problems.push(`[F6] ${rel(e.display)} imports the default of slot "${e.slot}" directly ("${e.spec}"): overrides are NOT applied inside ${comp}. SDK bug: it must import "${sdk.slotPackage}/${e.slot}" (sdk-lint rejects this); ask the SDK team for a fixed release.`);
  }
  for (const u of unknownSockets)
    problems.push(`[F6] ${rel(u.file)} imports "${sdk.slotPackage}/${u.slot}", which is not a slot in ${sdk.name}@${sdk.version}'s slot-manifest.json: SDK bug (sdk-lint rejects this).`);
  const result = { problems, edges: edges.map(({ display, ...x }) => x), socketConsumers, unknownSockets, files: files.map(real), directives };
  if (cacheFile) writeIfChanged(cacheFile, JSON.stringify({ key, result }) + '\n');
  return result;
}
