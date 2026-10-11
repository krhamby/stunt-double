// Yarn Plug'n'Play and the type gate: TS 7 and an unpatched TS 5 alias are refused up front with [TS-PNP]
// (both would fail every clean build with TS2307/TS2688), Yarn's patched TS 5 is accepted, and tsc is
// spawned with the PnP runtime so node can read it from the zip cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTypeGate, resolveTypeScript } from '../src/core/typegate.mjs';

function fakeProject({ tsName, version, dirName = tsName }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-pnp-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app","private":true}');
  fs.writeFileSync(path.join(root, '.pnp.cjs'), '');
  // .yarn/cache/<dirName>.zip/node_modules/<tsName> stands in for the zip; resolution goes through node_modules
  const pkgDir = path.join(root, '.yarn', 'cache', `${dirName}.zip`, 'node_modules', tsName);
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: tsName, version, bin: { tsc: './bin/tsc' } }));
  fs.writeFileSync(path.join(pkgDir, 'bin', 'tsc'), 'process.exit(0)');
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(pkgDir, path.join(root, 'node_modules', tsName));
  return { root, cfg: { typescript: tsName }, isPnP: true, problems: [], sdk: { name: '@acme/core', version: '1.0.0' } };
}

test('[TS-PNP] refuses TypeScript 7 with the exact fix', async () => {
  const p = fakeProject({ tsName: 'typescript', version: '7.0.2', dirName: 'typescript-patch-3bafbf-0123456789' });
  const r = await runTypeGate(p);
  assert.equal(r.ok, false);
  assert.equal(r.lines[0], `[TS-PNP] TypeScript 7.0.2 cannot resolve modules under Yarn Plug'n'Play: add "typescript5": "patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>" to devDependencies (Yarn's PnP-patched TypeScript 5.9) and set "typescript": "typescript5" in stunt-double.config.json.`);
});

test('[TS-PNP] refuses an unpatched npm: alias of TypeScript 5', async () => {
  const p = fakeProject({ tsName: 'typescript5', version: '5.9.3', dirName: 'typescript-npm-5.9.3-48715be868-6bd7552ce3' });
  const r = await runTypeGate(p);
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /^\[TS-PNP\] "typescript5" is TypeScript 5\.9\.3 WITHOUT Yarn's PnP patch/);
});

test('a patched TypeScript 5 alias passes the PnP check and is spawned with the PnP runtime', () => {
  const p = fakeProject({ tsName: 'typescript5', version: '5.9.3', dirName: 'typescript5-patch-da742a7a7d-840221686b' });
  const ts = resolveTypeScript(p);
  assert.equal(ts.version, '5.9.3');
  assert.deepEqual(ts.nodeArgs, ['--require', path.join(fs.realpathSync(p.root), '.pnp.cjs')].map((x, i) => (i ? path.join(p.root, '.pnp.cjs') : x)));
});
