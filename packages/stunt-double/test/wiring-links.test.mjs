// Link declarations that are not universal-tier links must never become the outDir: a "file:" TARBALL (a
// vendored registry placeholder) installs a package and links nothing, and a link target outside the project is
// reported, never written to. Regression: generation used to mkdir the tarball path (EEXIST crash) and would have
// written generated files into a directory outside the project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/core/generate.mjs';
import { linkDeclaration } from '../src/core/wiring.mjs';

const PACKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.packs');
const SDK_TGZ = path.join(PACKS, 'acme-core-1.0.0.tgz');
const skip = !fs.existsSync(SDK_TGZ) && 'run `npm run setup` first';

function project(deps) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-links-'));
  const root = path.join(base, 'app');
  const sdkDir = path.join(root, 'node_modules/@acme/core');
  fs.mkdirSync(sdkDir, { recursive: true });
  execFileSync('tar', ['-xzf', SDK_TGZ, '-C', sdkDir, '--strip-components=1']);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', private: true, dependencies: { '@acme/core': '1.0.0', ...deps } }));
  fs.mkdirSync(path.join(root, 'src/overrides'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/overrides/Logo.tsx'), 'export function Logo() { return null; }\n');
  return { base, root };
}

const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

test('a file: tarball is not a link: adapter tier, outDir .stunt-double, the tarball untouched', { skip }, () => {
  const { base, root } = project({});
  const tgz = path.join(base, 'acme-core-slots-0.0.1.tgz');
  fs.copyFileSync(path.join(PACKS, 'acme-core-slots-0.0.1.tgz'), tgz);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', private: true, dependencies: { '@acme/core': '1.0.0', '@acme/core-slots': `file:${tgz}` } }));
  assert.equal(linkDeclaration(root, '@acme/core-slots'), null);
  const p = generate({ root, onError: 'poison' });
  assert.equal(p.tier, 'adapter');
  assert.equal(p.outDir, path.join(fs.realpathSync(root), '.stunt-double'));
  assert.ok(fs.statSync(tgz).isFile());
});

test('a link outside the project is reported and never written to', { skip }, () => {
  const { base, root } = project({});
  const outside = path.join(base, 'shared-slots');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: '@acme/core-slots', version: '0.0.0', private: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', private: true, dependencies: { '@acme/core': '1.0.0', '@acme/core-slots': 'file:../shared-slots' } }));
  const before = listing(outside);
  const p = generate({ root, onError: 'poison' });
  assert.ok(p.problems.some((x) => x.includes('outside the project')), p.problems.join('\n'));
  assert.ok(!path.relative(fs.realpathSync(root), p.outDir).startsWith('..'), `outDir ${p.outDir} must stay inside the project`);
  assert.deepEqual(listing(outside), before);
});
