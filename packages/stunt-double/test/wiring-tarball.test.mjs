// Regression: a "file:<tarball>" dependency on the slot package installs a packed copy (for example the
// registry placeholder from a local .tgz). That is an adapter-only project, not a link to sdk-slots/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkDeclaration } from '../src/core/wiring.mjs';

function project(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-wiring-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@acme/core-slots': spec } }));
  return root;
}

test('file:<tarball> of the slot package is not a link declaration', () => {
  for (const spec of ['file:../../.packs/acme-core-slots-0.0.1.tgz', 'file:./vendor/acme-core-slots-0.0.1.tar.gz', 'file:x.tar']) {
    const root = project(spec);
    assert.equal(linkDeclaration(root, '@acme/core-slots', path.join(root, 'sdk-slots')), null, spec);
  }
});

test('file:<directory> and other forms are still declarations', () => {
  const root = project('file:./sdk-slots');
  assert.deepEqual(linkDeclaration(root, '@acme/core-slots', path.join(root, 'sdk-slots')), { field: 'dependencies', spec: 'file:./sdk-slots', linkForm: true });
  const reg = project('^0.0.1');
  assert.equal(linkDeclaration(reg, '@acme/core-slots', path.join(reg, 'sdk-slots')).linkForm, false);
});
