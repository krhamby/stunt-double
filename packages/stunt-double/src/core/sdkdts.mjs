// SDK side (publish time): the PUBLISHED type declarations must never mention the socket package.
//
// Why: an app's tsc and IDE resolve `@acme/core-slots/X` to the registry placeholder (the adapter tier links
// nothing and edits no tsconfig), so a published `export { Button } from '@acme/core-slots/Button'` would type
// every slot export from the barrel as an error / `any`. Pointing the declarations at the originals instead makes
// app types work with zero configuration. The JavaScript keeps its socket imports: runtime is unaffected.
//
//   export { Button } from '@acme/core-slots/Button'   ->  export { Button } from './original/Button.js'
//   export { Logo } from '@acme/core-slots/Logo'        ->  export declare const Logo: import("react").ComponentType<
//     (required slot: the SDK ships no original)               import("./contracts.js").SlotProps["Logo"]>;
//
// Trade-off (documented): app code is typed by the SDK contract/original, so go-to-definition on `Button` lands on
// the SDK original, and props an override adds beyond the contract are not visible through '@acme/core'.
// `stunt-double why Button` shows the effective implementation.
//
// Used by `stunt-double sdk-lint --fix` (rewrite) and by sdk-lint's rule SDK6 (verify).
import fs from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { listFiles, posix, relSpec, globToRegExp, fileExists } from './util.mjs';

const DTS = /\.d\.[cm]?ts$/;

/** The .d.ts files the package publishes ("files" field when present, else everything but node_modules). */
export function publishedDtsFiles(pkgDir, pkg) {
  const all = listFiles(pkgDir, { exts: ['.d.ts', '.d.mts', '.d.cts'] });
  if (!Array.isArray(pkg?.files) || !pkg.files.length) return all;
  const res = pkg.files.map((f) => globToRegExp(String(f)));
  return all.filter((f) => res.some((re) => re.test(posix(path.relative(pkgDir, f)))));
}

/** The published contracts declaration: exports["./contracts"] types, else dist/contracts.d.ts. */
export function contractsDts(pkgDir, pkg) {
  const e = pkg?.exports?.['./contracts'];
  const t = typeof e === 'string' ? e : e?.types ?? e?.default;
  const candidates = [t, 'dist/contracts.d.ts', 'contracts.d.ts'].filter((x) => typeof x === 'string' && DTS.test(x));
  return candidates.map((c) => path.join(pkgDir, c)).find(fileExists) ?? null;
}

function blankComments(src, comments) {
  let out = src;
  for (const c of comments ?? []) out = out.slice(0, c.start) + ' '.repeat(c.end - c.start) + out.slice(c.end);
  return out;
}

/** Every remaining mention of the socket package in a declaration file (comments ignored). */
export function socketMentions(file, slotPackage, src = fs.readFileSync(file, 'utf8')) {
  let comments = [];
  try { comments = parseSync(file, src, { lang: 'dts' }).comments; } catch {}
  const text = blankComments(src, comments);
  const re = new RegExp(`(['"\`])(${slotPackage.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:/[^'"\`]*)?)\\1`, 'g');
  return [...text.matchAll(re)].map((m) => ({ spec: m[2], line: text.slice(0, m.index).split('\n').length }));
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const k of Object.keys(node)) if (k !== 'parent') walk(node[k], visit);
}

/**
 * Rewrite one declaration file. Returns { text, changed, errors }.
 * @param {object} o
 * @param {string} o.file
 * @param {string} o.pkgDir
 * @param {{ slotPackage: string, slots: Record<string, {default?: string, required?: boolean, export?: string}> }} o.manifest
 * @param {string|null} o.contracts  absolute path of the contracts .d.ts
 */
export function rewriteDtsFile({ file, pkgDir, manifest, contracts }) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = posix(path.relative(pkgDir, file));
  const errors = [];
  const sp = manifest.slotPackage;
  const slotOf = (spec) => (typeof spec === 'string' && spec.startsWith(sp + '/') ? spec.slice(sp.length + 1) : null);
  if (!src.includes(sp)) return { text: src, changed: false, errors };
  if (contracts && path.resolve(file) === path.resolve(contracts)) {
    // contracts must import props relatively (rule SDK3); rewriting would hide the authoring mistake
    return { text: src, changed: false, errors };
  }
  let parsed;
  try { parsed = parseSync(file, src, { lang: 'dts' }); } catch (e) { return { text: src, changed: false, errors: [`[SDK6] ${rel}: cannot parse (${e.message})`] }; }
  const dir = path.dirname(file);
  const exportOf = (s) => manifest.slots[s]?.export ?? s;
  const original = (s) => {
    const d = manifest.slots[s]?.default;
    if (!d) return null;
    const js = path.join(pkgDir, d);
    const dts = js.replace(/\.[cm]?jsx?$/, '.d.ts');
    if (!fileExists(dts)) { errors.push(`[SDK6] ${rel}: slot "${s}" default ${d} has no declaration file (${posix(path.relative(pkgDir, dts))}): emit declarations for the originals.`); return null; }
    return relSpec(dir, js.replace(/\.[cm]?jsx?$/, '.js'));
  };
  const contractType = (s) => {
    if (!contracts) { errors.push(`[SDK6] ${rel}: required slot "${s}" needs the published contracts (exports "./contracts" types) to declare its type.`); return 'never'; }
    const spec = relSpec(dir, contracts).replace(/\.d\.([cm]?)ts$/, '.$1js');
    return `import("react").ComponentType<import("${spec}").SlotProps[${JSON.stringify(s)}]>`;
  };
  const edits = [];
  const unknown = (s) => { errors.push(`[SDK2] ${rel}: references socket "${sp}/${s}", which is not a slot in slot-manifest.json.`); };
  for (const st of parsed.program.body) {
    const s = slotOf(st.source?.value);
    if (s === null) continue;
    if (!manifest.slots[s]) { unknown(s); continue; }
    const quote = src[st.source.start];
    const orig = original(s);
    if (orig) { edits.push([st.source.start, st.source.end, `${quote}${orig}${quote}`]); continue; }
    if (manifest.slots[s].default) continue; // error already reported
    // required slot: no original exists, so declare the binding from its contract
    const T = contractType(s);
    const decls = [];
    if (st.type === 'ImportDeclaration') {
      for (const x of st.specifiers ?? []) {
        if (x.type !== 'ImportSpecifier' || x.imported?.name !== exportOf(s)) { errors.push(`[SDK6] ${rel}: cannot rewrite ${src.slice(st.start, st.end).trim()} (only a named import of \`${exportOf(s)}\` is supported).`); continue; }
        decls.push(`declare const ${x.local.name}: ${T};`);
      }
    } else if (st.type === 'ExportNamedDeclaration') {
      for (const x of st.specifiers ?? []) {
        if (x.local?.name !== exportOf(s)) { errors.push(`[SDK6] ${rel}: cannot rewrite ${src.slice(st.start, st.end).trim()} (only \`${exportOf(s)}\` is exported by the socket).`); continue; }
        decls.push(`export declare const ${x.exported?.name ?? x.local.name}: ${T};`);
      }
    } else if (st.type === 'ExportAllDeclaration' && !st.exported) {
      decls.push(`export declare const ${exportOf(s)}: ${T};`);
    } else {
      errors.push(`[SDK6] ${rel}: cannot rewrite ${src.slice(st.start, st.end).trim()}.`);
      continue;
    }
    edits.push([st.start, st.end, decls.join('\n')]);
  }
  // import("<socket>/X") type queries (tsc emits them for inferred types)
  walk(parsed.program, (n) => {
    if (n.type !== 'TSImportType') return;
    const lit = n.source ?? n.argument?.literal ?? n.argument;
    const s = slotOf(lit?.value);
    if (s === null) return;
    if (!manifest.slots[s]) return void unknown(s);
    const orig = original(s);
    if (orig) edits.push([lit.start, lit.end, `${src[lit.start]}${orig}${src[lit.start]}`]);
    else if (!manifest.slots[s].default) errors.push(`[SDK6] ${rel}: ${src.slice(n.start, n.end)} refers to required slot "${s}" by inference: give that declaration an explicit type (e.g. SlotProps["${s}"]).`);
  });
  edits.sort((a, b) => b[0] - a[0]);
  let text = src;
  for (const [a, b, r] of edits) text = text.slice(0, a) + r + text.slice(b);
  return { text, changed: text !== src, errors };
}

/** Rewrite every published declaration file of the SDK package in place. Returns { written, errors }. */
export function rewriteSocketDts({ pkgDir, pkg, manifest }) {
  const contracts = contractsDts(pkgDir, pkg);
  const written = [];
  const errors = [];
  for (const file of publishedDtsFiles(pkgDir, pkg)) {
    const r = rewriteDtsFile({ file, pkgDir, manifest, contracts });
    errors.push(...r.errors);
    if (r.changed) { fs.writeFileSync(file, r.text); written.push(posix(path.relative(pkgDir, file))); }
  }
  return { written, errors };
}
