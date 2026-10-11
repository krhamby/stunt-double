// stunt-double CLI: check | gen | watch | ls | why | eject | doctor | init | sdk-lint | slotify
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { generate } from './core/generate.mjs';
import { runTypeGate, resolveTypeScript } from './core/typegate.mjs';
import { formatProblems, formatWarnings, formatReport } from './core/diagnostics.mjs';
import { watchProject } from './core/watch.mjs';
import { sdkLint } from './core/sdklint.mjs';
import { describeChain } from './core/plan.mjs';
import { readTsconfig } from './core/tsconfig.mjs';
import { CONFIG_FILE } from './core/config.mjs';
import { TOOL_VERSION } from './core/manifest.mjs';
import { readJson, posix, listFiles, fileExists, plural } from './core/util.mjs';
import { cmdInit, INIT_FLAGS, TOOL_CONFIGS } from './init.mjs';

const DOCS = 'https://github.com/krhamby/stunt-double#readme';

const HELP = `stunt-double ${TOOL_VERSION}: build-time, fail-closed component slots for React + TypeScript

Setup (no init needed): npm i -D stunt-double, add stuntDouble() to your tool config, put overrides in
src/overrides/. Generated files go to .stunt-double/ (self-ignoring; never edit).

Usage: stunt-double <command> [options]

  check                          validate overrides + contract type check: the CI gate, and the prefix for
                                 tools without an adapter: "stunt-double check && <build>"
  gen [--poison] [--no-fail]     validate overrides and write .stunt-double/ (shims, check file); no type check
  watch -- <cmd...>              gen, then regenerate on every override/config change while <cmd> runs
  ls                             list slots: required, kind, effective implementation, contract
  why <Slot>                     explain which implementation renders a slot
  eject <Slot> [--wrap|--replace] [--force]
                                 write a typed starter override into src/overrides/
  doctor                         check, plus tool configs, scripts, the universal-tier link, caches
  init [--plugin] [--editor] [--ci] [--universal]
                                 OPTIONAL extras (none is needed); without a flag it lists them
  sdk-lint [dir] [--fix] [--write] [--no-fail]
                                 SDK publish gate (run in the SDK package after tsc)
  slotify                        planned; not implemented in stunt-double 0.1

Options: --root <dir> (default: cwd)  --config <file>  --quiet  --help  --version
Docs: ${DOCS}`;

/** Flags each command accepts: an unknown flag is an error, never silently ignored. */
const FLAGS = {
  gen: ['poison', 'no-fail'],
  check: [],
  watch: [],
  ls: [],
  why: [],
  eject: ['wrap', 'replace', 'force'],
  doctor: [],
  init: INIT_FLAGS,
  'sdk-lint': ['fix', 'write', 'no-fail'],
  slotify: [],
};
const COMMON_FLAGS = ['quiet', 'help', 'h', 'version'];

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
    else if (a.startsWith('--root=') || a.startsWith('--config=')) { const [k, ...v] = a.slice(2).split('='); values[k] = v.join('='); }
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
    if (noFail) err('stunt-double gen --no-fail: continuing (install is never blocked); builds fail until this is fixed.');
    return noFail ? 0 : 1;
  }
  if (!a.flags.has('quiet')) out(`stunt-double: generated ${p.rel(p.outDir)}/ for ${summary(p)} (${plural(p.changedFiles.length, 'file')} changed, ${p.ms} ms)`);
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
  out(`  types:      '${p.sdk.name}' types ${slot} by its contract SlotProps['${slot}'] (go-to-definition opens the SDK declaration); builds render EFFECTIVE`);
  const probs = p.problems.filter((x) => x.includes(`"${slot}"`) || x.includes(`/${slot}.`) || x.includes(`/${slot}/`));
  if (probs.length) { err(formatProblems(p, probs)); return 1; }
  return 0;
}

async function cmdEject(a) {
  const slot = a.pos[0];
  const p = project(a, 'return', { write: false });
  if (!p.sdk) { err(formatProblems(p)); return 1; }
  if (!slot || !p.sdk.slots[slot]) { err(`stunt-double eject: name a slot of ${p.sdk.name}@${p.sdk.version}: ${p.slots.join(', ')}`); return 1; }
  if (a.flags.has('wrap') && a.flags.has('replace')) { err('stunt-double eject: pass --wrap or --replace, not both.'); return 1; }
  const exp = p.sdk.exportOf(slot);
  const hasDefault = !!p.sdk.slots[slot].default;
  if (a.flags.has('wrap') && !hasDefault) { err(`stunt-double eject: slot "${slot}" is required: ${p.sdk.name} ships no default to wrap. Run eject ${slot} for a starter to implement.`); return 1; }
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
    : `import type { ReactNode } from 'react';
import type { SlotProps } from '${p.sdk.name}/contracts';

/** Project implementation of the "${slot}" slot${hasDefault ? ' (replaces the SDK default)' : ` (REQUIRED: ${p.sdk.name} ships no default)`}. */
export function ${exp}(props: SlotProps['${slot}']): ReactNode {
  // Fails the build ([TS] TS2304 from the type gate) until you implement it: never a silent empty render.
  return TODO_implement_${slot}(props);
}
`;
  fs.mkdirSync(p.overridesDir, { recursive: true });
  fs.writeFileSync(file, text);
  out(`stunt-double: wrote ${p.rel(file)} (${wrap ? 'wraps the SDK default' : 'a starter that fails the build until implemented'})`);
  const g = project(a, 'return');
  if (g.problems.length) err(formatProblems(g));
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
const ADAPTERLESS = /(^|&&\s*|;\s*)(npx\s+)?(parcel|bun\s+build|esbuild|tsup|farm)\b/;
const LINK_FORM = { npm: 'file:', pnpm: 'link:', yarn: 'portal:', bun: 'workspace:' };

/** Tsconfigs that opted into editor checking: their text names a check file (current, or a stale location). */
function editorOptIns(p) {
  const found = [];
  const seen = new Set();
  const visit = (file) => {
    if (!file || seen.has(file) || !fileExists(file)) return;
    seen.add(file);
    const t = readTsconfig(file);
    if (!t) return;
    const text = fs.readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    const cur = posix(path.relative(dir, p.checkFile));
    const names = [cur, posix(path.relative(dir, path.join(p.root, '.stunt-double', 'check.ts'))), posix(path.relative(dir, path.join(p.root, 'sdk-slots', 'check.ts')))];
    if (names.some((n) => text.includes(n))) found.push({ file, stale: !text.includes(cur) });
    for (const r of t.references ?? []) {
      const f = path.resolve(dir, r.path);
      visit(fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'tsconfig.json') : f);
    }
  };
  visit(path.join(p.root, 'tsconfig.json'));
  visit(p.tsconfig);
  return found;
}

async function cmdDoctor(a) {
  const errors = [];
  const notes = [];
  const hints = [];
  const p = project(a, 'return');
  printWarnings(p);
  if (p.problems.length) errors.push(...p.problems);
  if (p.sdk && !p.problems.length) {
    const r = await runTypeGate(p);
    if (!r.ok) errors.push(...(r.lines?.length ? r.lines : [r.message]));
    else notes.push(`type gate: tsc ${r.version}, ${r.ms} ms (${p.rel(p.checkTsconfig)} extends ${p.tsconfigRel ?? 'no app tsconfig'})`);
  }
  const pkg = readJson(path.join(p.root, 'package.json')) ?? {};
  if (p.sdk) notes.push(`generated files: ${p.rel(p.outDir)}/ (${p.tier} tier)`);
  // editor opt-in (init --editor): the app tsconfig really includes the check file, and fresh clones get it
  for (const o of p.sdk ? editorOptIns(p) : []) {
    const rel = p.rel(o.file);
    if (o.stale) { errors.push(`[X2] ${rel} lists a check file of another generated location; it is ${p.rel(p.checkFile)} now (npx stunt-double init --editor fixes it).`); continue; }
    const ts = resolveTypeScript(p);
    if (ts.error) continue;
    try {
      const list = execFileSync(process.execPath, [...ts.nodeArgs, ts.bin, '-p', o.file, '--listFilesOnly'], { cwd: p.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (!list.split(/\r?\n/).some((l) => l.trim() && path.resolve(p.root, l.trim()) === p.checkFile)) errors.push(`[X2] tsc --listFilesOnly -p ${rel} does not list ${p.rel(p.checkFile)}: add it to "files".`);
      else notes.push(`${rel} includes ${p.rel(p.checkFile)} (editor checking)`);
    } catch (e) {
      const outp = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      if (/TS6053/.test(outp)) errors.push(`[X2] ${rel} lists ${p.rel(p.checkFile)} but it does not exist: run npx stunt-double gen.`);
    }
    if (!/stunt-double\s+gen/.test(pkg.scripts?.postinstall ?? ''))
      hints.push(`${rel} lists ${p.rel(p.checkFile)}: add "postinstall": "stunt-double gen --no-fail" so a fresh clone has it before tsc runs (npx stunt-double init --editor)`);
  }
  if (p.tsconfig && readTsconfig(p.tsconfig)?.compilerOptions?.preserveSymlinks)
    errors.push(`[DOCTOR] ${p.tsconfigRel} sets preserveSymlinks: types would not follow the slot package link.`);
  // tools: adapter present?
  for (const f of fs.readdirSync(p.root)) for (const t of TOOL_CONFIGS) if (t.re.test(f)) {
    const text = fs.readFileSync(path.join(p.root, f), 'utf8');
    if (!text.includes('stunt-double')) errors.push(`[DOCTOR] ${f} does not use ${t.adapter}: ${t.tool} would resolve the registry placeholder (or, in the universal tier, skip validation and the type gate). Add: ${t.hint}`);
    else notes.push(`${f}: adapter present`);
  }
  // scripts of adapter-less tools must chain the check
  for (const [name, script] of Object.entries(pkg.scripts ?? {}))
    if (ADAPTERLESS.test(script) && !/stunt-double\s+check\s*&&/.test(script))
      errors.push(`[DOCTOR] script "${name}" runs a tool without a stunt-double adapter and without the gate: "stunt-double check && ${script}"${p.tier === 'universal' ? '' : ' (that tool also needs the universal tier: npx stunt-double init --universal)'}`);
  // universal tier: package-manager link form
  if (p.sdk && p.link) {
    const want = LINK_FORM[p.pm];
    if (want && p.link.field !== 'workspaces' && !p.link.spec.startsWith(want))
      errors.push(`[F6] "${p.sdk.slotPackage}": "${p.link.spec}" is the wrong link form for ${p.pm}: use "${want}${want === 'workspace:' ? '*' : './' + p.rel(p.outDir)}".`);
  } else if (p.sdk) notes.push(`${p.sdk.slotPackage} is not linked (adapter tier): tools without an adapter fail on the registry placeholder, by design.`);
  // .vite/deps must never contain project slot modules
  const deps = path.join(p.root, 'node_modules', '.vite');
  if (fs.existsSync(deps) && p.sdk) {
    const regions = [`//#region ${p.rel(p.overridesDir)}/`, `//#region ${p.rel(p.genDir)}/`];
    for (const f of listFiles(deps, { exts: ['.js'] })) {
      const text = fs.readFileSync(f, 'utf8');
      if (regions.some((r) => text.includes(r)))
        errors.push(`[F6] ${p.rel(f)} contains project slot modules: the dependency optimizer froze an override decision. Delete node_modules/.vite and keep the stunt-double plugin.`);
    }
  }
  if (!a.flags.has('quiet')) {
    for (const n of notes) out(`  ok    ${n}`);
    for (const h of hints) out(`  hint  ${h}`);
  }
  if (errors.length) {
    const list = [...new Set(errors)];
    err(formatReport(`stunt-double doctor: ${plural(list.length, 'problem')}${p.sdk ? ` (${p.sdk.name}@${p.sdk.version})` : ''}`, list));
    return 1;
  }
  out('stunt-double doctor: no problems found');
  return 0;
}

async function cmdSdkLint(a) {
  const r = sdkLint(a.pos[0] ?? process.cwd(), { write: a.flags.has('write'), fix: a.flags.has('fix') });
  for (const w of r.warnings) err(`  ${w}`);
  if (r.written?.length) out(`stunt-double sdk-lint: wrote ${r.written.join(', ')}`);
  if (!r.ok) {
    err(formatReport(`stunt-double sdk-lint: ${plural(r.errors.length, 'error')}${r.manifest ? ` (${r.manifest.sdk}@${r.manifest.version})` : ''}`, r.errors));
    return a.flags.has('no-fail') ? 0 : 1;
  }
  out(`stunt-double sdk-lint: OK (${r.manifest.sdk}@${r.manifest.version}, ${plural(Object.keys(r.manifest.slots).length, 'slot')}, abi ${r.manifest.abi})`);
  return 0;
}

async function cmdSlotify() {
  err(`stunt-double slotify: not implemented in stunt-double 0.1. It is planned to rewrite a precompiled SDK's relative slot edges to sockets through your package manager's patch flow; until then, ask the SDK team for a slot-ready release. ${DOCS}`);
  return 1;
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  if (a.cmd === 'version' || (!a.cmd && a.flags.has('version'))) { out(TOOL_VERSION); return 0; }
  const helpAsked = a.cmd === 'help' || a.flags.has('help') || a.flags.has('h');
  if (!a.cmd || helpAsked) { out(HELP); return helpAsked ? 0 : 1; }
  const cmds = { gen: cmdGen, check: cmdCheck, watch: cmdWatch, ls: cmdLs, why: cmdWhy, eject: cmdEject, doctor: cmdDoctor, init: (x) => cmdInit(x, { out, err }), 'sdk-lint': cmdSdkLint, slotify: cmdSlotify };
  const fn = cmds[a.cmd];
  if (!fn) { err(`stunt-double: unknown command "${a.cmd}"\n\n${HELP}`); return 1; }
  const bad = [...a.flags].filter((f) => !FLAGS[a.cmd].includes(f) && !COMMON_FLAGS.includes(f));
  if (bad.length) { err(`stunt-double ${a.cmd}: unknown option${bad.length > 1 ? 's' : ''} ${bad.map((f) => `--${f}`).join(', ')}${FLAGS[a.cmd].length ? ` (accepted: ${FLAGS[a.cmd].map((f) => `--${f}`).join(', ')})` : ''}`); return 1; }
  try {
    return await fn(a);
  } catch (e) {
    err(e?.problems ? e.message : `stunt-double ${a.cmd}: ${e?.stack ?? e}`);
    return 1;
  }
}

export { CONFIG_FILE };
