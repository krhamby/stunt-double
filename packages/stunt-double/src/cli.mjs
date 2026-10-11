// stunt-double CLI: gen | check | watch | ls | why | eject | doctor | init | sdk-lint | slotify
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { generate } from './core/generate.mjs';
import { runTypeGate, resolveTypeScript } from './core/typegate.mjs';
import { formatProblems, formatWarnings } from './core/diagnostics.mjs';
import { watchProject } from './core/watch.mjs';
import { sdkLint } from './core/sdklint.mjs';
import { describeChain } from './core/plan.mjs';
import { linkDeclaration } from './core/wiring.mjs';
import { tsconfigCovers, readTsconfig } from './core/tsconfig.mjs';
import { detectPackageManager, CONFIG_FILE } from './core/config.mjs';
import { TOOL_VERSION } from './core/manifest.mjs';
import { readJson, parseJsonc, posix, listFiles, fileExists, plural } from './core/util.mjs';

const DOCS = 'https://github.com/krhamby/stunt-double#readme';

const HELP = `stunt-double ${TOOL_VERSION}: build-time, fail-closed component slots for React + TypeScript

Usage: stunt-double <command> [options]

  gen [--poison] [--no-fail]     validate overrides (STA) and write shims + src/stunt-double.check.ts
  check                          gen + contract type check (TYP); the CI gate and the universal-tier chain:
                                 "stunt-double check && <build>"
  watch -- <cmd...>              gen, then watch overrides/config (poisoned shims on errors) and run <cmd>
  ls                             list slots: required, kind, effective implementation, contract
  why <Slot>                     explain which implementation renders a slot and why
  eject <Slot> [--wrap|--replace] [--force]
                                 write a typed starter override into the overrides directory
  doctor                         everything above plus wiring, tool configs, scripts, caches
  init                           wire a project: dependency line, stub, tsconfig paths/files, scripts, adapter
  sdk-lint [dir] [--write] [--no-fail]
                                 SDK publish gate (run in the SDK package after building)
  slotify                        degraded path for SDKs without slots (not implemented yet)

Options: --root <dir> (default: cwd)  --config <file>  --quiet
Docs: ${DOCS}`;

function parseArgs(argv) {
  const dd = argv.indexOf('--');
  const head = dd >= 0 ? argv.slice(0, dd) : argv;
  const tail = dd >= 0 ? argv.slice(dd + 1) : [];
  const flags = new Set();
  const values = {};
  const pos = [];
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a === '--root' || a === '--config') values[a.slice(2)] = head[++i];
    else if (a.startsWith('--root=') || a.startsWith('--config=')) { const [k, v] = a.slice(2).split('='); values[k] = v; }
    else if (a.startsWith('-')) flags.add(a.replace(/^-+/, ''));
    else pos.push(a);
  }
  return { cmd: pos[0], pos: pos.slice(1), flags, values, tail };
}

const out = (s) => process.stdout.write(s + '\n');
const err = (s) => process.stderr.write(s + '\n');

function project(a, onError = 'return', extra = {}) {
  return generate({ root: a.values.root ?? process.cwd(), ...(a.values.config ? { configFile: a.values.config } : {}), onError, ...extra });
}

function printWarnings(p) {
  if (p.warnings?.length) err(formatWarnings(p));
}

function summary(p) {
  const overridden = Object.values(p.table).filter((e) => e.impl?.source === 'app').map((e) => e.slot);
  return `${plural(p.slots.length, 'slot')} of ${p.sdk.name}@${p.sdk.version}; overridden: ${overridden.join(', ') || 'none'}`;
}

// ---------------------------------------------------------------------------------------------------------
async function cmdGen(a) {
  const noFail = a.flags.has('no-fail');
  let p;
  try { p = project(a, a.flags.has('poison') ? 'poison' : 'return'); } catch (e) {
    err(`stunt-double gen: ${e.message}`);
    return noFail ? 0 : 1;
  }
  printWarnings(p);
  if (p.problems.length) {
    err(formatProblems(p));
    if (noFail) err('stunt-double gen --no-fail: continuing (install is never blocked); builds will fail until this is fixed.');
    return noFail ? 0 : 1;
  }
  if (!a.flags.has('quiet')) out(`stunt-double: generated ${summary(p)} (${plural(p.changedFiles.length, 'file')} changed, ${p.ms} ms)`);
  return 0;
}

async function cmdCheck(a) {
  const p = project(a, 'return');
  printWarnings(p);
  if (p.problems.length) { err(formatProblems(p)); return 1; }
  const r = await runTypeGate(p);
  if (!r.ok) { err(r.message); return 1; }
  if (!a.flags.has('quiet')) out(`stunt-double: OK - ${summary(p)}; contracts checked by tsc ${r.version} in ${r.ms} ms`);
  return 0;
}

async function cmdWatch(a) {
  let p = project(a, 'poison');
  printWarnings(p);
  if (p.problems.length) err(formatProblems(p));
  else out(`stunt-double: watching ${p.rel(p.overridesDir)} (${summary(p)})`);
  const gate = async (cur) => {
    const r = await runTypeGate(cur);
    if (!r.ok) err(r.message);
  };
  if (p.sdk && !p.problems.length) gate(p).catch(() => {});
  const w = p.sdk ? watchProject(p, {
    onChange: (next, _prev, e) => {
      if (e) return err(`stunt-double watch: ${e.message}`);
      p = next;
      if (next.problems.length) err(formatProblems(next));
      else { out(`stunt-double: regenerated (${plural(next.changedFiles.length, 'file')} changed)`); gate(next).catch(() => {}); }
    },
  }) : null;
  if (!a.tail.length) return new Promise(() => {}); // watch only, until Ctrl-C
  const child = spawn(a.tail[0], a.tail.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  return new Promise((done) => child.on('exit', (code, signal) => { w?.close(); done(code ?? (signal ? 1 : 0)); }));
}

function contractDocs(p) {
  const f = ['dist/contracts.d.ts', 'contracts.d.ts'].map((x) => path.join(p.sdk.dir, x)).find(fileExists);
  const docs = {};
  if (!f) return docs;
  const src = fs.readFileSync(f, 'utf8');
  const body = /interface\s+SlotProps\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  for (const m of body.matchAll(/\/\*\*([\s\S]*?)\*\/\s*([A-Za-z0-9_]+)\s*:/g)) docs[m[2]] = m[1].replace(/\s*\*\s*/g, ' ').trim();
  return docs;
}

async function cmdLs(a) {
  const p = project(a, 'return', { write: false });
  if (!p.sdk) { err(formatProblems(p)); return 1; }
  const docs = contractDocs(p);
  const rows = p.slots.map((s) => {
    const e = p.table[s];
    return [s, e.required ? 'required' : 'optional', e.kind, describeChain(e, p.rel), docs[s] ?? ''];
  });
  const head = ['SLOT', 'REQUIRED', 'KIND', 'EFFECTIVE', 'CONTRACT'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  out(`${p.sdk.name}@${p.sdk.version} slots (socket package ${p.sdk.slotPackage}; overrides in ${p.rel(p.overridesDir)}/)`);
  for (const r of [head, ...rows]) out(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('  '));
  if (p.problems.length) { err(formatProblems(p)); return 1; }
  return 0;
}

async function cmdWhy(a) {
  const slot = a.pos[0];
  const p = project(a, 'return', { write: false });
  if (!p.sdk) { err(formatProblems(p)); return 1; }
  if (!slot || !p.sdk.slots[slot]) { err(`stunt-double why: name a slot of ${p.sdk.name}@${p.sdk.version}: ${p.slots.join(', ')}`); return 1; }
  const e = p.table[slot];
  const meta = p.sdk.slots[slot];
  out(`slot "${slot}" of ${p.sdk.name}@${p.sdk.version} (${e.kind}${e.required ? ', required' : ''})`);
  out(`  socket:     ${p.sdk.slotPackage}/${slot}  ->  ${p.rel(p.shimFile(slot))}`);
  out(`  EFFECTIVE   ${describeChain(e, p.rel)}`);
  e.chain.forEach((c, i) => out(`  chain[${i}]   ${c.source === 'app' ? `${p.rel(c.file)}#${c.export}${c.via === 'map' ? ' (config map)' : ''}` : `${c.spec}${c.layer ? ` (layer ${c.layer})` : ' (SDK default)'}`}`));
  if (!e.chain.length) out(`  chain:      (empty) -> [F3]`);
  out(`  rendered by: ${(meta.consumers ?? []).join(', ') || '(app code only)'}`);
  const probs = p.problems.filter((x) => x.includes(`"${slot}"`) || x.includes(`/${slot}.`) || x.includes(`/${slot}/`));
  if (probs.length) { err(formatProblems(p, probs)); return 1; }
  return 0;
}

async function cmdEject(a) {
  const slot = a.pos[0];
  const p = project(a, 'return', { write: false });
  if (!p.sdk) { err(formatProblems(p)); return 1; }
  if (!slot || !p.sdk.slots[slot]) { err(`stunt-double eject: name a slot of ${p.sdk.name}@${p.sdk.version}: ${p.slots.join(', ')}`); return 1; }
  const exp = p.sdk.exportOf(slot);
  const hasDefault = !!p.sdk.slots[slot].default;
  const wrap = hasDefault && !a.flags.has('replace');
  const file = path.join(p.overridesDir, `${slot}.tsx`);
  if (fs.existsSync(file) && !a.flags.has('force')) { err(`stunt-double eject: ${p.rel(file)} already exists (use --force to overwrite).`); return 1; }
  const text = wrap
    ? `import { ${exp} as Original } from '${p.sdk.originalSpecifier}${slot}';
import type { SlotProps } from '${p.sdk.name}/contracts';

/** Project override of the "${slot}" slot: wraps the ${p.sdk.name} default. See \`npx stunt-double why ${slot}\`. */
export function ${exp}(props: SlotProps['${slot}']) {
  return <Original {...props} />;
}
`
    : `import type { SlotProps } from '${p.sdk.name}/contracts';

/** Project implementation of the "${slot}" slot${hasDefault ? ' (replaces the SDK default)' : ` (REQUIRED: ${p.sdk.name} ships no default)`}. */
export function ${exp}(props: SlotProps['${slot}']) {
  // Fails the build (the type gate) until you implement it: no silent null render.
  return TODO_implement_${slot}(props);
}
`;
  fs.mkdirSync(p.overridesDir, { recursive: true });
  fs.writeFileSync(file, text);
  out(`stunt-double: wrote ${p.rel(file)} (${wrap ? 'wraps the SDK default' : 'starter that fails the build until implemented'})`);
  const g = project(a, 'return');
  if (g.problems.length) err(formatProblems(g));
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
const TOOL_CONFIGS = [
  { tool: 'vite', re: /^vite(st)?\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/vite', hint: "plugins: [react(), stuntDouble()]  (import { stuntDouble } from 'stunt-double/vite')" },
  { tool: 'next', re: /^next\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/next', hint: "export default withStuntDouble(nextConfig)  (import { withStuntDouble } from 'stunt-double/next')" },
  { tool: 'webpack', re: /^(webpack|rspack|rsbuild|craco)\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/webpack', hint: "export default withStuntDouble(config)  (import { withStuntDouble } from 'stunt-double/webpack')" },
  { tool: 'jest', re: /^jest\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double/jest', hint: "export default withStuntDouble(config)  (import { withStuntDouble } from 'stunt-double/jest')" },
  { tool: 'metro', re: /^metro\.config\.(m|c)?js$/, adapter: 'stunt-double/metro', hint: "module.exports = withStuntDouble(getDefaultConfig(__dirname))  (require('stunt-double/metro'))" },
  { tool: 'rollup/rolldown', re: /^(rollup|rolldown)\.config\.(m|c)?[jt]s$/, adapter: 'stunt-double', hint: "plugins: [stuntDouble()]  (import { stuntDouble } from 'stunt-double/vite')" },
];
const ADAPTERLESS = /(^|&&\s*|;\s*)(npx\s+)?(parcel|bun\s+build|esbuild|tsup|farm)\b/;

async function cmdDoctor(a) {
  const errors = [];
  const notes = [];
  const p = project(a, 'return');
  printWarnings(p);
  if (p.problems.length) errors.push(...p.problems);
  if (p.sdk && !p.problems.length) {
    const r = await runTypeGate(p);
    if (!r.ok) errors.push(...(r.lines?.length ? r.lines : [r.message]));
    else notes.push(`type gate: tsc ${r.version}, ${r.ms} ms`);
  }
  const pkg = readJson(path.join(p.root, 'package.json')) ?? {};
  // tsconfig really includes the check file
  if (p.tsconfig) {
    const ts = p.sdk ? resolveTypeScript(p) : { error: true };
    if (!ts.error) {
      try {
        const list = execFileSync(process.execPath, [ts.bin, '-p', p.tsconfig, '--listFilesOnly'], { cwd: p.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const want = path.resolve(p.checkFile);
        if (!list.split(/\r?\n/).some((l) => l.trim() && path.resolve(p.root, l.trim()) === want)) errors.push(`[X2] tsc --listFilesOnly -p ${p.tsconfigRel} does not list ${p.rel(p.checkFile)}: add it to "files".`);
        else notes.push(`${p.tsconfigRel} includes ${p.rel(p.checkFile)}`);
      } catch (e) {
        const outp = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        if (/TS6053/.test(outp)) errors.push(`[X2] ${p.tsconfigRel} lists ${p.rel(p.checkFile)} but it does not exist: run npx stunt-double gen.`);
      }
    }
    const t = readTsconfig(p.tsconfig);
    if (t?.compilerOptions?.preserveSymlinks) errors.push(`[DOCTOR] ${p.tsconfigRel} sets preserveSymlinks: types would not follow the slot package link.`);
    if (p.sdk && !t?.compilerOptions?.paths?.[`${p.sdk.slotPackage}/*`] && !p.linkDeclared)
      errors.push(`[DOCTOR] ${p.tsconfigRel} has no "paths" entry for "${p.sdk.slotPackage}/*" and the package is not linked: tsc and the IDE resolve the registry placeholder. Run npx stunt-double init.`);
  }
  // tools: adapter present?
  for (const f of fs.readdirSync(p.root)) for (const t of TOOL_CONFIGS) if (t.re.test(f)) {
    const text = fs.readFileSync(path.join(p.root, f), 'utf8');
    if (!text.includes('stunt-double')) errors.push(`[DOCTOR] ${f} does not use ${t.adapter}: ${t.tool} would only see the linked package (no validation, no type gate) or the placeholder. Add: ${t.hint}`);
    else notes.push(`${f}: adapter present`);
  }
  // scripts of adapter-less tools must chain the check
  for (const [name, script] of Object.entries(pkg.scripts ?? {}))
    if (ADAPTERLESS.test(script) && !/stunt-double\s+check\s*&&/.test(script)) errors.push(`[DOCTOR] script "${name}" runs an adapter-less bundler without the gate: "stunt-double check && ${script}"`);
  if (!/stunt-double\s+gen/.test(pkg.scripts?.postinstall ?? '')) notes.push('hint: add "postinstall": "stunt-double gen --no-fail" so fresh clones and IDEs get the shims');
  // package-manager link form
  if (p.sdk) {
    const decl = linkDeclaration(p.root, p.sdk.slotPackage, p.slotsDir);
    const want = { npm: 'file:', pnpm: 'link:', yarn: 'portal:', bun: 'workspace:' }[p.pm];
    if (decl && want && decl.field !== 'workspaces' && !decl.spec.startsWith(want))
      errors.push(`[F6] "${p.sdk.slotPackage}": "${decl.spec}" is the wrong link form for ${p.pm}: use "${want}${want === 'workspace:' ? '*' : './' + p.rel(p.slotsDir)}".`);
    if (!decl) notes.push(`${p.sdk.slotPackage} is not linked (adapter-only wiring): tools without an adapter fail on the registry placeholder, by design.`);
  }
  // .vite/deps must never contain project modules
  const deps = path.join(p.root, 'node_modules', '.vite');
  if (fs.existsSync(deps))
    for (const f of listFiles(deps, { exts: ['.js'] })) {
      const text = fs.readFileSync(f, 'utf8');
      if (text.includes(p.rel(p.overridesDir) + '/') || text.includes(posix(path.relative(p.root, p.genDir)) + '/') && /\/\/#region/.test(text) && new RegExp(`//#region ${posix(path.relative(p.root, p.genDir))}`).test(text))
        errors.push(`[F6] ${p.rel(f)} contains project slot modules: the dependency optimizer froze an override decision. Delete node_modules/.vite and keep the stunt-double plugin.`);
    }
  // .gitignore
  const gi = fs.existsSync(path.join(p.root, '.gitignore')) ? fs.readFileSync(path.join(p.root, '.gitignore'), 'utf8') : '';
  if (!gi.includes(p.rel(p.checkFile))) notes.push(`hint: add ${p.rel(p.checkFile)} and ${p.rel(p.genDir)}/ to .gitignore`);
  for (const n of notes) out(`  ok  ${n}`);
  if (errors.length) { err(`stunt-double doctor: ${plural(errors.length, 'problem')}${p.sdk ? ` (${p.sdk.name}@${p.sdk.version})` : ''}\n  ${[...new Set(errors)].join('\n  ')}`); return 1; }
  out('stunt-double doctor: no problems found');
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
function insertAfter(text, re, insertion) {
  const m = re.exec(text);
  if (!m) return null;
  return text.slice(0, m.index + m[0].length) + insertion + text.slice(m.index + m[0].length);
}

/** Add the slot "paths" entry and the check file to a tsconfig by TEXT insertion, so comments survive. */
function editTsconfig(file, slotPackage, slotsRel, checkRel) {
  const dir = path.dirname(file);
  let text = fs.readFileSync(file, 'utf8');
  const json = parseJsonc(text);
  const genRel = './' + posix(path.join(slotsRel, 'gen')) + '/*';
  const changes = [];
  if (!json.compilerOptions?.paths?.[`${slotPackage}/*`]) {
    const entry = `"${slotPackage}/*": ["${genRel}"]`;
    const next = json.compilerOptions?.paths
      ? insertAfter(text, /"paths"\s*:\s*\{/, `\n      ${entry},`)
      : json.compilerOptions
        ? insertAfter(text, /"compilerOptions"\s*:\s*\{/, `\n    "paths": { ${entry} },`)
        : insertAfter(text, /^\s*\{/, `\n  "compilerOptions": { "paths": { ${entry} } },`);
    if (next) { text = next; changes.push(`paths "${slotPackage}/*"`); }
  }
  if (!(json.files ?? []).some((f) => path.resolve(dir, f) === path.resolve(dir, checkRel))) {
    const next = json.files ? insertAfter(text, /"files"\s*:\s*\[/, `"${checkRel}"${json.files.length ? ', ' : ''}`) : insertAfter(text, /^\s*\{/, `\n  "files": ["${checkRel}"],`);
    if (next) { text = next; changes.push(`files "${checkRel}"`); }
  }
  try { parseJsonc(text); } catch { return { ok: false, changes: [] }; }
  if (changes.length) fs.writeFileSync(file, text);
  return { ok: true, changes };
}

async function cmdInit(a) {
  const root = path.resolve(a.values.root ?? process.cwd());
  const pkgFile = path.join(root, 'package.json');
  const pkg = readJson(pkgFile);
  if (!pkg) { err('stunt-double init: no package.json here.'); return 1; }
  const pm = detectPackageManager(root);
  const done = [];
  const todo = [];
  const p0 = generate({ root, onError: 'return', write: false });
  if (!p0.sdk) { err(formatProblems(p0)); err('stunt-double init: install the SDK first.'); return 1; }
  const sdk = p0.sdk;
  const slotsRel = posix(path.relative(root, p0.slotsDir));
  // 1. committed stub
  const stub = path.join(p0.slotsDir, 'package.json');
  if (!fs.existsSync(stub)) {
    fs.mkdirSync(p0.slotsDir, { recursive: true });
    fs.writeFileSync(stub, JSON.stringify({
      name: sdk.slotPackage, version: '0.0.0', private: true, type: 'module', sideEffects: false,
      description: `Generated slot package for ${sdk.name} (stunt-double). Commit this file; gen/ is generated.`,
      exports: { './package.json': './package.json', './*': { types: './gen/*.d.ts', default: './gen/*.jsx' } },
    }, null, 2) + '\n');
    done.push(`wrote ${slotsRel}/package.json (committed stub, no dependencies or peers)`);
  }
  // 2. dependency line + scripts
  const line = { npm: `file:./${slotsRel}`, pnpm: `link:./${slotsRel}`, yarn: `portal:./${slotsRel}`, bun: 'workspace:*' }[pm] ?? `file:./${slotsRel}`;
  pkg.dependencies ??= {};
  if (!pkg.dependencies[sdk.slotPackage]) { pkg.dependencies[sdk.slotPackage] = line; done.push(`dependency "${sdk.slotPackage}": "${line}" (${pm})`); }
  if (pm === 'bun') { pkg.workspaces ??= []; if (!pkg.workspaces.includes(slotsRel)) { pkg.workspaces.push(slotsRel); done.push(`workspaces += ${slotsRel}`); } }
  pkg.scripts ??= {};
  if (!/stunt-double gen/.test(pkg.scripts.postinstall ?? '')) {
    pkg.scripts.postinstall = pkg.scripts.postinstall ? `${pkg.scripts.postinstall} && stunt-double gen --no-fail` : 'stunt-double gen --no-fail';
    done.push('script postinstall: stunt-double gen --no-fail');
  }
  if (!pkg.scripts.check) { pkg.scripts.check = 'stunt-double check'; done.push('script check: stunt-double check'); }
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  // 3. .gitignore
  const giFile = path.join(root, '.gitignore');
  const gi = fs.existsSync(giFile) ? fs.readFileSync(giFile, 'utf8') : '';
  const wantGi = [`${slotsRel}/gen/`, posix(path.relative(root, p0.checkFile))].filter((l) => !gi.split(/\r?\n/).includes(l));
  if (wantGi.length) { fs.writeFileSync(giFile, `${gi}${gi && !gi.endsWith('\n') ? '\n' : ''}# stunt-double (generated)\n${wantGi.join('\n')}\n`); done.push(`.gitignore += ${wantGi.join(', ')}`); }
  // 4. tsconfig paths + files (comments preserved: text insertion)
  const tsFile = p0.tsconfig;
  if (tsFile) {
    const checkRel = posix(path.relative(path.dirname(tsFile), p0.checkFile));
    const r = editTsconfig(tsFile, sdk.slotPackage, posix(path.relative(path.dirname(tsFile), p0.slotsDir)), checkRel);
    if (r.ok && r.changes.length) done.push(`${p0.rel(tsFile)}: ${r.changes.join(', ')}`);
    if (!r.ok) todo.push(`add to ${p0.rel(tsFile)}: "compilerOptions": {"paths": {"${sdk.slotPackage}/*": ["./${slotsRel}/gen/*"]}} and "files": ["${posix(path.relative(path.dirname(tsFile), p0.checkFile))}"]`);
  } else todo.push(`create a tsconfig.json with "paths": {"${sdk.slotPackage}/*": ["./${slotsRel}/gen/*"]} and "files": ["${posix(path.relative(root, p0.checkFile))}"]`);
  // 5. overrides dir
  if (!fs.existsSync(p0.overridesDir)) { fs.mkdirSync(p0.overridesDir, { recursive: true }); fs.writeFileSync(path.join(p0.overridesDir, '.gitkeep'), ''); done.push(`created ${p0.rel(p0.overridesDir)}/`); }
  // 6. adapters
  for (const f of fs.readdirSync(root)) {
    const t = TOOL_CONFIGS.find((x) => x.re.test(f));
    if (!t) continue;
    const file = path.join(root, f);
    let text = fs.readFileSync(file, 'utf8');
    if (text.includes('stunt-double')) continue;
    if (t.tool === 'vite' && /plugins\s*:\s*\[/.test(text)) {
      const imports = [...text.matchAll(/^import[^;]*;?\s*$/gm)];
      const at = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
      text = text.slice(0, at) + `${at ? '\n' : ''}import { stuntDouble } from 'stunt-double/vite';\n` + text.slice(at);
      text = text.replace(/plugins\s*:\s*\[/, (m) => `${m}stuntDouble(), `);
      fs.writeFileSync(file, text);
      done.push(`${f}: added stuntDouble() to plugins`);
    } else todo.push(`${f}: ${t.hint}`);
  }
  for (const d of done) out(`  + ${d}`);
  for (const t of todo) out(`  ! TODO ${t}`);
  out(`stunt-double init: done. Next: ${pm} install, then put overrides in ${p0.rel(p0.overridesDir)}/ (npx stunt-double eject <Slot>).`);
  return 0;
}

async function cmdSdkLint(a) {
  const r = sdkLint(a.pos[0] ?? process.cwd(), { write: a.flags.has('write') });
  for (const w of r.warnings) err(`  ${w}`);
  if (r.written?.length) out(`stunt-double sdk-lint: wrote ${r.written.join(', ')}`);
  if (!r.ok) {
    err(`stunt-double sdk-lint: ${plural(r.errors.length, 'error')}${r.manifest ? ` (${r.manifest.sdk}@${r.manifest.version})` : ''}\n  ${r.errors.join('\n  ')}`);
    return a.flags.has('no-fail') ? 0 : 1;
  }
  out(`stunt-double sdk-lint: OK (${r.manifest.sdk}@${r.manifest.version}, ${plural(Object.keys(r.manifest.slots).length, 'slot')}, abi ${r.manifest.abi})`);
  return 0;
}

async function cmdSlotify() {
  err(`stunt-double slotify: not implemented yet. It will rewrite a precompiled SDK's relative slot edges to sockets through your package manager's patch flow (pnpm patch / yarn patch / patch-package). See ${DOCS} (degraded path, spec §10).`);
  return 2;
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  if (!a.cmd || a.flags.has('help') || a.flags.has('h') || a.cmd === 'help') { out(HELP); return a.cmd ? 0 : 1; }
  if (a.cmd === 'version' || a.flags.has('version')) { out(TOOL_VERSION); return 0; }
  const cmds = { gen: cmdGen, check: cmdCheck, watch: cmdWatch, ls: cmdLs, why: cmdWhy, eject: cmdEject, doctor: cmdDoctor, init: cmdInit, 'sdk-lint': cmdSdkLint, slotify: cmdSlotify };
  const fn = cmds[a.cmd];
  if (!fn) { err(`stunt-double: unknown command "${a.cmd}"\n\n${HELP}`); return 1; }
  try {
    return await fn(a);
  } catch (e) {
    err(e?.problems ? e.message : `stunt-double ${a.cmd}: ${e?.stack ?? e}`);
    return 1;
  }
}

export { CONFIG_FILE };
