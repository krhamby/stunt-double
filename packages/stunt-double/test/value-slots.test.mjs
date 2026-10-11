// Value slots (kind "value"): anything an SDK wants a project to inject that is not a component: a service, an
// API client, a function, a hook, a class, a config object. Same mechanism as component slots (socket -> shim ->
// override or default), checked against SlotTypes[slot] instead of SlotProps[slot].
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generate, runTypeGate, sdkLint, rewriteDtsFile } from '../src/core/index.mjs';
import { project, write, read, tmpDir, fakeSdk, linkTypeScript, SLOTS, PKG_ROOT } from './helpers.mjs';

const PRELUDE = `export interface Analytics { track(event: string, data?: Record<string, unknown>): void; flush?(): Promise<void> }
export interface ApiClient { get(path: string): Promise<unknown> }`;
const VALUE_SLOTS = {
  ...SLOTS,
  formatPrice: { export: 'formatPrice', kind: 'value', default: 'dist/original/formatPrice.js', consumers: ['Dialog'] },
  analytics: { export: 'analytics', kind: 'value', default: 'dist/original/analytics.js', consumers: [] },
  api: { export: 'api', kind: 'value', required: true, consumers: [] },
};
const SDK = {
  slots: VALUE_SLOTS,
  contractsPrelude: PRELUDE,
  valueTypes: { analytics: 'Analytics', api: 'ApiClient' },
  valueDefaults: { analytics: '{ track() {} }' },
};
const TYPES = `import type { SlotTypes } from '@acme/core/contracts';`;
const API = `${TYPES}\nexport const api: SlotTypes['api'] = { get: async (path) => ({ path }) };\n`;
const PROPS = `import type { SlotProps } from '@acme/core/contracts';`;
const COMPONENTS = {
  'src/overrides/Button.tsx': `import { Button as Original } from '@acme/core/original/Button';\n${PROPS}\nexport function Button(props: SlotProps['Button']) { return <span><Original {...props} /></span>; }\n`,
  'src/overrides/Logo.tsx': `${PROPS}\nexport function Logo(_props: SlotProps['Logo']) { return <svg />; }\n`,
};
const base = { ...COMPONENTS, 'src/overrides/api.ts': API };
const valueProject = (files = {}, o = {}) => project({ sdk: SDK, files: { ...base, ...files }, ...o });
const gen = (root, extra = {}) => generate({ root, onError: 'return', ...extra });
const problems = (p) => p.problems.join('\n');

describe('value slots: generation', () => {
  test('a value override is re-exported by its shim; an untouched value slot re-exports the SDK default', () => {
    const { root } = valueProject({ 'src/overrides/formatPrice.ts': `${TYPES}\nexport const formatPrice: SlotTypes['formatPrice'] = (amount) => \`\${amount} EUR\`;\n` });
    const p = gen(root, { rsc: true });
    assert.deepEqual(p.problems, []);
    const shim = fs.readFileSync(p.shimFile('formatPrice'), 'utf8');
    assert.match(shim, /export \{ formatPrice \} from '[./]*src\/overrides\/formatPrice\.ts'/);
    assert.doesNotMatch(shim, /use client/, 'a value is not a client reference, even with RSC on');
    assert.match(fs.readFileSync(p.shimFile('analytics'), 'utf8'), /export \{ analytics \} from '@acme\/core\/original\/analytics'/);
    assert.equal(p.table.formatPrice.kind, 'value');
  });

  test('the check file types value slots by SlotTypes (fits + argsFit), component slots by SlotProps', () => {
    const { root } = valueProject();
    const p = gen(root);
    const check = fs.readFileSync(p.checkFile, 'utf8');
    assert.match(check, /import type \{ SlotProps, SlotTypes, SlotName, SlotAbi \} from '@acme\/core\/contracts';/);
    assert.match(check, /export const api__impl__fits: SlotTypes\['api'\] = api__impl;/);
    assert.match(check, /export const api__impl__argsFit: FitsArgs<SlotTypes\['api'\], typeof api__impl> = true;/);
    assert.doesNotMatch(check, /api__impl__(isComponent|accepts|declaresAll|notAsync)/);
    assert.match(check, /Button__impl__accepts/);
    assert.match(check, /export type formatPrice__probe = typeof import\('[./]*src\/overrides\/formatPrice'\);/);
  });

  test('[F3] a required value slot without an implementation names a .ts file', () => {
    const { root } = project({ sdk: SDK, files: COMPONENTS });
    assert.match(problems(gen(root)), /\[F3\] required slot "api" has no implementation: create src\/overrides\/api\.ts exporting `api`/);
  });

  test('[F7] a value override that imports itself from the barrel is a circular import, not a render loop', () => {
    const { root } = valueProject({ 'src/overrides/formatPrice.ts': `import { formatPrice as sdk } from '@acme/core';\nexport const formatPrice = (amount: number) => sdk(amount) + '!';\n` });
    const out = problems(gen(root));
    assert.match(out, /\[F7\] src\/overrides\/formatPrice\.ts imports \{ formatPrice \} from "@acme\/core": that is slot "formatPrice" itself \(a circular import: the implementation would read itself before it is initialized\)\. Use the default via '@acme\/core\/original\/formatPrice'\./);
    assert.doesNotMatch(out, /infinite render/);
  });

  test('[W7] a value override importing an SDK export that uses the slot warns about module initialization', () => {
    const { root } = valueProject({ 'src/overrides/formatPrice.ts': `import { Dialog } from '@acme/core';\nexport const formatPrice = (amount: number) => String(amount) + String(Dialog.name);\n` });
    const p = gen(root);
    assert.deepEqual(p.problems, []);
    assert.match(p.warnings.join('\n'), /\[W7\] src\/overrides\/formatPrice\.ts imports Dialog from "@acme\/core", and Dialog uses slot "formatPrice": a circular import/);
  });

  test('[CFG] ignoresProps on a value slot', () => {
    const { root } = valueProject({}, { config: { map: { formatPrice: { ignoresProps: ['x'] } } } });
    assert.match(problems(gen(root)), /\[CFG\] stunt-double\.config\.json map\."formatPrice"\.ignoresProps: "formatPrice" is a value slot/);
  });

  test('[SETUP] a slot kind this version does not know fails closed', () => {
    const { root } = project({ sdk: { slots: { ...SLOTS, Mystery: { kind: 'island', default: 'dist/original/Mystery.js' } } }, files: COMPONENTS });
    assert.match(problems(gen(root)), /\[SETUP\] @acme\/core@1\.0\.0 slot "Mystery" has kind "island", which stunt-double [\d.]+ does not understand \(known: client, shared, server, value\)\. Upgrade stunt-double\./);
  });
});

/** Run the real type gate on a value project; null when TypeScript is not installed at the repo root. */
async function gate(files, o = {}) {
  const { root } = valueProject(files);
  if (o.tsconfig) write(root, { 'tsconfig.json': o.tsconfig });
  const tsVersion = linkTypeScript(root);
  if (!tsVersion) return null;
  const p = gen(root);
  assert.deepEqual(p.problems, []);
  return { r: await runTypeGate(p, { force: true }), tsVersion };
}
const NO_TS = 'typescript / @types/react not installed at the repo root';
/** An app tsconfig with strict OFF (function parameters are then bivariant in plain assignability). */
const LOOSE = {
  compilerOptions: {
    strict: false, target: 'es2022', lib: ['es2022', 'dom'], module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx',
    allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, types: [],
  },
  include: ['src'],
};

describe('value slots: the type gate (real tsc)', () => {
  test('must pass: a typed function, fewer parameters, a class instance, an object with extra members', async (t) => {
    const g = await gate({
      'src/overrides/formatPrice.ts': `export function formatPrice(amount: number) { return amount.toFixed(2); }\n`,
      'src/overrides/analytics.ts': `class Segment { sent: string[] = []; track(event: string) { this.sent.push(event); } async flush() {} }\nexport const analytics = new Segment();\n`,
    });
    if (!g) return t.skip(NO_TS);
    assert.equal(g.r.ok, true, g.r.message);
  });

  test('[F1] a value that does not fit its contract (wrong return type), mapped to the slot and file', async (t) => {
    const g = await gate({ 'src/overrides/formatPrice.ts': `export const formatPrice = (amount: number) => amount * 100;\n` });
    if (!g) return t.skip(NO_TS);
    assert.equal(g.r.ok, false);
    assert.match(g.r.message, /\[F1\] formatPrice \(src\/overrides\/formatPrice\.ts\): does not fit the contract @acme\/core SlotTypes\['formatPrice'\]: TS2322[^\n]*number[^\n]*string/);
  });

  for (const [mode, tsconfig] of [['strict on', null], ['strict OFF', LOOSE]]) {
    test(`[F1] narrowed parameters of a function slot (${mode})`, async (t) => {
      const g = await gate({ 'src/overrides/formatPrice.ts': `export const formatPrice = (amount: 1 | 2) => String(amount);\n` }, { tsconfig });
      if (!g) return t.skip(NO_TS);
      assert.equal(g.r.ok, false, 'a narrowed parameter must fail even where plain assignability is bivariant');
      assert.match(g.r.message, /\[F1\] formatPrice \(src\/overrides\/formatPrice\.ts\): narrows the parameters of the contract \[amount: number, currency\?: string[^\]]*\] \(the SDK may pass any value its contract allows/);
    });

    test(`[F1] a narrowed METHOD parameter, which plain assignability accepts even under strict (${mode})`, async (t) => {
      const g = await gate({ 'src/overrides/analytics.ts': `export const analytics = { track(event: 'click') { return event; } };\n` }, { tsconfig });
      if (!g) return t.skip(NO_TS);
      assert.equal(g.r.ok, false);
      assert.match(g.r.message, /\[F1\] analytics \(src\/overrides\/analytics\.ts\): narrows the parameters of these members: "track"/);
    });
  }
});

describe('value slots: SDK side', () => {
  const lintDir = (o = {}) => {
    const dir = tmpDir('sdk');
    fakeSdk(dir, { ...SDK, ...o, manifest: { abi: null, ...o.manifest } });
    return dir;
  };
  const lint = (dir) => sdkLint(dir).errors.join('\n');

  test('sdk-lint passes an SDK with component and value slots', () => {
    assert.deepEqual(sdkLint(lintDir()).errors, []);
  });

  test('[SDK2] a value slot without a SlotTypes entry, and a contract filed under the wrong interface', () => {
    const dir = lintDir({ files: { 'dist/contracts.d.ts': `${PRELUDE}\nexport interface SlotProps { Button: {}; Card: {}; Logo: {}; analytics: {} }\nexport interface SlotTypes { formatPrice: () => string; api: ApiClient; Card: () => string }\nexport type SlotName = keyof SlotProps | keyof SlotTypes;\n` } });
    const out = lint(dir);
    assert.match(out, /\[SDK2\] value slot "analytics" has no SlotTypes entry/);
    assert.match(out, /\[SDK2\] SlotProps\["analytics"\][^\n]*"analytics" is a value slot, so its contract belongs in SlotTypes/);
    assert.match(out, /\[SDK2\] SlotTypes\["Card"\][^\n]*"Card" is a component slot, so its contract belongs in SlotProps/);
  });

  test('[SDK2] value slots but no SlotTypes interface at all', () => {
    const dir = lintDir({ files: { 'dist/contracts.d.ts': `export interface SlotProps { Button: {}; Card: {}; Logo: {} }\nexport type SlotName = keyof SlotProps;\n` } });
    assert.match(lint(dir), /\[SDK2\] dist\/contracts\.d\.ts does not export SlotTypes, which types the value slots analytics, api, formatPrice/);
  });

  test('[SDK] an unknown kind', () => {
    const dir = lintDir({ slots: { ...VALUE_SLOTS, formatPrice: { ...VALUE_SLOTS.formatPrice, kind: 'service' } } });
    assert.match(lint(dir), /\[SDK\] slot "formatPrice" kind must be one of client, shared, server, value/);
  });

  test('--fix types a required value slot by its whole contract in the published declarations', () => {
    const dir = lintDir({ files: { 'dist/index.d.ts': `export { api } from '@acme/core-slots/api';\nexport { formatPrice } from '@acme/core-slots/formatPrice';\n` } });
    const manifest = JSON.parse(read(dir, 'slot-manifest.json'));
    const r = rewriteDtsFile({ file: path.join(dir, 'dist/index.d.ts'), pkgDir: dir, manifest, contracts: path.join(dir, 'dist/contracts.d.ts') });
    assert.deepEqual(r.errors, []);
    assert.match(r.text, /export declare const api: import\("\.\/contracts\.js"\)\.SlotTypes\["api"\];/);
    assert.match(r.text, /export \{ formatPrice \} from '\.\/original\/formatPrice\.js';/);
  });
});

describe('value slots: CLI', () => {
  const cli = (root, ...args) => {
    try { return { code: 0, out: execFileSync(process.execPath, [path.join(PKG_ROOT, 'bin/stunt-double.mjs'), ...args, '--root', root], { encoding: 'utf8', stdio: 'pipe' }) }; }
    catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
  };

  test('eject writes a typed .ts starter: --wrap starts from the SDK default, --replace fails until implemented', () => {
    const { root } = valueProject();
    assert.equal(cli(root, 'eject', 'formatPrice', '--wrap').code, 0);
    const wrapped = read(root, 'src/overrides/formatPrice.ts');
    assert.match(wrapped, /import \{ formatPrice as original \} from '@acme\/core\/original\/formatPrice';/);
    assert.match(wrapped, /export const formatPrice: SlotTypes\['formatPrice'\] = original;/);
    assert.equal(cli(root, 'eject', 'analytics', '--replace').code, 0);
    assert.match(read(root, 'src/overrides/analytics.ts'), /export const analytics: SlotTypes\['analytics'\] = TODO_implement_analytics;/);
  });

  test('why names the SlotTypes contract of a value slot', () => {
    const { root } = valueProject();
    const r = cli(root, 'why', 'formatPrice');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /slot "formatPrice" of @acme\/core@1\.0\.0 \(value\)/);
    assert.match(r.out, /used by: +Dialog/);
    assert.match(r.out, /contract SlotTypes\['formatPrice'\]/);
  });
});
