// Static tsconfig reading: which app tsconfig owns the check file (solution-style aware) and whether its
// program actually includes the check file (X2). No TypeScript API involved, so it works for TS 5.9 and 7.
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJsonc, posix, globToRegExp, fileExists, dirExists } from './util.mjs';

function resolveExtends(spec, fromFile) {
  if (spec.startsWith('.') || path.isAbsolute(spec)) {
    const f = path.resolve(path.dirname(fromFile), spec);
    return fileExists(f) ? f : fileExists(f + '.json') ? f + '.json' : f;
  }
  const req = createRequire(fromFile);
  for (const s of [spec, `${spec}.json`, `${spec}/tsconfig.json`]) { try { return req.resolve(s); } catch {} }
  return null;
}

/**
 * Read a tsconfig and its `extends` chain. Returns { file, json, files, include, exclude, baseDirs, compilerOptions, references }.
 * files/include/exclude are resolved against the config that declared them (TypeScript semantics).
 */
export function readTsconfig(file, seen = new Set()) {
  const json = readJsonc(file);
  if (!json) return null;
  seen.add(file);
  let base = { files: undefined, include: undefined, exclude: undefined, compilerOptions: {} };
  const ext = Array.isArray(json.extends) ? json.extends : json.extends ? [json.extends] : [];
  for (const e of ext) {
    const f = resolveExtends(e, file);
    if (!f || seen.has(f)) continue;
    const b = readTsconfig(f, seen);
    if (!b) continue;
    base = {
      files: b.files ?? base.files,
      include: b.include ?? base.include,
      exclude: b.exclude ?? base.exclude,
      compilerOptions: { ...base.compilerOptions, ...b.compilerOptions },
    };
  }
  const dir = path.dirname(file);
  const abs = (list) => list.map((x) => path.resolve(dir, x));
  return {
    file,
    json,
    files: json.files ? abs(json.files) : base.files,
    include: json.include ? abs(json.include) : base.include,
    exclude: json.exclude ? abs(json.exclude) : base.exclude,
    compilerOptions: { ...base.compilerOptions, ...(json.compilerOptions ?? {}) },
    references: json.references ?? [],
  };
}

const TS_EXT = /\.(ts|tsx|mts|cts)$/;

/** Does the program described by `tsconfigFile` contain `absFile`? (files, include, exclude; default include "**\/*") */
export function tsconfigCovers(tsconfigFile, absFile) {
  const t = readTsconfig(tsconfigFile);
  if (!t) return false;
  const want = path.resolve(absFile);
  if ((t.files ?? []).some((f) => path.resolve(f) === want)) return true;
  const include = t.include ?? (t.files ? [] : [path.join(path.dirname(tsconfigFile), '**/*')]);
  const match = (patterns) => patterns.some((pat) => {
    const r = posix(path.relative(path.parse(pat).root, pat));
    const target = posix(path.relative(path.parse(want).root, want));
    // "src" (a directory without wildcards) means src/**/*
    if (!/[*?]/.test(r) && dirExists(pat)) return target.startsWith(r.replace(/\/$/, '') + '/');
    return globToRegExp(r).test(target);
  });
  if (!TS_EXT.test(want) || !match(include)) return false;
  const exclude = t.exclude ?? [];
  return !match(exclude);
}

/**
 * Pick the app tsconfig: the one whose program owns the overrides. The type gate's tsconfig extends it, and
 * `init --editor` adds the check file to it. Explicit config wins. A solution-style tsconfig.json (`files: []` +
 * references, as in the Vite templates) delegates to the first referenced config covering the overrides dir.
 */
export function pickAppTsconfig(root, explicit, overridesDir) {
  if (explicit) return path.resolve(root, explicit);
  const main = path.join(root, 'tsconfig.json');
  if (!fileExists(main)) return null;
  const t = readTsconfig(main);
  const solution = t && t.references.length && Array.isArray(t.json.files) && t.json.files.length === 0 && !t.json.include;
  if (!solution) return main;
  const probe = path.join(overridesDir, '__stunt_double_probe__.tsx');
  const refs = t.references.map((ref) => {
    let f = path.resolve(root, ref.path);
    if (dirExists(f)) f = path.join(f, 'tsconfig.json');
    return f;
  }).filter(fileExists);
  const owner = refs.find((f) => tsconfigCovers(f, probe));
  if (owner) return owner;
  const app = path.join(root, 'tsconfig.app.json');
  return fileExists(app) ? app : refs[0] ?? main;
}
