// `stunt-double sdk-lint [pkgDir] [--fix] [--write]`: the SDK's publish gate. Uses the same dist scanner that
// every project runs on the installed SDK. With --fix it first points the published .d.ts files at the originals
// instead of the sockets (sdkdts.mjs; rule SDK6). With --write it also computes manifest `consumers` (W7) and
// the `abi` pin, rewrites `export type SlotAbi` in contracts.d.ts, and writes stunt-double.schema.json.
import fs from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { scanDist } from './distscan.mjs';
import { parseModule } from './parse.mjs';
import { DEFAULTS } from './config.mjs';
import { rewriteSocketDts, publishedDtsFiles, socketMentions } from './sdkdts.mjs';
import { readJson, real, sha, posix, fileExists } from './util.mjs';
import { SLOT_KINDS, kindOf } from './manifest.mjs';

function findPackageDir(start) {
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (fileExists(path.join(d, 'package.json')) && fileExists(path.join(d, 'slot-manifest.json'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

/** Property names of the interface (or type literal) `name` in a contracts.d.ts, or null if it is not declared. */
export function contractKeys(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const { program } = parseSync(file, src, { lang: 'dts' });
  for (const st of program.body) {
    const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (!d) continue;
    if (d.type === 'TSInterfaceDeclaration' && d.id.name === name) return d.body.body.map((m) => m.key?.name ?? m.key?.value).filter(Boolean);
    if (d.type === 'TSTypeAliasDeclaration' && d.id.name === name && d.typeAnnotation.type === 'TSTypeLiteral')
      return d.typeAnnotation.members.map((m) => m.key?.name ?? m.key?.value).filter(Boolean);
  }
  return null;
}

/** Property names of `SlotProps` (component slot contracts) in contracts.d.ts. */
export function contractSlots(file) {
  return contractKeys(file, 'SlotProps');
}

function entryFile(pkgDir, pkg) {
  const e = pkg.exports?.['.'];
  const target = typeof e === 'string' ? e : e?.import ?? e?.default ?? pkg.module ?? pkg.main ?? 'index.js';
  return path.join(pkgDir, typeof target === 'string' ? target : target.default);
}

export function abiOf(manifest, contractsText, slotPackage, version) {
  const canon = { ...manifest, abi: undefined, slots: Object.fromEntries(Object.entries(manifest.slots).map(([k, v]) => [k, { ...v, consumers: undefined }])) };
  const contracts = contractsText.replace(/export\s+(declare\s+)?type\s+SlotAbi\s*=\s*[^;]+;/, '');
  const h = sha(JSON.stringify(canon) + '\n' + contracts, 6);
  return `${slotPackage.replace(/^@/, '').replace('/', '-')}/${version}+${h}`;
}

export function schemaFor(manifest) {
  const slots = Object.keys(manifest.slots);
  const str = { type: 'string' };
  const arr = { type: 'array', items: { type: 'string' } };
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `stunt-double config for ${manifest.sdk}@${manifest.version}`,
    type: 'object',
    additionalProperties: false,
    properties: {
      $schema: str,
      sdk: { const: manifest.sdk },
      overridesDir: { ...str, default: DEFAULTS.overridesDir },
      outDir: { ...str, default: '.stunt-double', description: 'the one generated directory (the universal tier derives it from the link)' },
      tsconfig: str,
      typescript: { ...str, default: 'typescript', description: 'package name of the gate compiler, e.g. "typescript5" (npm alias of typescript@5.9)' },
      rsc: { enum: ['auto', true, false] },
      layers: arr,
      map: {
        type: 'object',
        propertyNames: { enum: slots },
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          properties: { from: str, export: str, ignoresProps: arr },
        },
      },
      allowOriginalImports: arr,
      singletons: arr,
      scanPackages: arr,
      relativeEdges: { enum: ['error'] },
      sourceDirs: arr,
    },
  };
}

/**
 * @returns {{ ok: boolean, errors: string[], warnings: string[], written: string[], manifest: object, pkgDir: string }}
 */
export function sdkLint(start = process.cwd(), { write = false, fix = false } = {}) {
  const pkgDir = findPackageDir(start);
  if (!pkgDir) return { ok: false, errors: [`[SDK] no package.json + slot-manifest.json found at or above ${start}`], warnings: [], written: [] };
  const pkg = readJson(path.join(pkgDir, 'package.json'));
  const manifestFile = path.join(pkgDir, 'slot-manifest.json');
  const manifest = readJson(manifestFile);
  const errors = [];
  const warnings = [];
  const written = [];
  const rel = (f) => posix(path.relative(pkgDir, f));
  if (!manifest) return { ok: false, errors: ['[SDK] slot-manifest.json is not valid JSON'], warnings, written, pkgDir };
  if (manifest.schema !== 1) errors.push(`[SDK] slot-manifest.json "schema" must be 1`);
  if (manifest.sdk !== pkg.name) errors.push(`[SDK] slot-manifest.json "sdk" is "${manifest.sdk}" but package.json name is "${pkg.name}"`);
  if (manifest.version !== pkg.version) errors.push(`[SDK] slot-manifest.json "version" is "${manifest.version}" but package.json version is "${pkg.version}"`);
  const slotPackage = manifest.slotPackage;
  const originalSpecifier = manifest.originalSpecifier ?? `${pkg.name}/original/`;
  const slots = manifest.slots ?? {};
  const slotNames = Object.keys(slots).sort();
  const sdk = {
    name: pkg.name, version: pkg.version, dir: pkgDir, realDir: real(pkgDir), hash: 'lint', slots, slotNames, slotPackage, originalSpecifier,
    defaultFile: (s) => (slots[s]?.default ? path.join(pkgDir, slots[s].default) : null),
    exportOf: (s) => slots[s]?.export ?? s,
  };
  // rule 6 (--fix): published declarations point at the originals, never at the socket package
  if (fix && slotPackage) {
    const r = rewriteSocketDts({ pkgDir, pkg, manifest });
    errors.push(...r.errors);
    written.push(...r.written);
  }
  if (slotPackage) for (const f of publishedDtsFiles(pkgDir, pkg)) {
    if (/(^|[\\/])contracts\.d\.[cm]?ts$/.test(f)) continue; // rule 3 reports contracts precisely
    for (const m of socketMentions(f, slotPackage))
      errors.push(`[SDK6] ${rel(f)}:${m.line} references "${m.spec}": published types must not mention ${slotPackage} (apps resolve it to the registry placeholder and would need tsconfig "paths"). Run stunt-double sdk-lint --fix after tsc.`);
  }
  // package.json shape
  const ex = pkg.exports ?? {};
  for (const k of ['./original/*', './contracts', './slot-manifest.json']) if (!ex[k]) errors.push(`[SDK] package.json "exports" lacks "${k}"`);
  if (pkg.peerDependencies?.[slotPackage] !== '*') errors.push(`[SDK] package.json must declare the REQUIRED peer "${slotPackage}": "*" (no range: a range deadlocks SDK upgrades)`);
  if (pkg.peerDependenciesMeta?.[slotPackage]?.optional) errors.push(`[SDK] the "${slotPackage}" peer must not be optional (Vite turns a missing optional peer into a runtime throw)`);
  // rule 5: required XOR default
  for (const s of slotNames) {
    const m = slots[s];
    if (m.required && m.default) errors.push(`[SDK5] slot "${s}" is required AND has a default (${m.default}): pick one`);
    if (!m.required && !m.default) errors.push(`[SDK5] slot "${s}" has no default and is not required`);
    if (m.default && !fileExists(path.join(pkgDir, m.default))) errors.push(`[SDK5] slot "${s}" default ${m.default} does not exist (build first)`);
    if (!SLOT_KINDS.includes(kindOf(m))) errors.push(`[SDK] slot "${s}" kind must be one of ${SLOT_KINDS.join(', ')} (client, shared and server are components; value is anything else)`);
  }
  // rule 1 (+ unknown sockets, rule 2a): the shared dist scanner
  const dist = scanDist({ sdk, pkgDir, rel });
  errors.push(...dist.edges.map((e) => `[SDK1] ${rel(e.file)} imports the default of slot "${e.slot}" directly ("${e.spec}"): import "${slotPackage}/${e.slot}" instead (overrides could never reach this position)`));
  errors.push(...dist.unknownSockets.map((u) => `[SDK2] ${rel(u.file)} imports socket "${slotPackage}/${u.slot}", which is not in slot-manifest.json`));
  // rule 2b + 3: contracts
  const contracts = ['dist/contracts.d.ts', 'contracts.d.ts'].map((f) => path.join(pkgDir, f)).find(fileExists);
  let contractsText = '';
  const valueSlots = slotNames.filter((s) => kindOf(slots[s]) === 'value');
  const componentSlots = slotNames.filter((s) => kindOf(slots[s]) !== 'value');
  if (!contracts) errors.push(`[SDK2] no contracts.d.ts (dist/contracts.d.ts) with "export interface SlotProps"${valueSlots.length ? ' and "export interface SlotTypes"' : ''}`);
  else {
    contractsText = fs.readFileSync(contracts, 'utf8');
    // component slots are typed by their props (SlotProps), value slots by their whole type (SlotTypes)
    const sides = [
      { iface: 'SlotProps', own: componentSlots, what: 'component', other: 'SlotTypes' },
      { iface: 'SlotTypes', own: valueSlots, what: 'value', other: 'SlotProps' },
    ];
    for (const { iface, own, what, other } of sides) {
      const keys = contractKeys(contracts, iface);
      if (!keys) {
        if (own.length) errors.push(`[SDK2] ${rel(contracts)} does not export ${iface}, which types the ${what} slot${own.length > 1 ? 's' : ''} ${own.join(', ')}`);
        continue;
      }
      for (const s of own) if (!keys.includes(s)) errors.push(`[SDK2] ${what} slot "${s}" has no ${iface} entry in ${rel(contracts)}`);
      for (const k of keys) {
        if (!slots[k]) errors.push(`[SDK2] ${iface}["${k}"] in ${rel(contracts)} is not a slot in slot-manifest.json`);
        else if (!own.includes(k)) errors.push(`[SDK2] ${iface}["${k}"] in ${rel(contracts)}: "${k}" is a ${kindOf(slots[k]) === 'value' ? 'value' : 'component'} slot, so its contract belongs in ${other}`);
      }
    }
    for (const e of parseModule(contracts).edges)
      if (e.spec === slotPackage || e.spec.startsWith(slotPackage + '/'))
        errors.push(`[SDK3] ${rel(contracts)} imports "${e.spec}": contracts must import props RELATIVELY from the originals (a project's tsconfig paths would compare an override with itself)`);
    if (!/export\s+(declare\s+)?type\s+SlotAbi\b/.test(contractsText)) warnings.push(`[SDK] ${rel(contracts)} has no "export type SlotAbi": projects cannot pin the ABI (staleness after upgrades is then caught only by the slot set)`);
  }
  // rule 4: "use client" on client defaults and on files rendering client slots
  const clientSlots = new Set(slotNames.filter((s) => (slots[s].kind ?? 'client') === 'client'));
  for (const s of clientSlots) {
    const d = sdk.defaultFile(s);
    if (d && fileExists(d) && dist.directives[rel(d)] !== 'use client') errors.push(`[SDK4] ${rel(d)} is the default of client slot "${s}" but has no "use client" directive`);
  }
  for (const [s, files] of Object.entries(dist.socketConsumers))
    if (clientSlots.has(s)) for (const f of files) {
      const r = rel(f);
      if (/(^|\/)index\.[cm]?js$/.test(r)) continue; // the barrel only re-exports
      if (dist.directives[r] !== 'use client') errors.push(`[SDK4] ${r} renders client slot "${s}" but has no "use client" directive`);
    }
  // consumers: barrel exports whose module (transitively, via relative imports) renders a slot
  const reach = new Map();
  const reachOf = (file, stack = new Set()) => {
    if (reach.has(file)) return reach.get(file);
    if (stack.has(file)) return new Set();
    stack.add(file);
    const out = new Set();
    for (const e of parseModule(file).edges) {
      if (e.spec.startsWith(slotPackage + '/')) out.add(e.spec.slice(slotPackage.length + 1));
      else if (e.spec.startsWith('.')) {
        const t = [path.resolve(path.dirname(file), e.spec)].find(fileExists);
        if (t) for (const x of reachOf(real(t), stack)) out.add(x);
      }
    }
    stack.delete(file);
    reach.set(file, out);
    return out;
  };
  const consumers = Object.fromEntries(slotNames.map((s) => [s, []]));
  const entry = entryFile(pkgDir, pkg);
  if (fileExists(entry)) {
    for (const e of parseModule(entry).edges) {
      if (e.kind !== 'export' || !e.spec.startsWith('.')) continue;
      const t = path.resolve(path.dirname(entry), e.spec);
      if (!fileExists(t)) continue;
      const r = reachOf(real(t));
      for (const n of e.names ?? []) if (n.local && n.local !== 'default' && !n.isType) for (const s of r) if (consumers[s] && !slots[n.local]) consumers[s].push(n.local);
    }
  } else warnings.push(`[SDK] entry ${rel(entry)} not found: consumers (W7) not computed`);
  if (write) {
    for (const s of slotNames) slots[s].consumers = [...new Set(consumers[s])].sort();
    manifest.abi = abiOf(manifest, contractsText, slotPackage, pkg.version);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    written.push(rel(manifestFile));
    if (contracts && /export\s+(declare\s+)?type\s+SlotAbi\b/.test(contractsText)) {
      fs.writeFileSync(contracts, contractsText.replace(/(export\s+(?:declare\s+)?type\s+SlotAbi\s*=\s*)[^;]+;/, `$1'${manifest.abi}';`));
      written.push(rel(contracts));
    }
    fs.writeFileSync(path.join(pkgDir, 'stunt-double.schema.json'), JSON.stringify(schemaFor(manifest), null, 2) + '\n');
    written.push('stunt-double.schema.json');
  } else if (contracts && manifest.abi && manifest.abi !== abiOf(manifest, contractsText, slotPackage, pkg.version)) {
    errors.push(`[SDK] slot-manifest.json "abi" (${manifest.abi}) is stale: run stunt-double sdk-lint --write after building`);
  }
  return { ok: errors.length === 0, errors, warnings, written, manifest, pkgDir };
}
