// Unit-test helpers: tiny projects with a fake, already-"installed" slot-ready SDK, written to a temp dir. No
// package manager, no bundler: the pure core only needs files on disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(PKG_ROOT, '../..');

let counter = 0;
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'stunt-double-unit-'));
process.on('exit', () => { if (!process.env.STUNT_DOUBLE_KEEP) fs.rmSync(BASE, { recursive: true, force: true }); });

/** A fresh empty directory (realpath, so it compares equal to what the core reports). */
export function tmpDir(name = 'p') {
  const d = path.join(BASE, `${name}-${++counter}`);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}

export function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
  return root;
}

export const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Slots of the default fake SDK: Button (client, default), Card (shared, default), Logo (client, REQUIRED). */
export const SLOTS = {
  Button: { export: 'Button', kind: 'client', default: 'dist/original/Button.js', consumers: ['Dialog'] },
  Card: { export: 'Card', kind: 'shared', default: 'dist/original/Card.js', consumers: [] },
  Logo: { export: 'Logo', kind: 'client', required: true, consumers: ['Dialog'] },
};

/** Default contract of a value slot in the fake SDK (override per slot with fakeSdk({ valueTypes })). */
export const VALUE_TYPE = '(amount: number, currency?: string) => string';

/** contracts.d.ts: SlotProps for component slots, SlotTypes for value slots (kind "value"). */
function contractsDts(slots, abi, o) {
  const comps = Object.keys(slots).filter((s) => slots[s].kind !== 'value');
  const values = Object.keys(slots).filter((s) => slots[s].kind === 'value');
  return [
    `import type { ReactNode } from 'react';`,
    ...(o.contractsPrelude ? [o.contractsPrelude] : []),
    `export interface SlotProps {`,
    ...comps.map((s) => `  ${s}: { children?: ReactNode; variant?: 'primary' | 'secondary'; onClick?: () => void };`),
    `}`,
    ...(values.length ? [`export interface SlotTypes {`, ...values.map((s) => `  ${s}: ${o.valueTypes?.[s] ?? VALUE_TYPE};`), `}`] : []),
    `export type SlotName = keyof SlotProps${values.length ? ' | keyof SlotTypes' : ''};`,
    `export type SlotAbi = '${abi ?? 'unset'}';`,
  ].join('\n') + '\n';
}

/**
 * A slot-ready SDK package directory (what `npm install @acme/core` leaves in node_modules).
 * @param {string} dir     the package directory
 * @param {object} [o]     { name, version, slots, removedSlots, files (extra/overriding files), manifest (extra keys),
 *                          valueTypes / valueDefaults / contractsPrelude (value slots: contract type, default source) }
 */
export function fakeSdk(dir, o = {}) {
  const name = o.name ?? '@acme/core';
  const slotPackage = o.slotPackage ?? `${name}-slots`;
  const version = o.version ?? '1.0.0';
  const slots = o.slots ?? SLOTS;
  const abi = o.manifest && 'abi' in o.manifest ? o.manifest.abi : `${slotPackage.replace(/^@/, '').replace('/', '-')}/${version}+abc123`;
  const files = {
    'package.json': {
      name, version, type: 'module', sideEffects: false,
      main: './dist/index.js', types: './dist/index.d.ts',
      exports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './original/*': { types: './dist/original/*.d.ts', default: './dist/original/*.js' },
        './contracts': { types: './dist/contracts.d.ts' },
        './slot-manifest.json': './slot-manifest.json',
        './package.json': './package.json',
      },
      files: ['dist', 'slot-manifest.json'],
      peerDependencies: { react: '>=18', [slotPackage]: '*' },
    },
    'slot-manifest.json': {
      schema: 1, stuntDouble: '>=0.1.0 <1.0.0', sdk: name, version, abi,
      slotPackage, originalSpecifier: `${name}/original/`, slots, removedSlots: o.removedSlots ?? {}, ...o.manifest,
    },
    'dist/index.js': [
      ...Object.keys(slots).map((s) => `export { ${slots[s].export ?? s} } from '${slotPackage}/${s}';`),
      `export { Dialog } from './Dialog.js';`,
    ].join('\n') + '\n',
    'dist/index.d.ts': [
      ...Object.keys(slots).filter((s) => slots[s].default).map((s) => `export { ${slots[s].export ?? s} } from './original/${s}.js';`),
      `export { Dialog } from './Dialog.js';`,
    ].join('\n') + '\n',
    'dist/Dialog.js': `'use client';\nimport { jsx } from 'react/jsx-runtime';\n${Object.keys(slots).map((s) => `import { ${slots[s].export ?? s} } from '${slotPackage}/${s}';`).join('\n')}\nexport function Dialog() { return jsx('div', {}); }\n`,
    'dist/Dialog.d.ts': `export declare function Dialog(): import('react').ReactNode;\n`,
    'dist/contracts.d.ts': contractsDts(slots, abi, o),
  };
  for (const [s, meta] of Object.entries(slots)) {
    if (!meta.default) continue;
    const exp = meta.export ?? s;
    if (meta.kind === 'value') {
      files[meta.default] = `export const ${exp} = ${o.valueDefaults?.[s] ?? '(amount, currency = "USD") => `${currency} ${amount}`'};\n`;
      files[meta.default.replace(/\.js$/, '.d.ts')] = `export declare const ${exp}: import('../contracts.js').SlotTypes['${s}'];\n`;
      continue;
    }
    files[meta.default] = `${meta.kind === 'client' ? "'use client';\n" : ''}export function ${exp}(props) { return props.children ?? null; }\n`;
    files[meta.default.replace(/\.js$/, '.d.ts')] = `export declare function ${exp}(props: { children?: import('react').ReactNode; variant?: 'primary' | 'secondary'; onClick?: () => void }): import('react').ReactNode;\n`;
  }
  write(dir, { ...files, ...o.files });
  return { name, slotPackage, version, dir };
}

/**
 * A project with the fake SDK installed in node_modules and the given source files.
 * @param {object} [o]  { files: { 'src/overrides/Button.tsx': '...' }, config, sdk (fakeSdk options), pkg (package.json extra) }
 */
export function project(o = {}) {
  const root = tmpDir(o.name ?? 'app');
  const sdk = fakeSdk(path.join(root, 'node_modules', ...(o.sdk?.name ?? '@acme/core').split('/')), o.sdk);
  write(root, {
    'package.json': { name: 'app', version: '0.0.0', private: true, type: 'module', dependencies: { [sdk.name]: sdk.version }, ...o.pkg },
    ...(o.config ? { 'stunt-double.config.json': o.config } : {}),
    ...o.files,
  });
  return { root, sdk };
}

/** Override sources used across tests. */
export const SRC = {
  wrapButton: `import { Button as Original } from '@acme/core/original/Button';\nexport function Button(props) { return <span><Original {...props} /></span>; }\n`,
  logo: `export function Logo() { return <svg />; }\n`,
};

/** Make the repo's TypeScript and @types/react visible to a temp project (for real type-gate runs), or null. */
export function linkTypeScript(root) {
  const req = createRequire(path.join(REPO_ROOT, 'package.json'));
  let ts;
  let types;
  try { ts = path.dirname(req.resolve('typescript/package.json')); types = path.dirname(req.resolve('@types/react/package.json')); } catch { return null; }
  fs.mkdirSync(path.join(root, 'node_modules', '@types'), { recursive: true });
  fs.symlinkSync(ts, path.join(root, 'node_modules', 'typescript'), 'dir');
  fs.symlinkSync(types, path.join(root, 'node_modules', '@types', 'react'), 'dir');
  try {
    const csstype = path.dirname(createRequire(path.join(types, 'package.json')).resolve('csstype/package.json'));
    fs.symlinkSync(csstype, path.join(root, 'node_modules', 'csstype'), 'dir');
  } catch {}
  return JSON.parse(fs.readFileSync(path.join(ts, 'package.json'), 'utf8')).version;
}
