// The universal tier under a tool with NO adapter: examples/customer-node (Node's own ESM resolver + a
// transpile-only TS/JSX hook). Overrides must apply through the sdk-slots link; an unlinked project must fail
// on the registry placeholder (fail-closed). The override mistakes run chained (`stunt-double check && node …`)
// and bare, with the observed bare behaviour asserted. Run: npm run setup && node --test tests/universal-node.test.mjs
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { summarize, compareRender, parseRenderOutput } from './harness/markers.mjs';
import { packageManagers, projectDir, install, script, run, REPO, PACKS } from './package-managers/project.mjs';
import { OVERRIDE_MISTAKES, applyMistake, snapshot } from './package-managers/mistakes.mjs';

const pms = packageManagers();
const EXPECT = { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'], sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, SDK_DEFAULT_PRICETAG: 0 } };
// What Node itself reports for the mistakes that are loud even without stunt-double
const NODE_BARE = {
  'F3 required slot missing': /ERR_MODULE_NOT_FOUND[^\n]*src\/overrides\/Logo\.tsx/,
  'F5 default export': /does not provide an export named 'PriceTag'/,
};

function copyExample(name, { link } = {}) {
  const dir = projectDir(name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(REPO, 'examples/customer-node'), dir, { recursive: true, filter: (f) => !/node_modules/.test(f) && (!/sdk-slots[\\/]/.test(f) || /sdk-slots[\\/]package\.json$/.test(f)) });
  const pkgFile = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  for (const deps of [pkg.dependencies, pkg.devDependencies]) for (const [k, v] of Object.entries(deps)) if (v.startsWith('file:../../.packs/')) deps[k] = `file:${path.join(PACKS, v.slice('file:../../.packs/'.length))}`;
  if (link === null) { delete pkg.dependencies['@acme/core-slots']; pkg.overrides = { '@acme/core-slots': `file:${path.join(PACKS, 'acme-core-slots-0.0.1.tgz')}` }; } // the auto-installed registry placeholder
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  return dir;
}

const rendered = (r) => summarize(parseRenderOutput(r.out));
const SMALL_HEAP = { NODE_OPTIONS: '--max-old-space-size=256' };

describe('unknown tool (plain Node ESM + transpile hook), universal tier', { concurrency: 1 }, () => {
  let dir;
  before(async () => {
    dir = copyExample('customer-node');
    const i = await install(pms, 'npm', dir);
    assert.equal(i.code, 0, i.out.slice(-2000));
  });

  test('overrides apply through the link, in app code and inside the SDK', async () => {
    for (const name of ['render', 'render:bare']) {
      const r = await script(pms, 'npm', dir, name);
      assert.equal(r.code, 0, r.out.slice(-2000));
      assert.deepEqual(compareRender(rendered(r), EXPECT), [], name);
    }
  });

  test('override mistakes: chained fails with the code; bare shows the documented gaps', async () => {
    const restore = snapshot(dir);
    try {
      for (const m of OVERRIDE_MISTAKES) {
        restore(); applyMistake(dir, m);
        const chained = await script(pms, 'npm', dir, 'render');
        assert.notEqual(chained.code, 0, `${m.id} chained`);
        assert.match(chained.out, m.gated.fails, `${m.id} chained`);
        const bare = await run(['npm'], ['run', 'render:bare'], dir, { env: SMALL_HEAP, timeout: 120_000 });
        if (NODE_BARE[m.id]) { assert.notEqual(bare.code, 0, m.id); assert.match(bare.out, NODE_BARE[m.id], m.id); }
        else if (m.bare.runtime) { assert.notEqual(bare.code, 0, m.id); assert.match(bare.out, m.bare.runtime, m.id); }
        else { assert.equal(bare.code, 0, `${m.id} bare:\n${bare.out.slice(-1500)}`); assert.deepEqual(compareRender(rendered(bare), m.bare.render), [], `${m.id} bare`); }
      }
    } finally { restore(); }
  });
});

test('unknown tool, project NOT linked (the registry placeholder answers): fails closed', async () => {
  const dir = copyExample('customer-node-unlinked', { link: null });
  assert.equal((await install(pms, 'npm', dir)).code, 0);
  // without a link `stunt-double check` sees an adapter-tier project and passes; the tool itself then fails
  for (const name of ['render:bare', 'render']) {
    const r = await script(pms, 'npm', dir, name);
    assert.notEqual(r.code, 0, name);
    assert.match(r.out, /ERR_MODULE_NOT_FOUND[^\n]*node_modules\/@acme\/core-slots\/STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project/, name);
  }
});
