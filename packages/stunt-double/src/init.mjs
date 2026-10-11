// `stunt-double init`: OPTIONAL extras only. The default setup (install, one plugin line, src/overrides/) never
// needs it. Every extra is opt-in by flag, idempotent, and prints each change; anything it cannot edit safely is
// printed as a "! TODO" line instead.
//
//   --plugin     add stuntDouble() to the Vite config (after react(); order does not matter)
//   --editor     contract errors in the editor and the project's own tsc: the check file goes into the app
//                tsconfig "files", plus a "postinstall": "stunt-double gen --no-fail" so a fresh clone has the
//                file before tsc runs (never TS6053)
//   --ci         "check": "stunt-double check" in package.json scripts
//   --universal  tools without an adapter: link the slot package to a committed stub (sdk-slots/); generated
//                files then live there (the link target is the outDir)
import fs from 'node:fs';
import path from 'node:path';
import { generate, DEFAULT_OUT_DIR, CHECK_FILE } from './core/generate.mjs';
import { formatProblems } from './core/diagnostics.mjs';
import { detectPackageManager } from './core/config.mjs';
import { readTsconfig } from './core/tsconfig.mjs';
import { gitignoreFor } from './core/emit.mjs';
import { readJson, parseJsonc, posix, fileExists } from './core/util.mjs';

export const INIT_FLAGS = ['plugin', 'editor', 'ci', 'universal'];
export const UNIVERSAL_DIR = 'sdk-slots';

export const TOOL_CONFIGS = [
  { tool: 'vite', re: /^vite(st)?\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/vite', hint: "plugins: [react(), stuntDouble()]  (import { stuntDouble } from 'stunt-double/vite')" },
  { tool: 'next', re: /^next\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/next', hint: "export default withStuntDouble(nextConfig)  (import { withStuntDouble } from 'stunt-double/next')" },
  { tool: 'webpack', re: /^(webpack|rspack|rsbuild|craco)\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/webpack', hint: "export default withStuntDouble(config)  (import { withStuntDouble } from 'stunt-double/webpack')" },
  { tool: 'jest', re: /^jest\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/jest', hint: "export default withStuntDouble(config)  (import { withStuntDouble } from 'stunt-double/jest')" },
  { tool: 'metro', re: /^metro\.config\.(m|c)?js$/, adapter: 'stunt-double/metro', hint: "module.exports = withStuntDouble(getDefaultConfig(__dirname))  (require('stunt-double/metro'))" },
  { tool: 'rollup/rolldown', re: /^(rollup|rolldown)\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/vite', hint: "plugins: [stuntDouble()]  (import { stuntDouble } from 'stunt-double/vite')" },
];

/** Index of the bracket that closes the one opening at `open` (strings, template literals and comments skipped). */
function matching(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; for (i++; i < text.length && text[i] !== q; i++) if (text[i] === '\\') i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') { if (stack.pop() !== c) return -1; if (!stack.length) return i; }
  }
  return -1;
}

/** Insert `stuntDouble()` into the first `plugins: [...]` array: right after react(...) if present, else last. */
export function addVitePlugin(text) {
  const m = /plugins\s*:\s*\[/.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matching(text, open);
  if (close < 0) return null;
  const body = text.slice(open + 1, close);
  let at = -1;
  const r = /(^|[\s,[(])react\s*\(/g;
  for (let x; (x = r.exec(body)); ) {
    const paren = open + 1 + x.index + x[0].length - 1;
    const end = matching(text, paren);
    if (end > 0 && end < close) { at = end + 1; break; }
  }
  let next;
  if (at > 0) next = text.slice(0, at) + ', stuntDouble()' + text.slice(at);
  else if (!body.trim()) next = text.slice(0, open + 1) + 'stuntDouble()' + text.slice(close);
  else {
    const trimmed = body.replace(/\s+$/, '');
    const end = open + 1 + trimmed.length;
    next = text.slice(0, end) + (trimmed.endsWith(',') ? ' ' : ', ') + 'stuntDouble()' + text.slice(end);
  }
  const imports = [...next.matchAll(/^import[^;]*?from\s*['"][^'"]+['"];?[ \t]*$/gm)];
  const ip = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
  const semi = imports.length ? (/;\s*$/.test(imports.at(-1)[0]) ? ';' : '') : ';';
  return next.slice(0, ip) + `${ip ? '\n' : ''}import { stuntDouble } from 'stunt-double/vite'${semi}${ip ? '' : '\n'}` + next.slice(ip);
}

function insertAfter(text, re, insertion) {
  const m = re.exec(text);
  if (!m) return null;
  return text.slice(0, m.index + m[0].length) + insertion + text.slice(m.index + m[0].length);
}

/**
 * Add `checkRel` to a tsconfig's "files" by TEXT insertion (comments survive). Adding "files" to a config that
 * has neither "files" nor "include" (own or inherited) would shrink its program to that one file, so the default
 * include is then written out explicitly. Returns { ok, change, todo }.
 */
export function addCheckFile(file, checkRel, replaceRel = null) {
  let text = fs.readFileSync(file, 'utf8');
  let json;
  try { json = parseJsonc(text); } catch { return { ok: false, todo: `${path.basename(file)} is not valid JSON: add "${checkRel}" to its "files" by hand` }; }
  const eff = readTsconfig(file);
  const dir = path.dirname(file);
  const want = path.resolve(dir, checkRel);
  const own = Array.isArray(json.files) ? json.files : null;
  if (own?.some((f) => path.resolve(dir, f) === want)) return { ok: true, change: null };
  if (replaceRel && own?.some((f) => path.resolve(dir, f) === path.resolve(dir, replaceRel))) {
    const re = new RegExp(`(["'])${replaceRel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\1`);
    const next = text.replace(re, `"${checkRel}"`);
    if (next !== text) { fs.writeFileSync(file, next); return { ok: true, change: `"files": "${replaceRel}" -> "${checkRel}"` }; }
  }
  let next;
  if (own) next = insertAfter(text, /"files"\s*:\s*\[/, `"${checkRel}"${own.length ? ', ' : ''}`);
  else if (eff?.files) return { ok: false, todo: `${path.basename(file)} inherits "files" from its base config: add "${checkRel}" to the list by hand` };
  else next = insertAfter(text, /^\s*\{/, `\n  "files": ["${checkRel}"],${eff?.include ? '' : '\n  "include": ["**/*"],'}`);
  try { if (!next) throw new Error(); parseJsonc(next); } catch { return { ok: false, todo: `add "${checkRel}" to "files" in ${path.basename(file)}` }; }
  fs.writeFileSync(file, next);
  return { ok: true, change: `"files" += "${checkRel}"${!own && !eff?.include ? ' (and the default "include": ["**/*"], which "files" would otherwise turn off)' : ''}` };
}

function addScript(pkg, name, cmd, done, todo) {
  pkg.scripts ??= {};
  const cur = pkg.scripts[name];
  if (cur && cur.includes(cmd)) return;
  if (name === 'postinstall') {
    pkg.scripts.postinstall = cur ? `${cur} && ${cmd}` : cmd;
    done.push(`package.json script postinstall: ${pkg.scripts.postinstall}`);
    return;
  }
  if (!cur) { pkg.scripts[name] = cmd; done.push(`package.json script ${name}: ${cmd}`); return; }
  const alt = `${name}:slots`;
  if (pkg.scripts[alt]?.includes(cmd)) return;
  if (!pkg.scripts[alt]) { pkg.scripts[alt] = cmd; done.push(`package.json script ${alt}: ${cmd} ("${name}" is taken)`); return; }
  todo.push(`add a script running "${cmd}" to package.json`);
}

/** Status of the default setup, for `init` without flags. */
function status(root, p, out) {
  const configs = fs.readdirSync(root).filter((f) => TOOL_CONFIGS.some((t) => t.re.test(f)));
  if (!configs.length) out(`  !   no tool config found (vite.config.ts, ...): add the stunt-double adapter to the tool that builds your app`);
  for (const f of configs) {
    const t = TOOL_CONFIGS.find((x) => x.re.test(f));
    const has = fs.readFileSync(path.join(root, f), 'utf8').includes('stunt-double');
    out(has ? `  ok  ${f} uses ${t.adapter}` : `  !   ${f} does not use ${t.adapter}: ${t.hint}${t.tool === 'vite' ? ' (or: npx stunt-double init --plugin)' : ''}`);
  }
  if (p?.sdk) {
    const n = Object.values(p.table).filter((e) => e.impl?.source === 'app').length;
    out(fs.existsSync(p.overridesDir) ? `  ok  ${p.rel(p.overridesDir)}/: ${n} of ${p.slots.length} slots of ${p.sdk.name}@${p.sdk.version} overridden` : `  -   ${p.rel(p.overridesDir)}/ does not exist yet: every slot renders the ${p.sdk.name} default`);
    out(`  ok  generated files: ${p.rel(p.outDir)}/ (${p.tier === 'universal' ? 'universal tier: the linked slot package' : 'self-ignoring; never edit'})`);
  }
}

export async function cmdInit(a, { out, err }) {
  const root = path.resolve(a.values.root ?? process.cwd());
  const pkgFile = path.join(root, 'package.json');
  const pkg = readJson(pkgFile);
  if (!pkg) { err('stunt-double init: no package.json here.'); return 1; }
  const want = new Set(INIT_FLAGS.filter((f) => a.flags.has(f)));
  const pm = detectPackageManager(root);
  const p0 = generate({ root, ...(a.values.config ? { configFile: a.values.config } : {}), onError: 'return', write: false });
  if (!want.size) {
    out('stunt-double init: the default setup needs no init (install, one plugin line, overrides in src/overrides/).');
    status(root, p0, out);
    if (!p0.sdk) err(formatProblems(p0));
    const sdkSlots = p0.sdk?.slotPackage ?? '<sdk>-slots';
    const checkRel = p0.tsconfig ? posix(path.relative(root, path.join(root, DEFAULT_OUT_DIR, CHECK_FILE))) : `${DEFAULT_OUT_DIR}/${CHECK_FILE}`;
    out(`Optional extras (add any by flag; safe to re-run):`);
    out(`  --plugin     add stuntDouble() to the Vite config`);
    out(`  --editor     contract errors in your editor and tsc: adds ${p0.tier === 'universal' ? `${UNIVERSAL_DIR}/${CHECK_FILE}` : checkRel} to ${p0.tsconfigRel ?? 'tsconfig.json'} "files", and "postinstall": "stunt-double gen --no-fail" so a fresh clone has it before tsc runs`);
    out(`  --ci         add "check": "stunt-double check" to package.json scripts (run it in CI before the build)`);
    out(`  --universal  tools without a stunt-double adapter: link ${sdkSlots} to a committed ./${UNIVERSAL_DIR} stub (generated files move there); prefix those tools' scripts with "stunt-double check &&"`);
    return 0;
  }
  if (!p0.sdk) { err(formatProblems(p0)); err('stunt-double init: install the SDK first.'); return 1; }
  const sdk = p0.sdk;
  const done = [];
  const todo = [];
  let pkgChanged = false;
  let linkAdded = false;
  let outDir = p0.outDir;

  if (want.has('universal')) {
    const slotsDir = p0.tier === 'universal' ? p0.outDir : path.join(root, UNIVERSAL_DIR);
    const slotsRel = posix(path.relative(root, slotsDir));
    const stub = path.join(slotsDir, 'package.json');
    if (!fs.existsSync(stub)) {
      fs.mkdirSync(slotsDir, { recursive: true });
      fs.writeFileSync(stub, JSON.stringify({
        name: sdk.slotPackage, version: '0.0.0', private: true, type: 'module', sideEffects: false,
        description: `The project's slot package for ${sdk.name} (stunt-double universal tier). Commit this file; everything else here is generated. No dependencies or peers, ever.`,
        exports: { './package.json': './package.json', './*': { types: './gen/*.d.ts', default: './gen/*.jsx' } },
      }, null, 2) + '\n');
      done.push(`wrote ${slotsRel}/package.json (commit it; no dependencies or peers)`);
    }
    const gi = path.join(slotsDir, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, gitignoreFor({ tier: 'universal' }));
    if (p0.tier !== 'universal') {
      const line = { npm: `file:./${slotsRel}`, pnpm: `link:./${slotsRel}`, yarn: `portal:./${slotsRel}`, bun: 'workspace:*' }[pm] ?? `file:./${slotsRel}`;
      pkg.dependencies ??= {};
      if (pkg.dependencies[sdk.slotPackage] && pkg.dependencies[sdk.slotPackage] !== line) todo.push(`replace "${sdk.slotPackage}": "${pkg.dependencies[sdk.slotPackage]}" with "${line}" in package.json dependencies`);
      else if (!pkg.dependencies[sdk.slotPackage]) { pkg.dependencies[sdk.slotPackage] = line; done.push(`dependency "${sdk.slotPackage}": "${line}" (${pm} link form)`); pkgChanged = true; linkAdded = true; }
      if (pm === 'bun') {
        pkg.workspaces ??= [];
        if (Array.isArray(pkg.workspaces) && !pkg.workspaces.includes(slotsRel)) { pkg.workspaces.push(slotsRel); done.push(`workspaces += ${slotsRel}`); pkgChanged = true; }
      }
      if (p0.cfg.outDir && path.resolve(root, p0.cfg.outDir) !== slotsDir) todo.push(`remove "outDir" from ${p0.configSource}: the universal tier generates into ${slotsRel}/`);
      const old = path.join(root, DEFAULT_OUT_DIR);
      if (old !== slotsDir && fs.existsSync(path.join(old, '.gitignore'))) { fs.rmSync(old, { recursive: true, force: true }); done.push(`removed ${DEFAULT_OUT_DIR}/ (generated files now live in ${slotsRel}/)`); }
    }
    outDir = slotsDir;
    todo.push(`run ${pm} install (creates the link), then prefix each tool WITHOUT a stunt-double adapter: "stunt-double check && <tool>"`);
  }

  if (want.has('editor')) {
    const checkAbs = path.join(outDir, CHECK_FILE);
    const ts = p0.tsconfig;
    if (!ts) todo.push(`create a tsconfig.json; then add "${posix(path.relative(root, checkAbs))}" to its "files"`);
    else {
      const rel = posix(path.relative(path.dirname(ts), checkAbs));
      const oldRel = outDir !== p0.outDir ? posix(path.relative(path.dirname(ts), p0.checkFile)) : null;
      const r = addCheckFile(ts, rel, oldRel);
      if (r.change) done.push(`${p0.rel(ts)}: ${r.change}`);
      if (r.todo) todo.push(r.todo);
    }
    addScript(pkg, 'postinstall', 'stunt-double gen --no-fail', done, todo);
    pkgChanged = true;
  } else if (want.has('universal') && p0.tsconfig) {
    // keep an existing editor opt-in pointing at the one generated location
    const oldRel = posix(path.relative(path.dirname(p0.tsconfig), p0.checkFile));
    const t = readTsconfig(p0.tsconfig);
    if ((t?.json?.files ?? []).some((f) => path.resolve(path.dirname(p0.tsconfig), f) === p0.checkFile)) {
      const r = addCheckFile(p0.tsconfig, posix(path.relative(path.dirname(p0.tsconfig), path.join(outDir, CHECK_FILE))), oldRel);
      if (r.change) done.push(`${p0.rel(p0.tsconfig)}: ${r.change}`);
      if (r.todo) todo.push(r.todo);
    }
  }

  if (want.has('ci')) { addScript(pkg, 'check', 'stunt-double check', done, todo); pkgChanged = true; }
  if (pkgChanged) fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

  if (want.has('plugin')) {
    let found = false;
    for (const f of fs.readdirSync(root)) {
      const t = TOOL_CONFIGS.find((x) => x.re.test(f));
      if (!t) continue;
      found = true;
      const file = path.join(root, f);
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('stunt-double')) continue;
      const next = t.tool === 'vite' ? addVitePlugin(text) : null;
      if (next) { fs.writeFileSync(file, next); done.push(`${f}: added stuntDouble() to plugins`); } else todo.push(`${f}: ${t.hint}`);
    }
    if (!found) todo.push(`no tool config found: add the stunt-double adapter to the tool that builds your app`);
  }

  // generate now, so the editor opt-in never sees a missing file and the result is visible immediately
  if ((want.has('editor') || want.has('universal')) && !linkAdded) {
    const g = generate({ root, ...(a.values.config ? { configFile: a.values.config } : {}), onError: 'return' });
    if (g.problems.length) todo.push(`fix the problems below, then run npx stunt-double gen\n${formatProblems(g)}`);
    else if (fileExists(g.checkFile)) done.push(`generated ${g.rel(g.outDir)}/`);
  }
  for (const d of done) out(`  + ${d}`);
  for (const t of todo) out(`  ! TODO ${t}`);
  out(`stunt-double init: ${done.length ? 'done' : 'nothing to change'}.`);
  return 0;
}
