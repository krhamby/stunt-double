// One place that talks to oxc-parser: module edges (static, re-export, literal dynamic, CJS require),
// exported names and the "use client" directive.
import fs from 'node:fs';
import { parseSync } from 'oxc-parser';

const cache = new Map(); // file -> { mtimeMs, size, info }

function langOf(file) {
  if (/\.d\.[cm]?ts$/.test(file)) return 'dts';
  if (/\.tsx$/.test(file)) return 'tsx';
  if (/\.[cm]?ts$/.test(file)) return 'ts';
  return 'jsx'; // .js/.jsx/.mjs/.cjs: jsx is a superset that also parses plain JS
}

/**
 * @returns {{ error: string|null, edges: Array<{spec, kind:'import'|'export'|'dynamic'|'require', names: Array<{name, local, isType}>|null, typeOnly: boolean}>,
 *            exports: Set<string>, typeExports: Set<string>, star: string[], directive: string|null, src: string }}
 */
export function parseModule(file) {
  let st;
  try { st = fs.statSync(file); } catch { return { error: `cannot read ${file}`, edges: [], exports: new Set(), typeExports: new Set(), star: [], directive: null, src: '' }; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.info;
  const src = fs.readFileSync(file, 'utf8');
  const info = parseSource(file, src);
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

export function parseSource(file, src) {
  const res = parseSync(file, src, { lang: langOf(file), sourceType: 'unambiguous' });
  const m = res.module;
  const fatal = res.errors.filter((e) => e.severity === 'Error' || e.severity === undefined);
  const edges = [];
  for (const i of m.staticImports) {
    const names = i.entries.map((x) => ({
      name: x.importName.kind === 'Name' ? x.importName.name : x.importName.kind, // 'NamespaceObject' | 'Default'
      local: x.localName.value,
      isType: x.isType,
    }));
    edges.push({ spec: i.moduleRequest.value, kind: 'import', names, typeOnly: names.length > 0 && names.every((n) => n.isType) });
  }
  const exports = new Set();
  const typeExports = new Set();
  const star = [];
  for (const e of m.staticExports) for (const x of e.entries) {
    const exportName = x.exportName.kind === 'Name' ? x.exportName.name : x.exportName.kind === 'Default' ? 'default' : null;
    if (exportName) (x.isType ? typeExports : exports).add(exportName);
    if (x.moduleRequest) {
      if (x.importName.kind === 'AllButDefault' && !x.isType) star.push(x.moduleRequest.value);
      const name = x.importName.kind === 'Name' ? x.importName.name : x.importName.kind === 'All' ? 'NamespaceObject' : x.importName.kind;
      edges.push({ spec: x.moduleRequest.value, kind: 'export', names: [{ name, local: exportName, isType: x.isType }], typeOnly: x.isType });
    }
  }
  for (const d of m.dynamicImports) {
    const raw = src.slice(d.moduleRequest.start, d.moduleRequest.end).trim();
    const lit = /^(['"`])([^'"`$]*)\1$/.exec(raw);
    if (lit) edges.push({ spec: lit[2], kind: 'dynamic', names: null, typeOnly: false });
  }
  // CommonJS: best effort (documented limitation)
  if (!m.hasModuleSyntax && /\brequire\s*\(/.test(src))
    for (const r of src.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) edges.push({ spec: r[2], kind: 'require', names: null, typeOnly: false });
  return {
    error: fatal.length ? fatal[0].message : null,
    edges,
    exports,
    typeExports,
    star,
    directive: readDirective(src),
    src,
  };
}

/** The "use client" / "use server" prologue directive, if any (comments and other directives may precede it). */
export function readDirective(src) {
  const re = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|(['"])use strict\1\s*;?)*(['"])(use client|use server)\2/;
  const m = re.exec(src.replace(/^#![^\n]*/, ''));
  return m ? m[3] : null;
}
