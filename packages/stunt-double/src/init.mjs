// `stunt-double init`: wire a project in place. Every edit is a TEXT insertion (comments, formatting and
// quote style survive) and every step is idempotent: a second run changes nothing.
//
//   1. framework layout     React Router / Remix keep code in app/: write stunt-double.config.json for it
//   2. sdk-slots/package.json  the committed stub (no dependencies, no peers)
//   3. package.json         link line per package manager (replacing a registry placeholder), typescript for
//                           the type gate, postinstall + check scripts
//   4. .gitignore           generated files
//   5. tsconfig             "paths" for the slot package + the check file in "files" (solution-style aware)
//   6. overrides directory
//   7. tool configs         stuntDouble() into vite.config.* plugins (Vite, React Router) and into
//                           astro.config.* vite.plugins (Astro has no top-level plugins); hints for the rest
import fs from 'node:fs';
import path from 'node:path';
import { generate } from './core/generate.mjs';
import { formatProblems } from './core/diagnostics.mjs';
import { detectPackageManager, CONFIG_FILE, PACKAGE_KEY } from './core/config.mjs';
import { parseJsonc, posix, fileExists, dirExists } from './core/util.mjs';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const TSC_IN_SCRIPT = /(^|&&|;|\|\|)\s*(npx\s+)?(tsc|vue-tsc|tsgo)(\s|$)/;

/** Tool configs init knows. `edit` returns the new text, or null when it cannot place the adapter safely. */
const TOOLS = [
  { tool: 'vite', re: /^vite(st)?\.config\.(m|c)?[jt]s$/, edit: editViteConfig, hint: "plugins: [stuntDouble(), react()]  (import { stuntDouble } from 'stunt-double/vite')" },
  { tool: 'astro', re: /^astro\.config\.(m|c)?[jt]s$/, edit: editAstroConfig, hint: "vite: { plugins: [stuntDouble()] }  (import { stuntDouble } from 'stunt-double/vite')" },
  { tool: 'next', re: /^next\.config\.(m|c)?[jt]s$/, hint: "export default withStuntDouble(nextConfig)  (import { withStuntDouble } from 'stunt-double/next')" },
  { tool: 'webpack', re: /^(webpack|rspack|rsbuild|craco)\.config\.(m|c)?[jt]s$/, hint: "export default withStuntDouble(config)  (import { withStuntDouble } from 'stunt-double/webpack')" },
  { tool: 'jest', re: /^jest\.config\.(m|c)?[jt]s$/, hint: "export default withStuntDouble(config)  (import { withStuntDouble } from 'stunt-double/jest')" },
  { tool: 'metro', re: /^metro\.config\.(m|c)?js$/, hint: "module.exports = withStuntDouble(getDefaultConfig(__dirname))  (require('stunt-double/metro'))" },
  { tool: 'rollup/rolldown', re: /^(rollup|rolldown)\.config\.(m|c)?[jt]s$/, hint: "plugins: [stuntDouble()]  (import { stuntDouble } from 'stunt-double/vite')" },
];

/**
 * @param {{ root: string, out?: (s: string) => void, err?: (s: string) => void }} o
 * @returns {Promise<number>} exit code
 */
export async function runInit({ root: rootIn, out = (s) => process.stdout.write(s + '\n'), err = (s) => process.stderr.write(s + '\n') }) {
  const root = path.resolve(rootIn ?? process.cwd());
  const pkgFile = path.join(root, 'package.json');
  if (!fileExists(pkgFile)) { err('stunt-double init: no package.json here.'); return 1; }
  const pkgText = fs.readFileSync(pkgFile, 'utf8');
  const pkg = JSON.parse(pkgText);
  const pm = detectPackageManager(root);
  const done = [];
  const todo = [];

  // 1. framework layout (before generate(), which reads the config)
  const layout = detectLayout(root, pkg);
  const cfgFile = path.join(root, CONFIG_FILE);
  let wroteCfg = false;
  if (layout.appDir && !fileExists(cfgFile) && !pkg[PACKAGE_KEY]) {
    wroteCfg = true;
    const cfg = { overridesDir: `${layout.appDir}/overrides`, checkFile: `${layout.appDir}/stunt-double.check.ts`, sourceDirs: [layout.appDir] };
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    done.push(`wrote ${CONFIG_FILE} (${layout.why}: overrides in ${cfg.overridesDir}/)`);
  }

  const p0 = generate({ root, onError: 'return', write: false });
  if (!p0.sdk) { err(formatProblems(p0)); err('stunt-double init: install the SDK first.'); return 1; }
  const sdk = p0.sdk;
  if (wroteCfg) addSchema(cfgFile, sdk);
  const slotsRel = posix(path.relative(root, p0.slotsDir));

  // 2. committed stub
  const stub = path.join(p0.slotsDir, 'package.json');
  if (!fileExists(stub)) {
    fs.mkdirSync(p0.slotsDir, { recursive: true });
    fs.writeFileSync(stub, JSON.stringify({
      name: sdk.slotPackage, version: '0.0.0', private: true, type: 'module', sideEffects: false,
      description: `Generated slot package for ${sdk.name} (stunt-double). Commit this file; gen/ is generated (npx stunt-double gen). No dependencies or peers, ever.`,
      exports: { './package.json': './package.json', './*': { types: './gen/*.d.ts', default: './gen/*.jsx' } },
    }, null, 2) + '\n');
    done.push(`wrote ${slotsRel}/package.json (committed stub, no dependencies or peers)`);
  }

  // 3. package.json: link line, typescript, scripts
  const line = { npm: `file:./${slotsRel}`, pnpm: `link:./${slotsRel}`, yarn: `portal:./${slotsRel}`, bun: 'workspace:*' }[pm] ?? `file:./${slotsRel}`;
  const field = DEP_FIELDS.find((f) => pkg[f]?.[sdk.slotPackage]);
  const spec = field ? pkg[field][sdk.slotPackage] : null;
  if (!spec) {
    (pkg.dependencies ??= {})[sdk.slotPackage] = line;
    done.push(`dependency "${sdk.slotPackage}": "${line}" (${pm})`);
  } else if (!linksTo(spec, root, p0.slotsDir)) {
    // a registry spec or a tarball (the SDK's placeholder package): the SDK would resolve it, never the shims
    pkg[field][sdk.slotPackage] = line;
    done.push(`${field} "${sdk.slotPackage}": "${spec}" -> "${line}" (the registry placeholder must be replaced by the link, ${pm})`);
  }
  if (pm === 'bun') {
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces ??= []);
    if (Array.isArray(ws) && !ws.includes(slotsRel)) { ws.push(slotsRel); done.push(`workspaces += ${slotsRel}`); }
  }
  const tsName = p0.cfg.typescript ?? 'typescript';
  if (!DEP_FIELDS.some((f) => pkg[f]?.[tsName]) && !installedUpwards(tsName, root)) {
    const range = tsName !== 'typescript' ? 'npm:typescript@^5.9.3' : pm === 'yarn' && p0.isPnP ? '^5.9.3' : '^7.0.2';
    (pkg.devDependencies ??= {})[tsName] = range;
    done.push(`devDependency "${tsName}": "${range}" (the build's contract type gate runs tsc)`);
  }
  pkg.scripts ??= {};
  if (!/stunt-double\s+gen/.test(pkg.scripts.postinstall ?? '')) {
    pkg.scripts.postinstall = pkg.scripts.postinstall ? `${pkg.scripts.postinstall} && stunt-double gen --no-fail` : 'stunt-double gen --no-fail';
    done.push('script postinstall: stunt-double gen --no-fail');
  }
  if (!pkg.scripts.check) { pkg.scripts.check = 'stunt-double check'; done.push('script check: stunt-double check'); }
  // `tsc -b && vite build` (Vite template), `react-router typegen && tsc`: tsc runs before any adapter, so it
  // would see a stale or missing check file (TS6053) or report raw check-file TS2322 lines instead of the [F*]
  // report. `stunt-double check` regenerates and runs the mapped contract gate first.
  for (const [name, script] of Object.entries(pkg.scripts)) {
    if (name === 'postinstall' || /stunt-double/.test(script) || !TSC_IN_SCRIPT.test(script)) continue;
    pkg.scripts[name] = `stunt-double check && ${script}`;
    done.push(`script ${name}: stunt-double check && ${script}`);
  }
  const indent = /^\{\r?\n([ \t]+)"/.exec(pkgText)?.[1] ?? '  ';
  const nextPkg = JSON.stringify(pkg, null, indent) + (pkgText.endsWith('\n') ? '\n' : '');
  if (nextPkg !== pkgText) fs.writeFileSync(pkgFile, nextPkg);

  // 4. .gitignore
  const giFile = path.join(root, '.gitignore');
  const gi = fileExists(giFile) ? fs.readFileSync(giFile, 'utf8') : '';
  const have = new Set(gi.split(/\r?\n/).map((l) => l.trim().replace(/^\//, '')));
  const wantGi = [`${slotsRel}/gen/`, posix(path.relative(root, p0.checkFile))].filter((l) => !have.has(l));
  if (wantGi.length) {
    fs.writeFileSync(giFile, `${gi}${gi && !gi.endsWith('\n') ? '\n' : ''}${gi ? '\n' : ''}# stunt-double (generated)\n${wantGi.join('\n')}\n`);
    done.push(`.gitignore += ${wantGi.join(', ')}`);
  }

  // 5. tsconfig paths + files
  const tsFile = p0.tsconfig;
  const tsDir = tsFile ? path.dirname(tsFile) : root;
  const checkRel = posix(path.relative(tsDir, p0.checkFile));
  const genGlob = `./${posix(path.relative(tsDir, p0.genDir))}/*`;
  if (tsFile) {
    const r = editTsconfig(tsFile, sdk.slotPackage, genGlob, checkRel);
    if (r.changes.length) done.push(`${p0.rel(tsFile)}: ${r.changes.join(', ')}`);
    if (!r.ok) todo.push(`add to ${p0.rel(tsFile)}: "compilerOptions": {"paths": {"${sdk.slotPackage}/*": ["${genGlob}"]}} and "files": ["${checkRel}"]`);
  } else {
    todo.push(`create a tsconfig.json with "compilerOptions": {"paths": {"${sdk.slotPackage}/*": ["${genGlob}"]}} and "files": ["${checkRel}"]`);
  }

  // 6. overrides dir
  if (!dirExists(p0.overridesDir)) {
    fs.mkdirSync(p0.overridesDir, { recursive: true });
    fs.writeFileSync(path.join(p0.overridesDir, '.gitkeep'), '');
    done.push(`created ${p0.rel(p0.overridesDir)}/`);
  }

  // 7. tool configs
  for (const f of fs.readdirSync(root).sort()) {
    const t = TOOLS.find((x) => x.re.test(f));
    if (!t) continue;
    const file = path.join(root, f);
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('stunt-double')) continue;
    const next = t.edit?.(text);
    if (next) { fs.writeFileSync(file, next); done.push(`${f}: added stuntDouble() to ${t.tool === 'astro' ? 'vite.plugins' : 'plugins'}`); }
    else todo.push(`${f}: ${t.hint}`);
  }

  for (const d of done) out(`  + ${d}`);
  for (const t of todo) out(`  ! TODO ${t}`);
  if (!done.length && !todo.length) { out('stunt-double init: already wired, nothing to change.'); return 0; }
  const required = sdk.slotNames.filter((s) => sdk.slots[s].required && !p0.table[s]?.impl);
  out(`stunt-double init: done. Next: ${pm} install (links ${sdk.slotPackage} and runs stunt-double gen), then put overrides in ${p0.rel(p0.overridesDir)}/ (npx stunt-double eject <Slot>).`);
  if (required.length) out(`  required slots without an implementation (every build fails with [F3] until they exist): ${required.map((s) => `${s} (npx stunt-double eject ${s})`).join(', ')}`);
  return 0;
}

/** Is `spec` a link to the slots directory (npm file:, pnpm link:, Yarn portal:, Bun workspace:)? A file: TARBALL is a copy. */
export function linksTo(spec, root, slotsDir) {
  if (/^workspace:/.test(spec)) return true;
  const m = /^(file:|link:|portal:)(.*)$/.exec(spec);
  return !!m && path.resolve(root, m[2]) === path.resolve(slotsDir);
}

/** Installed in node_modules of the project or an ancestor (a workspace root)? NODE_PATH / globals do not count. */
function installedUpwards(name, root) {
  for (let d = root; ; d = path.dirname(d)) {
    if (fileExists(path.join(d, 'node_modules', name, 'package.json'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// layout

/** React Router 7/8 framework mode and Remix keep application code in app/ (react-router.config appDirectory). */
export function detectLayout(root, pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const rrConfig = fs.readdirSync(root).find((f) => /^react-router\.config\.(m|c)?[jt]s$/.test(f));
  if (rrConfig || deps['@react-router/dev'] || deps['@remix-run/dev']) {
    const text = rrConfig ? fs.readFileSync(path.join(root, rrConfig), 'utf8') : '';
    const appDir = (/appDirectory\s*:\s*['"`]([^'"`]+)['"`]/.exec(stripJsComments(text))?.[1] ?? 'app').replace(/^\.\//, '').replace(/\/$/, '');
    return { appDir, why: rrConfig ? `${rrConfig} appDirectory` : 'React Router / Remix app directory' };
  }
  if (!dirExists(path.join(root, 'src')) && dirExists(path.join(root, 'app'))) return { appDir: 'app', why: 'no src/, code lives in app/' };
  return { appDir: null };
}

/** Put "$schema" (slot-name autocompletion) and "sdk" first in the config file init just wrote. */
function addSchema(cfgFile, sdk) {
  const text = fs.readFileSync(cfgFile, 'utf8');
  let json;
  try { json = parseJsonc(text); } catch { return; }
  const schema = path.join(sdk.dir, 'stunt-double.schema.json');
  const head = { ...(fileExists(schema) ? { $schema: `./node_modules/${sdk.name}/stunt-double.schema.json` } : {}), sdk: sdk.name };
  fs.writeFileSync(cfgFile, JSON.stringify({ ...head, ...json }, null, 2) + '\n');
}

// ---------------------------------------------------------------------------------------------------------
// JSONC text editing (tsconfig): find containers by key path, skipping strings and comments

/** Map "key.path" -> index of the `{` / `[` that opens that value ('' = the root object). */
export function jsoncContainers(text) {
  const found = new Map();
  const stack = [];
  let lastString = null;
  let pendingKey = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      try { lastString = JSON.parse(text.slice(i, j + 1)); } catch { lastString = text.slice(i + 1, j); }
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? text.length : e + 1;
    } else if (c === ':') {
      pendingKey = lastString;
    } else if (c === '{' || c === '[') {
      const parent = stack.at(-1);
      const keyPath = !parent ? [] : parent.type === '{' ? [...parent.path, pendingKey] : [...parent.path, '#'];
      const k = keyPath.join('\u0000');
      if (!found.has(k)) found.set(k, i);
      stack.push({ type: c, path: keyPath });
      pendingKey = null;
    } else if (c === '}' || c === ']') {
      stack.pop();
    } else if (c === ',') {
      pendingKey = null;
    }
  }
  return { get: (...keys) => found.get(keys.join('\u0000')) };
}

/** Index of the next significant (non-space, non-comment) character after `i`. */
function nextSignificant(text, i) {
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (/\s/.test(c)) continue;
    if (c === '/' && text[j + 1] === '/') { while (j < text.length && text[j] !== '\n') j++; continue; }
    if (c === '/' && text[j + 1] === '*') { const e = text.indexOf('*/', j + 2); j = e < 0 ? text.length : e + 1; continue; }
    return j;
  }
  return text.length;
}

/** Indentation for a new member of the container opened at `open` (copied from its first member). */
function memberIndent(text, open, fallback) {
  const lineStart = text.lastIndexOf('\n', open) + 1;
  const own = /^[ \t]*/.exec(text.slice(lineStart))[0];
  const m = /^[^\S\n]*\n([ \t]+)\S/.exec(text.slice(open + 1));
  return m ? m[1] : own + fallback;
}

/** Insert `member` as the first member of the object/array opened at `open`. */
function insertMember(text, open, member, multiline = true) {
  const empty = text[nextSignificant(text, open + 1)] === (text[open] === '{' ? '}' : ']');
  if (!multiline) return text.slice(0, open + 1) + member + (empty ? '' : ', ') + text.slice(open + 1);
  const ind = memberIndent(text, open, '  ');
  return text.slice(0, open + 1) + `\n${ind}${member}${empty ? '\n' : ','}` + text.slice(open + 1);
}

/** Add the slot "paths" entry and the check file to a tsconfig by TEXT insertion, so comments survive. */
export function editTsconfig(file, slotPackage, genGlob, checkRel) {
  const dir = path.dirname(file);
  const original = fs.readFileSync(file, 'utf8');
  let text = original;
  let json;
  try { json = parseJsonc(text); } catch { return { ok: false, changes: [] }; }
  const changes = [];
  const key = `${slotPackage}/*`;
  if (!json.compilerOptions?.paths?.[key]) {
    const at = jsoncContainers(text);
    const entry = `"${key}": ["${genGlob}"]`;
    if (at.get('compilerOptions', 'paths') !== undefined) text = insertMember(text, at.get('compilerOptions', 'paths'), entry);
    else if (at.get('compilerOptions') !== undefined) text = insertMember(text, at.get('compilerOptions'), `/* stunt-double: types follow the generated shims, even inside node_modules/${slotPackage.split('/')[0]} */\n${memberIndent(text, at.get('compilerOptions'), '  ')}"paths": { ${entry} }`);
    else if (at.get() !== undefined) text = insertMember(text, at.get(), `"compilerOptions": { "paths": { ${entry} } }`);
    changes.push(`paths "${key}"`);
  }
  if (!(json.files ?? []).some((f) => path.resolve(dir, f) === path.resolve(dir, checkRel))) {
    const at = jsoncContainers(text);
    const open = at.get('files');
    if (open !== undefined) text = insertMember(text, open, `"${checkRel}"`, text.slice(open, text.indexOf(']', open)).includes('\n'));
    else if (at.get() !== undefined) text = insertMember(text, at.get(), `/* stunt-double: a missing generated check file is TS6053, never "silently unchecked" */\n${memberIndent(text, at.get(), '  ')}"files": ["${checkRel}"]`);
    changes.push(`files "${checkRel}"`);
  }
  let after;
  try { after = parseJsonc(text); } catch { return { ok: false, changes: [] }; }
  if (!after.compilerOptions?.paths?.[key] || !(after.files ?? []).some((f) => path.resolve(dir, f) === path.resolve(dir, checkRel))) return { ok: false, changes: [] };
  if (text !== original) fs.writeFileSync(file, text);
  return { ok: true, changes };
}

// ---------------------------------------------------------------------------------------------------------
// JS config editing (vite / astro)

function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

/** Add `import { stuntDouble } from 'stunt-double/vite'` after the last import, in the file's own style. */
export function addImport(text) {
  const code = stripJsComments(text);
  const re = /^import\s+(?:[^'"`;]*?\s+from\s+)?(['"])[^'"]+\1[ \t]*(;?)/gm;
  let last = null;
  let m;
  while ((m = re.exec(code))) last = m;
  const q = last?.[1] ?? (/^import[^\n]*"/m.test(code) ? '"' : "'");
  const semi = last ? last[2] : ';';
  const stmt = `import { stuntDouble } from ${q}stunt-double/vite${q}${semi}`;
  if (!last) {
    const lead = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/.exec(text)[0];
    return text.slice(0, lead.length) + stmt + '\n' + text.slice(lead.length);
  }
  const end = last.index + last[0].length;
  return text.slice(0, end) + '\n' + stmt + text.slice(end);
}

/** vite.config.*: first entry of `plugins: [` (enforce:'pre' makes the order irrelevant), else a new key. */
export function editViteConfig(text) {
  const code = stripJsComments(text);
  const pl = /\bplugins\s*:\s*\[/.exec(code);
  let next;
  if (pl) next = insertAt(text, pl.index + pl[0].length, 'stuntDouble(), ');
  else {
    const dc = /\bdefineConfig\(\s*\{/.exec(code) ?? /\bexport\s+default\s*\{/.exec(code);
    if (!dc) return null;
    next = insertAt(text, dc.index + dc[0].length, '\n  plugins: [stuntDouble()],');
  }
  return addImport(next);
}

/** astro.config.*: Astro has no top-level `plugins`; the Vite plugin goes into `vite: { plugins: [...] }`. */
export function editAstroConfig(text) {
  const code = stripJsComments(text);
  const vite = /\bvite\s*:\s*\{/.exec(code);
  let next;
  if (vite) {
    const body = code.slice(vite.index + vite[0].length, matchBrace(code, vite.index + vite[0].length - 1));
    const pl = /\bplugins\s*:\s*\[/.exec(body);
    const at = vite.index + vite[0].length;
    next = pl ? insertAt(text, at + pl.index + pl[0].length, 'stuntDouble(), ') : insertAt(text, at, ' plugins: [stuntDouble()],');
  } else {
    const dc = /\bdefineConfig\(\s*\{/.exec(code) ?? /\bexport\s+default\s*\{/.exec(code);
    if (!dc) return null;
    const at = dc.index + dc[0].length;
    const empty = code[nextSignificant(code, at)] === '}';
    next = insertAt(text, at, empty ? '\n  vite: { plugins: [stuntDouble()] },\n' : '\n  vite: { plugins: [stuntDouble()] },');
  }
  return addImport(next);
}

function insertAt(text, at, s) { // offsets come from comment-stripped code of the same length
  return text.slice(0, at) + s + text.slice(at);
}

function matchBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < code.length && code[i] !== q) i += code[i] === '\\' ? 2 : 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return code.length;
}
