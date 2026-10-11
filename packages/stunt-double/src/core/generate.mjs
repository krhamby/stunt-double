// The generator: STA (static validation) + emit. Called at every adapter start, by `stunt-double gen|check`
// and by the root postinstall. Synchronous so it can run inside any tool's config file.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, detectPackageManager, detectPnP, detectRsc } from './config.mjs';
import { loadSdk, loadLayers, TOOL_VERSION } from './manifest.mjs';
import { scanOverrides } from './scan.mjs';
import { buildPlan } from './plan.mjs';
import { scanDist } from './distscan.mjs';
import { checkWiring } from './wiring.mjs';
import { checkSingletons } from './singletons.mjs';
import { scanBypass } from './bypass.mjs';
import { renderCheckFile } from './checkfile.mjs';
import { emitAll, emitPoison } from './emit.mjs';
import { pickAppTsconfig, tsconfigCovers } from './tsconfig.mjs';
import { formatProblems } from './diagnostics.mjs';
import { real, posix, sha, esc, isInside, globToRegExp, cleanId, fileExists } from './util.mjs';

export class StuntDoubleError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'StuntDoubleError';
    this.problems = problems;
  }
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
  const slotsDir = path.resolve(root, cfg.slotsDir);
  const genDir = path.join(slotsDir, 'gen');
  const checkFile = path.resolve(root, cfg.checkFile);
  const realOverrides = real(overridesDir);
  const allowRe = (cfg.allowOriginalImports ?? []).map(globToRegExp);
  const p = {
    toolVersion: TOOL_VERSION,
    root, cfg, configFile, configSource, opts, rel,
    overridesDir, slotsDir, genDir, checkFile,
    pm: detectPackageManager(root),
    isPnP: detectPnP(root),
    rsc: detectRsc(root, cfg.rsc),
    problems: [...cfgProblems],
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

  const { sdk, problems: sdkProblems } = loadSdk(root, cfg);
  p.problems.push(...sdkProblems);
  if (!sdk) return finish(p, onError, opts, t0);
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

  p.tsconfig = pickAppTsconfig(root, cfg.tsconfig, checkFile);
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
  p.problems.push(...scanBypass({ root, sdk, cfg, overridesDir, genDir, checkFile, implFiles: p.implFiles.filter((f) => !isInside(f, overridesDir)), rel }));

  // dist scan of the INSTALLED SDK and layers (F6a), always run, cached per package content
  const dist = scanDist({ sdk, pkgDir: sdk.dir, rel, cacheFile: opts.write === false ? null : path.join(genDir, 'dist-scan.json') });
  p.problems.push(...dist.problems);
  p.socketConsumers = dist.socketConsumers;
  for (const l of layers) {
    const ld = scanDist({ sdk, pkgDir: l.dir, label: l.name, rel, allowFiles: Object.values(l.slots).map((x) => x.file) });
    p.problems.push(...ld.problems);
    for (const [s, files] of Object.entries(ld.socketConsumers)) (p.socketConsumers[s] ??= []).push(...files);
  }
  for (const s of sdk.slotNames) { const d = sdk.defaultFile(s); if (d) p.defaultFileToSlot.set(real(d), s); }
  for (const l of layers) for (const [s, impl] of Object.entries(l.slots)) p.defaultFileToSlot.set(real(impl.file), s);

  // wiring self-test (F6f / F8b) and singleton preflight (F8)
  const wiring = checkWiring({ root, sdk, slotsDir, rel, pm: p.pm });
  p.linkDeclared = wiring.linkDeclared;
  p.problems.push(...wiring.problems);
  const overrideDirs = [...new Set([overridesDir, ...p.implFiles.map((f) => path.dirname(f))])].filter((d) => fs.existsSync(d));
  p.problems.push(...checkSingletons({ root, sdk, slotsDir, layers, overrideDirs, singletons: cfg.singletons, rel }));

  // X2: the check file must be part of the project's own tsc program (tsc / next build / IDE)
  p.tsconfigCoversCheckFile = !!p.tsconfig && tsconfigCovers(p.tsconfig, checkFile);
  if (!p.tsconfigCoversCheckFile)
    p.warnings.push(p.tsconfig
      ? `[X2] ${p.tsconfigRel} does not include ${rel(checkFile)}: tsc, next build and the IDE will not check slot contracts (the build's type gate still does). Add it to "files".`
      : `[X2] no tsconfig.json found: tsc and the IDE will not check slot contracts (the build's type gate still does).`);

  const decisions = Object.fromEntries(sdk.slotNames.map((s) => {
    const impl = p.table[s]?.impl;
    return [s, !impl ? null : impl.source === 'app' ? `${rel(impl.file)}#${impl.export}` : impl.spec];
  }));
  p.fingerprint = sha(JSON.stringify({ v: TOOL_VERSION, sdk: `${sdk.name}@${sdk.version}`, h: sdk.hash, abi: sdk.abi, decisions, rsc: p.rsc, layers: layers.map((l) => `${l.name}@${l.version}`) }), 16);
  p.state = { tool: `stunt-double@${TOOL_VERSION}`, sdk: `${sdk.name}@${sdk.version}`, abi: sdk.abi, fingerprint: p.fingerprint, rsc: p.rsc, slots: decisions };
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
    const check = renderCheckFile({ sdk: p.sdk, table: p.table, checkFile: p.checkFile, overridesDir: p.overridesDir, layers: p.layers, rel: p.rel, claimedSlots: claimed });
    p.changedFiles = emitAll(p, check);
  }
  p.ms = Math.round(performance.now() - t0);
  return p;
}

/** Re-run with the same options (adapters call this on every start / file change). */
export function regenerate(p, overrides = {}) {
  return generate({ ...p.opts, root: p.root, ...overrides });
}
