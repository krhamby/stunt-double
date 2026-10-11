// The generator: STA (static validation) + emit. Called at every adapter start and by `stunt-double gen|check`.
// Synchronous so it can run inside any tool's config file.
//
// Everything it writes lives in ONE directory, the outDir (default "<root>/.stunt-double/", self-ignoring):
//   gen/<Slot>.jsx, gen/<Slot>.d.ts   the shims (what the socket alias points at)
//   check.ts                          the contract assertions (the type gate's program)
//   tsconfig.check.json               the gate's tsconfig (extends the app tsconfig; the app's is never edited)
//   check.map.json, state.json, dist-scan.json, .gitignore
// In the universal tier (a link dependency on the slot package) the outDir is the linked stub's directory.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, detectPackageManager, detectPnP, detectRsc } from './config.mjs';
import { loadSdk, loadLayers, TOOL_VERSION } from './manifest.mjs';
import { scanOverrides } from './scan.mjs';
import { buildPlan } from './plan.mjs';
import { scanDist } from './distscan.mjs';
import { checkWiring, linkDeclaration } from './wiring.mjs';
import { checkSingletons } from './singletons.mjs';
import { scanBypass } from './bypass.mjs';
import { renderCheckFile } from './checkfile.mjs';
import { emitAll, emitPoison, OUT_DIR_ENTRIES } from './emit.mjs';
import { pickAppTsconfig, tsconfigCovers } from './tsconfig.mjs';
import { formatProblems } from './diagnostics.mjs';
import { real, posix, sha, esc, isInside, globToRegExp, cleanId, fileExists } from './util.mjs';

export const DEFAULT_OUT_DIR = '.stunt-double';
export const CHECK_FILE = 'check.ts';
export const CHECK_TSCONFIG = 'tsconfig.check.json';

/**
 * A stunt-double report as an Error. Its stack is the report itself: hosts that print `inspect(error)` (Vite,
 * Vitest) show the report, not a trace through stunt-double's or the bundler's internals. `problems` and `name`
 * are not own enumerable properties, so they are not printed a second time.
 */
export class StuntDoubleError extends Error {
  constructor(message, problems = []) {
    super(message);
    Object.defineProperty(this, 'problems', { value: problems, enumerable: false, writable: true, configurable: true });
    this.stack = `${message}\n`;
  }
}
StuntDoubleError.prototype.name = 'StuntDoubleError';

/**
 * Where generated files go, and why. The universal tier wins: the link target IS the generated package.
 * Refuses directories that would be unsafe to own (node_modules: immutable dev caches; a directory with files
 * stunt-double did not write: the self-ignoring .gitignore would hide them).
 */
function resolveOutDir({ root, cfg, configSource, overridesDir, sdk, rel }) {
  const problems = [];
  const decl = sdk ? linkDeclaration(root, sdk.slotPackage) : null;
  let outDir = path.resolve(root, cfg.outDir ?? DEFAULT_OUT_DIR);
  if (decl?.dir) {
    if (cfg.outDir && path.resolve(root, cfg.outDir) !== decl.dir)
      problems.push(`[CFG] "outDir": "${cfg.outDir}" in ${configSource}, but ${sdk.slotPackage} is linked to ./${rel(decl.dir)} (universal tier): generated files must live in the linked package. Remove "outDir".`);
    outDir = decl.dir;
  }
  if (outDir.split(path.sep).includes('node_modules'))
    problems.push(`[CFG] "outDir" ${rel(outDir)} is inside node_modules: dev servers cache node_modules files as immutable and pre-bundle them, so override changes would not reach the browser. Use the default (.stunt-double).`);
  else if (outDir === root || isInside(root, outDir) || isInside(overridesDir, outDir) || isInside(outDir, overridesDir))
    problems.push(`[CFG] "outDir" ${rel(outDir)} overlaps the project root or ${rel(overridesDir)}: use a directory of its own (the default is .stunt-double).`);
  else {
    let ents = [];
    try { ents = fs.readdirSync(outDir); } catch {}
    const foreign = ents.filter((e) => !OUT_DIR_ENTRIES.has(e));
    if (foreign.length)
      problems.push(`[CFG] "outDir" ${rel(outDir)}/ contains files stunt-double does not generate (${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? ', ...' : ''}): everything in it is generated and git-ignored, so use a directory of its own.`);
  }
  return { outDir, decl, problems };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.root]          project root (default: cwd)
 * @param {'throw'|'poison'|'return'} [opts.onError]  what to do with problems (default 'return')
 * @param {boolean} [opts.write]        false = validate only, write nothing (default true)
 * @param {string} [opts.configFile]    explicit config file
 *  ...any stunt-double.config.json key overrides the file
 */
export function generate(opts = {}) {
  const t0 = performance.now();
  const root = real(path.resolve(opts.root ?? process.cwd()));
  const onError = opts.onError ?? 'return';
  const { cfg, configFile, configSource, problems: cfgProblems } = loadConfig(root, opts);
  const rel = (f) => posix(path.relative(root, f)) || '.';
  const overridesDir = path.resolve(root, cfg.overridesDir);
  const realOverrides = real(overridesDir);
  const allowRe = (cfg.allowOriginalImports ?? []).map(globToRegExp);

  const { sdk, problems: sdkProblems } = loadSdk(root, cfg);
  const out = resolveOutDir({ root, cfg, configSource, overridesDir, sdk, rel });
  const outDir = out.outDir;
  const genDir = path.join(outDir, 'gen');
  const checkFile = path.join(outDir, CHECK_FILE);

  const p = {
    toolVersion: TOOL_VERSION,
    root, cfg, configFile, configSource, opts, rel,
    overridesDir, outDir, genDir, checkFile,
    checkTsconfig: path.join(outDir, CHECK_TSCONFIG),
    mapFile: path.join(outDir, 'check.map.json'),
    stateFile: path.join(outDir, 'state.json'),
    /** 'adapter' (default: nothing linked) or 'universal' (the slot package is linked to outDir) */
    tier: out.decl?.dir ? 'universal' : 'adapter',
    link: out.decl,
    pm: detectPackageManager(root),
    isPnP: detectPnP(root),
    rsc: detectRsc(root, cfg.rsc),
    problems: [...cfgProblems, ...sdkProblems, ...out.problems],
    warnings: [],
    changedFiles: [],
    poisoned: false,
    sdk: null,
    layers: [],
    table: {},
    slots: [],
    packages: [],
    originals: [],
    socketConsumers: {},
    defaultFileToSlot: new Map(),
    closureFiles: new Set(),
    implFiles: [],
    tsconfig: null,
    tsconfigRel: null,
    /** the app tsconfig's own program contains the check file (opt-in: `stunt-double init --editor`) */
    tsconfigCoversCheckFile: false,
    linkDeclared: false,
    fingerprint: '',
    state: null,
    genDirRegex: new RegExp(`^${esc(genDir)}[\\\\/]`),
    shimFile: (slot) => path.join(genDir, `${slot}.jsx`),
    isProjectSlotFile(id) {
      const f = cleanId(id);
      return isInside(f, genDir) || isInside(f, overridesDir) || isInside(real(f), realOverrides);
    },
    watches(file) {
      const f = path.resolve(root, String(file));
      return isInside(f, overridesDir) || f === configFile || f === path.join(root, 'package.json') || f === path.join(root, 'stunt-double.config.json')
        || p.closureFiles.has(f) || p.implFiles.includes(f);
    },
    mayImportImpl(file, slot) {
      const f = real(cleanId(file));
      if (f === real(p.shimFile(slot))) return true;
      if (isInside(f, realOverrides) || p.implFiles.includes(f)) return true;
      if (p.layers.some((l) => isInside(f, l.realDir))) return true;
      const r = posix(path.relative(root, f));
      return allowRe.some((re) => re.test(r));
    },
    ms: 0,
  };
  if (!sdk || out.problems.length) return finish(p, onError, opts, t0);
  p.sdk = sdk;
  p.slots = sdk.slotNames;

  const { layers, problems: layerProblems } = loadLayers(root, cfg, sdk);
  p.layers = layers;
  p.problems.push(...layerProblems);
  p.packages = [sdk.name, ...layers.map((l) => l.name)];
  p.originals = [
    ...sdk.slotNames.filter((s) => sdk.slots[s].default).map((s) => `${sdk.originalSpecifier}${s}`),
    ...layers.flatMap((l) => Object.values(l.slots).map((x) => x.spec)),
  ];

  p.tsconfig = pickAppTsconfig(root, cfg.tsconfig, overridesDir);
  if (cfg.tsconfig && !fileExists(p.tsconfig)) p.problems.push(`[CFG] "tsconfig": "${cfg.tsconfig}" does not exist.`);
  if (p.tsconfig && !fileExists(p.tsconfig)) p.tsconfig = null;
  p.tsconfigRel = p.tsconfig ? rel(p.tsconfig) : null;

  // STA: claims (F2, F4), plan (F3, F5, F7, W7, F9), bypass (F6g)
  const scan = scanOverrides({ root, sdk, cfg, overridesDir, configSource });
  p.problems.push(...scan.problems);
  const plan = buildPlan({ root, sdk, cfg, claims: scan.claims, layers, overridesDir, tsconfig: p.tsconfig, rel });
  p.table = plan.table;
  p.problems.push(...plan.problems);
  p.warnings.push(...plan.warnings);
  p.closureFiles = new Set(plan.closureFiles);
  p.implFiles = [...scan.claims.values()].flat().map((c) => c.file);
  p.problems.push(...scanBypass({ root, sdk, cfg, overridesDir, outDir, implFiles: p.implFiles.filter((f) => !isInside(f, overridesDir)), rel }));

  // dist scan of the INSTALLED SDK and layers (F6a), always run, cached per package content
  const dist = scanDist({ sdk, pkgDir: sdk.dir, rel, cacheFile: opts.write === false ? null : path.join(outDir, 'dist-scan.json') });
  p.problems.push(...dist.problems);
  p.socketConsumers = dist.socketConsumers;
  for (const l of layers) {
    const ld = scanDist({ sdk, pkgDir: l.dir, label: l.name, rel, allowFiles: Object.values(l.slots).map((x) => x.file) });
    p.problems.push(...ld.problems);
    for (const [s, files] of Object.entries(ld.socketConsumers)) (p.socketConsumers[s] ??= []).push(...files);
  }
  for (const s of sdk.slotNames) { const d = sdk.defaultFile(s); if (d) p.defaultFileToSlot.set(real(d), s); }
  for (const l of layers) for (const [s, impl] of Object.entries(l.slots)) p.defaultFileToSlot.set(real(impl.file), s);

  // wiring self-test (F6f / F8b, universal tier only) and singleton preflight (F8)
  const wiring = checkWiring({ root, sdk, decl: out.decl, rel, pm: p.pm });
  p.linkDeclared = wiring.linkDeclared;
  p.problems.push(...wiring.problems);
  const overrideDirs = [...new Set([overridesDir, ...p.implFiles.map((f) => path.dirname(f))])].filter((d) => fs.existsSync(d));
  p.problems.push(...checkSingletons({ root, sdk, slotsDir: p.tier === 'universal' ? outDir : null, layers, overrideDirs, singletons: cfg.singletons, rel }));

  // Not a warning: by default the build's own gate checks contracts. `init --editor` opts the app tsconfig in;
  // `doctor` verifies that opt-in (X2).
  p.tsconfigCoversCheckFile = !!p.tsconfig && tsconfigCovers(p.tsconfig, checkFile);

  const decisions = Object.fromEntries(sdk.slotNames.map((s) => {
    const impl = p.table[s]?.impl;
    return [s, !impl ? null : impl.source === 'app' ? `${rel(impl.file)}#${impl.export}` : impl.spec];
  }));
  p.fingerprint = sha(JSON.stringify({ v: TOOL_VERSION, sdk: `${sdk.name}@${sdk.version}`, h: sdk.hash, abi: sdk.abi, decisions, rsc: p.rsc, layers: layers.map((l) => `${l.name}@${l.version}`), out: rel(outDir) }), 16);
  p.state = { tool: `stunt-double@${TOOL_VERSION}`, sdk: `${sdk.name}@${sdk.version}`, abi: sdk.abi, fingerprint: p.fingerprint, rsc: p.rsc, tier: p.tier, slots: decisions };
  return finish(p, onError, opts, t0);
}

function finish(p, onError, opts, t0) {
  p.problems = [...new Set(p.problems)];
  p.warnings = [...new Set(p.warnings)];
  if (p.problems.length) {
    if (onError === 'poison' && opts.write !== false) { p.changedFiles = emitPoison(p, p.problems); p.poisoned = p.changedFiles.length > 0 || !!p.sdk; }
    p.ms = Math.round(performance.now() - t0);
    if (onError === 'throw') throw new StuntDoubleError(formatProblems(p), p.problems);
    return p;
  }
  if (opts.write !== false) {
    const claimed = new Set(Object.values(p.table).filter((e) => e.impl?.source === 'app').map((e) => e.slot));
    const check = renderCheckFile({ sdk: p.sdk, table: p.table, checkFile: p.checkFile, genDir: p.genDir, overridesDir: p.overridesDir, layers: p.layers, rel: p.rel, claimedSlots: claimed });
    p.changedFiles = emitAll(p, check);
  }
  p.ms = Math.round(performance.now() - t0);
  return p;
}

/** Re-run with the same options (adapters call this on every start / file change). */
export function regenerate(p, overrides = {}) {
  return generate({ ...p.opts, root: p.root, ...overrides });
}
