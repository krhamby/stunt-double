// Small, dependency-free helpers shared by every core module. Everything here is synchronous on purpose:
// the core must be callable from ANY tool's config file, including synchronous CommonJS configs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

export const TOOL_NAME = 'stunt-double';
/** Source extensions an override (or anything it imports) may use. Order matters for "which file wins". */
export const SRC_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mts', '.mjs', '.cts', '.cjs'];

export const posix = (p) => p.split(path.sep).join('/');

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** JSON with comments and trailing commas (tsconfig, jsconfig). Strings are respected. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      i = i < 0 ? n : i + 2;
    } else {
      out += c;
      i++;
    }
  }
  // trailing commas before } or ] (outside strings: strings were copied verbatim, a comma+brace inside
  // a string would be rare in tsconfig and harmless to keep)
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

export function readJsonc(file) {
  try { return parseJsonc(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Write only when the bytes differ, so no tool sees a spurious change (HMR, persistent caches). */
export function writeIfChanged(file, content) {
  try { if (fs.readFileSync(file, 'utf8') === content) return false; } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

export function real(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

export const sha = (s, n = 12) => crypto.createHash('sha256').update(s).digest('hex').slice(0, n);

/** Escape a string for use inside a RegExp. */
export const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function lev(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Closest candidate within `max` edits (case-insensitive), or a candidate the name starts with ("Button.override"). */
export function nearest(name, candidates, max = 2) {
  const scored = candidates.map((c) => [c, lev(name, c)]).filter(([, d]) => d <= max).sort((x, y) => x[1] - y[1]);
  if (scored.length) return scored[0][0];
  const prefix = candidates.filter((c) => name.toLowerCase().startsWith(c.toLowerCase() + '.') || name.toLowerCase().startsWith(c.toLowerCase() + '-'));
  return prefix.sort((x, y) => y.length - x.length)[0];
}

/** true when `child` is `parent` or lies below it. */
export function isInside(child, parent) {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

/** A relative module specifier from a directory to a file, always starting with ./ or ../ */
export function relSpec(fromDir, to) {
  const r = posix(path.relative(fromDir, to));
  return r.startsWith('.') ? r : './' + r;
}

/** Recursively list files below dir, skipping node_modules and dot-directories. */
export function listFiles(dir, { exts = SRC_EXTS, skipDir = () => false } = {}) {
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || skipDir(f)) continue;
        walk(f);
      } else if (e.isFile() && (!exts || exts.some((x) => e.name.endsWith(x)))) out.push(f);
    }
  };
  walk(dir);
  return out;
}

/** Minimal glob -> RegExp for posix-relative paths: `**`, `*`, `?`. A glob without a wildcard matches a dir prefix too. */
export function globToRegExp(glob) {
  let g = posix(glob).replace(/^\.\//, '').replace(/\/$/, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += esc(c);
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}

/**
 * Locate `<name>/package.json` as seen from `fromDir`. Tries Node resolution first (works under pnpm and
 * Yarn PnP when running through the PnP runtime), then walks node_modules directories (packages whose
 * `exports` hide ./package.json).
 */
export function findPackageJson(name, fromDir) {
  const req = createRequire(path.join(fromDir, 'noop.js'));
  try { return req.resolve(`${name}/package.json`); } catch (e) {
    if (e && e.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  for (let d = path.resolve(fromDir); ; d = path.dirname(d)) {
    const f = path.join(d, 'node_modules', name, 'package.json');
    if (fs.existsSync(f)) return f;
    if (path.dirname(d) === d) return null;
  }
}

export function fileExists(f) {
  try { return fs.statSync(f).isFile(); } catch { return false; }
}

export function dirExists(f) {
  try { return fs.statSync(f).isDirectory(); } catch { return false; }
}

/** Strip a query/hash suffix and a leading \0 that bundlers attach to module ids. */
export function cleanId(id) {
  return String(id).replace(/^\0/, '').replace(/[?#].*$/, '');
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Collapse a message into something safe to embed in a module specifier (poison channel). */
export function poisonText(s, max = 180) {
  let t = String(s).replace(/[\/\\:?#"'`%<>|*\n\r\t{}$]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 4).trim() + ' ...';
  return t;
}
