// Project configuration: stunt-double.config.json, or the "stuntDouble" key in package.json, or defaults.
// JSON only, so every adapter, CI script and editor can read it without executing TypeScript.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readJsonc, fileExists } from './util.mjs';

export const CONFIG_FILE = 'stunt-double.config.json';
export const PACKAGE_KEY = 'stuntDouble';

export const DEFAULTS = Object.freeze({
  sdk: null, // auto-detected: the one dependency that ships a slot-manifest.json
  overridesDir: 'src/overrides',
  slotsDir: 'sdk-slots',
  checkFile: 'src/stunt-double.check.ts',
  tsconfig: null, // auto: tsconfig.json, or the referenced app config of a solution-style tsconfig.json
  typescript: 'typescript', // a package NAME, so an npm alias ("typescript5") can be the gate compiler
  rsc: 'auto',
  layers: [],
  map: {},
  allowOriginalImports: [],
  singletons: ['react', 'react-dom'],
  scanPackages: [],
  relativeEdges: 'error',
  sourceDirs: ['src'],
});

const KNOWN = new Set(['$schema', ...Object.keys(DEFAULTS)]);
const MAP_KEYS = new Set(['from', 'export', 'ignoresProps']);

/**
 * Load the config. `overrides` (adapter options) win over the file. Unknown keys are errors: a typo in the
 * config must fail loudly, exactly like a typo in an override file name.
 */
export function loadConfig(root, overrides = {}) {
  const problems = [];
  let file = null;
  let raw = {};
  let source = 'defaults';
  const explicit = overrides.configFile ? path.resolve(root, overrides.configFile) : null;
  const cfgPath = explicit ?? path.join(root, CONFIG_FILE);
  if (fileExists(cfgPath)) {
    file = cfgPath;
    source = path.basename(cfgPath);
    raw = readJsonc(cfgPath);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(`[CFG] ${path.basename(cfgPath)} is not a JSON object.`);
      raw = {};
    }
  } else if (explicit) {
    problems.push(`[CFG] config file ${overrides.configFile} does not exist.`);
  } else {
    const pkg = readJson(path.join(root, 'package.json'));
    if (pkg && pkg[PACKAGE_KEY] && typeof pkg[PACKAGE_KEY] === 'object') {
      raw = pkg[PACKAGE_KEY];
      file = path.join(root, 'package.json');
      source = `package.json "${PACKAGE_KEY}"`;
    }
  }
  for (const k of Object.keys(raw)) if (!KNOWN.has(k)) problems.push(`[CFG] unknown key "${k}" in ${source}. Known keys: ${[...KNOWN].filter((x) => x !== '$schema').join(', ')}.`);
  const pick = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (overrides[k] !== undefined) pick[k] = overrides[k];
    else if (raw[k] !== undefined) pick[k] = raw[k];
    else pick[k] = DEFAULTS[k];
  }
  const cfg = { ...pick, layers: [...(pick.layers ?? [])], map: { ...(pick.map ?? {}) } };
  for (const [slot, entry] of Object.entries(cfg.map)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`[CFG] map."${slot}" must be an object like {"from": "src/brand/Logo.tsx", "export": "Logo"}.`); continue; }
    for (const k of Object.keys(entry)) if (!MAP_KEYS.has(k)) problems.push(`[CFG] unknown key map."${slot}".${k} in ${source} (known: from, export, ignoresProps).`);
    if (entry.ignoresProps !== undefined && !Array.isArray(entry.ignoresProps)) problems.push(`[CFG] map."${slot}".ignoresProps must be an array of prop names.`);
  }
  for (const k of ['layers', 'allowOriginalImports', 'singletons', 'scanPackages', 'sourceDirs'])
    if (!Array.isArray(cfg[k])) problems.push(`[CFG] "${k}" must be an array.`);
  if (!['auto', true, false].includes(cfg.rsc)) problems.push(`[CFG] "rsc" must be "auto", true or false.`);
  if (!['error', 'redirect'].includes(cfg.relativeEdges)) problems.push(`[CFG] "relativeEdges" must be "error" or "redirect".`);
  return { cfg, configFile: file, configSource: source, problems };
}

/** Package manager in use (for messages and `init`). */
export function detectPackageManager(root) {
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  const pm = String(pkg.packageManager ?? '').split('@')[0];
  if (pm) return pm;
  for (let d = root; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(d, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(d, 'bun.lock')) || fs.existsSync(path.join(d, 'bun.lockb'))) return 'bun';
    if (fs.existsSync(path.join(d, 'package-lock.json'))) return 'npm';
    if (path.dirname(d) === d) break;
  }
  const ua = process.env.npm_config_user_agent ?? '';
  return ['pnpm', 'yarn', 'bun'].find((x) => ua.startsWith(x)) ?? 'npm';
}

export function detectPnP(root) {
  if (process.versions.pnp) return true;
  for (let d = root; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.pnp.cjs'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

const RSC_PACKAGES = ['next', 'waku', '@vitejs/plugin-rsc'];
/** rsc:"auto" emits "use client" only when an RSC runtime is a dependency (Parcel duplicates React otherwise). */
export function detectRsc(root, setting) {
  if (setting === true || setting === false) return setting;
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.keys(deps).some((d) => RSC_PACKAGES.includes(d) || d.startsWith('react-server-dom-'));
}
