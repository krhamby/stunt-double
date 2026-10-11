// Resolve and validate the SDK's slot-manifest.json (and optional brand layers' "slotLayer" fields).
// Resolution goes through Node's resolver from the project root, so pnpm and Yarn PnP layouts work.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { readJson, real, sha, findPackageJson } from './util.mjs';

export const TOOL_VERSION = readJson(fileURLToPath(new URL('../../package.json', import.meta.url))).version;
export const MANIFEST_FILE = 'slot-manifest.json';
const SLOT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function resolveManifest(name, root) {
  const req = createRequire(path.join(root, 'package.json'));
  try { return req.resolve(`${name}/${MANIFEST_FILE}`); } catch {}
  const pj = findPackageJson(name, root);
  if (pj && fs.existsSync(path.join(path.dirname(pj), MANIFEST_FILE))) return path.join(path.dirname(pj), MANIFEST_FILE);
  return null;
}

/** The one dependency of the project that ships a slot manifest. */
export function detectSdk(root) {
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
  const found = [];
  for (const n of names) {
    if (n === 'stunt-double') continue;
    const m = resolveManifest(n, root);
    if (!m) continue;
    const json = readJson(m);
    if (json && json.schema !== undefined && json.slots) found.push(n);
  }
  return found;
}

/**
 * Returns { sdk, problems }. `sdk` is null when the manifest cannot be used at all (fail closed: nothing is
 * generated, every tool then fails on the missing shims or the registry placeholder).
 */
export function loadSdk(root, cfg) {
  const problems = [];
  let name = cfg.sdk;
  if (!name) {
    const found = detectSdk(root);
    if (found.length !== 1) {
      problems.push(found.length
        ? `[SETUP] several dependencies ship a ${MANIFEST_FILE} (${found.join(', ')}): set "sdk" in stunt-double.config.json.`
        : `[SETUP] no dependency in package.json ships a ${MANIFEST_FILE}. Install the SDK, or set "sdk" in stunt-double.config.json.`);
      return { sdk: null, problems };
    }
    name = found[0];
  }
  const file = resolveManifest(name, root);
  if (!file) {
    problems.push(`[SETUP] cannot resolve ${name}/${MANIFEST_FILE} from ${root}: is ${name} installed (npm install), and does it support stunt-double slots?`);
    return { sdk: null, problems };
  }
  const text = fs.readFileSync(file, 'utf8');
  let m;
  try { m = JSON.parse(text); } catch (e) {
    problems.push(`[SETUP] ${name}/${MANIFEST_FILE} is not valid JSON: ${e.message}`);
    return { sdk: null, problems };
  }
  if (m.schema !== 1) {
    problems.push(`[SETUP] ${name}/${MANIFEST_FILE} uses schema ${JSON.stringify(m.schema)}; stunt-double ${TOOL_VERSION} understands schema 1. Upgrade stunt-double.`);
    return { sdk: null, problems };
  }
  if (m.stuntDouble && !semver.satisfies(TOOL_VERSION, m.stuntDouble, { includePrerelease: true }))
    problems.push(`[SETUP] ${name}@${m.version} needs stunt-double ${m.stuntDouble}, but ${TOOL_VERSION} is installed: npm i -D stunt-double@"${m.stuntDouble}".`);
  if (!m.slotPackage || typeof m.slotPackage !== 'string') problems.push(`[SETUP] ${name}/${MANIFEST_FILE} has no "slotPackage".`);
  const slots = m.slots && typeof m.slots === 'object' ? m.slots : {};
  for (const s of Object.keys(slots)) if (!SLOT_NAME.test(s)) problems.push(`[SETUP] ${name}/${MANIFEST_FILE}: slot name "${s}" is not a valid identifier.`);
  const dir = path.dirname(file);
  const pkg = readJson(path.join(dir, 'package.json')) ?? {};
  const sdk = {
    name: m.sdk ?? name,
    version: m.version ?? pkg.version ?? '0.0.0',
    dir,
    realDir: real(dir),
    manifestFile: file,
    manifest: m,
    hash: sha(text),
    abi: m.abi ?? null,
    slotPackage: m.slotPackage,
    originalSpecifier: m.originalSpecifier ?? `${name}/original/`,
    slots,
    slotNames: Object.keys(slots).sort(),
    removedSlots: m.removedSlots ?? {},
    /** absolute path of a slot's default implementation file (or null for required slots) */
    defaultFile(slot) {
      const d = slots[slot]?.default;
      return d ? path.join(dir, d) : null;
    },
    exportOf(slot) {
      return slots[slot]?.export ?? slot;
    },
  };
  if (sdk.name !== name) problems.push(`[SETUP] ${name}/${MANIFEST_FILE} declares "sdk": "${sdk.name}" but was installed as ${name}.`);
  for (const s of sdk.slotNames) {
    const meta = slots[s];
    if (!meta.required && !meta.default) problems.push(`[SETUP] ${name}@${sdk.version} slot "${s}" has neither a default nor "required": true (SDK bug; sdk-lint rejects this).`);
    if (meta.default && !fs.existsSync(path.join(dir, meta.default))) problems.push(`[SETUP] ${name}@${sdk.version} slot "${s}" default ${meta.default} is missing from the installed package.`);
  }
  return { sdk, problems };
}

/**
 * Brand layers (spec 4.5): packages with a "slotLayer" field that provide implementations between the app
 * and the SDK defaults. L1 = built for another SDK, L2 = SDK version outside the layer's range.
 */
export function loadLayers(root, cfg, sdk) {
  const problems = [];
  const layers = [];
  for (const name of cfg.layers ?? []) {
    const pj = findPackageJson(name, root);
    if (!pj) { problems.push(`[L1] layer ${name} is listed in stunt-double.config.json "layers" but is not installed.`); continue; }
    const pkg = readJson(pj) ?? {};
    const sl = pkg.slotLayer;
    if (!sl || sl.schema !== 1) { problems.push(`[L1] ${name} is not a stunt-double layer (package.json has no "slotLayer" with schema 1).`); continue; }
    if (sl.sdk !== sdk.name) { problems.push(`[L1] layer ${name}@${pkg.version} is built for ${sl.sdk}, not ${sdk.name}.`); continue; }
    if (sl.sdkRange && !semver.satisfies(sdk.version, sl.sdkRange, { includePrerelease: true }))
      problems.push(`[L2] layer ${name}@${pkg.version} supports ${sdk.name}@${sl.sdkRange}, but ${sdk.version} is installed: upgrade the layer or pin the SDK.`);
    const dir = path.dirname(pj);
    const slots = {};
    for (const [s, impl] of Object.entries(sl.slots ?? {})) {
      if (!sdk.slots[s]) { problems.push(`[F2] layer ${name} implements unknown slot "${s}" (${sdk.name}@${sdk.version} slots: ${sdk.slotNames.join(', ')}).`); continue; }
      slots[s] = { file: path.join(dir, impl.file), export: impl.export ?? sdk.exportOf(s), spec: `${name}/layer/${s}` };
    }
    layers.push({ name, version: pkg.version, dir, realDir: real(dir), slots });
  }
  return { layers, problems };
}
