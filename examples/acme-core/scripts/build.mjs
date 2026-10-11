#!/usr/bin/env node
// Build @acme/core variants from one source tree + overlays, the way a real SDK team would publish:
//   1. assemble build/<variant>/src  (base src/ + variants/<chain>/src overlays, minus "delete")
//   2. tsc emit (one file per module, specifiers byte-for-byte, 'use client' prologues kept, .d.ts beside JS)
//   3. write package.json + slot-manifest.json (from slots.json, the defineSlots() table)
//   4. stunt-double sdk-lint --fix --write: points the published .d.ts files at the originals (never the socket
//      package, so apps need no tsconfig "paths"), runs the publish gate, writes consumers, the ABI and the schema
//   5. npm pack into <repo>/.packs
// Usage: node scripts/build.mjs [--variant 1.1.0 ...] [--packs <dir>] [--no-pack]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sdkLint } from 'stunt-double/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const values = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const packsDir = path.resolve(values('--packs')[0] ?? path.join(repoRoot, '.packs'));
const allVariants = fs.readdirSync(path.join(pkgRoot, 'variants')).filter((d) => fs.existsSync(path.join(pkgRoot, 'variants', d, 'variant.json'))).sort();
const wanted = values('--variant').length ? values('--variant') : allVariants;

const SDK_NAME = '@acme/core';
const SLOT_PACKAGE = '@acme/core-slots';
const TOOL_RANGE = '>=0.1.0 <1.0.0';
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function chainOf(id) {
  const v = readJson(path.join(pkgRoot, 'variants', id, 'variant.json'));
  return [...(v.extends ? chainOf(v.extends) : []), { id, ...v }];
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true, force: true });
}

function tsc(tsconfig) {
  const req = createRequire(path.join(pkgRoot, 'package.json'));
  const pj = req.resolve('typescript/package.json');
  const ts = readJson(pj);
  const bin = path.join(path.dirname(pj), typeof ts.bin === 'string' ? ts.bin : ts.bin.tsc);
  execFileSync(process.execPath, [bin, '-p', tsconfig, '--pretty', 'false'], { stdio: 'inherit' });
  return ts.version;
}

function build(id) {
  const chain = chainOf(id);
  const v = chain.at(-1);
  const out = path.join(pkgRoot, 'build', id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // 1. sources
  copyDir(path.join(pkgRoot, 'src'), path.join(out, 'src'));
  let slotsSpec = readJson(path.join(pkgRoot, 'slots.json'));
  for (const c of chain) {
    const dir = path.join(pkgRoot, 'variants', c.id);
    for (const d of c.delete ?? []) fs.rmSync(path.join(out, d), { force: true });
    copyDir(path.join(dir, 'src'), path.join(out, 'src'));
    if (fs.existsSync(path.join(dir, 'slots.json'))) slotsSpec = readJson(path.join(dir, 'slots.json'));
  }
  const slots = slotsSpec.slots;
  // dev-slots: what '@acme/core-slots/*' means while type-checking the SDK itself (specifiers are NOT rewritten)
  for (const [name, meta] of Object.entries(slots)) {
    const dts = meta.required
      ? `import type { ReactNode } from 'react';\nimport type { SlotProps } from '../src/contracts.js';\nexport declare function ${name}(props: SlotProps['${name}']): ReactNode;\n`
      : `export { ${name} } from '../src/original/${name}.js';\n`;
    fs.mkdirSync(path.join(out, 'dev-slots'), { recursive: true });
    fs.writeFileSync(path.join(out, 'dev-slots', `${name}.d.ts`), dts);
  }
  fs.writeFileSync(path.join(out, 'tsconfig.build.json'), JSON.stringify({
    compilerOptions: {
      rootDir: 'src', outDir: 'dist', declaration: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx',
      target: 'es2022', lib: ['es2022', 'dom'], strict: true, verbatimModuleSyntax: true, skipLibCheck: true, types: [],
      paths: { [`${SLOT_PACKAGE}/*`]: ['./dev-slots/*'] },
    },
    include: ['src'],
  }, null, 2) + '\n');
  // 2. tsc emit
  const tsVersion = tsc(path.join(out, 'tsconfig.build.json'));
  // 3. package.json + manifest
  const pkg = {
    name: SDK_NAME,
    version: v.version,
    description: `Fixture SDK for stunt-double (${v.description})`,
    license: 'MIT',
    type: 'module',
    sideEffects: false,
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './original/*': { types: './dist/original/*.d.ts', default: './dist/original/*.js' },
      './contracts': { types: './dist/contracts.d.ts' },
      './slot-manifest.json': './slot-manifest.json',
      './stunt-double.schema.json': './stunt-double.schema.json',
      './package.json': './package.json',
    },
    files: ['dist', 'slot-manifest.json', 'stunt-double.schema.json'],
    peerDependencies: { react: '>=18', [SLOT_PACKAGE]: '*' },
  };
  if (v.bundleReact) {
    // F8 fixture: a second React inside the SDK (what a non-peer `react` dependency at another version does)
    pkg.dependencies = { react: readJson(path.join(createRequire(path.join(pkgRoot, 'package.json')).resolve('react/package.json'))).version };
    pkg.bundleDependencies = ['react'];
  }
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const manifest = {
    schema: 1,
    stuntDouble: TOOL_RANGE,
    sdk: SDK_NAME,
    version: v.version,
    abi: null,
    slotPackage: SLOT_PACKAGE,
    originalSpecifier: `${SDK_NAME}/original/`,
    slots: Object.fromEntries(Object.entries(slots).map(([name, meta]) => [name, {
      export: name,
      kind: meta.kind ?? 'client',
      ...(meta.required ? { required: true } : { default: `dist/original/${name}.js` }),
      ...(meta.renamedFrom ? { renamedFrom: meta.renamedFrom } : {}),
    }])),
    removedSlots: slotsSpec.removedSlots ?? {},
  };
  fs.writeFileSync(path.join(out, 'slot-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // 4. the publish gate (--fix: published declarations re-export the originals, not the sockets)
  const lint = sdkLint(out, { write: true, fix: true });
  for (const w of lint.warnings) console.warn(`  ${w}`);
  if (!lint.ok) {
    if (v.lint === false) console.warn(`  sdk-lint SKIPPED for ${id} (deliberately broken fixture); it reports:\n    ${lint.errors.join('\n    ')}`);
    else { console.error(`sdk-lint failed for @acme/core ${id}:\n  ${lint.errors.join('\n  ')}`); process.exit(1); }
  }
  if (v.bundleReact) {
    const reactDir = path.dirname(createRequire(path.join(pkgRoot, 'package.json')).resolve('react/package.json'));
    fs.cpSync(reactDir, path.join(out, 'node_modules', 'react'), { recursive: true, dereference: true });
  }
  // 5. pack
  if (!flag('--no-pack')) {
    fs.mkdirSync(packsDir, { recursive: true });
    const name = execFileSync('npm', ['pack', '--silent', '--pack-destination', packsDir, out], { encoding: 'utf8' }).trim().split('\n').at(-1);
    console.log(`@acme/core ${id}: tsc ${tsVersion}, sdk-lint ${lint.ok ? 'ok' : 'SKIPPED'}, abi ${lint.manifest.abi} -> .packs/${name}`);
  } else console.log(`@acme/core ${id}: built in ${path.relative(repoRoot, out)}`);
}

for (const id of wanted) build(id);
