// Astro 7 suite: examples/customer-astro (static output, React islands) under `astro build` and `astro dev`.
// Run `npm run setup` first. node --test tests/astro.test.mjs
//
// Every expectation below was observed for real (see docs/tools/astro.md). The app is installed ONCE from the
// .packs/ tarballs (+ the npm registry for astro) into a temp dir; each case works on a copy.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseRenderOutput, summarize, compareRender, markers, section } from './harness/markers.mjs';
import { REPO, ENV, MISTAKES, requirePacks, tmpRoot, installExample, copyApp, runBin, firstDiagnostic, grepFiles, freePort, devTypoScenario, cleanup } from './frameworks/lib.mjs';

const TMP = tmpRoot('astro');
const BASE = path.join(TMP, 'base');
const CTX = { ov: 'src/overrides', page: 'src/components/App.tsx' };
const ASTRO = 'node_modules/astro/bin/astro.mjs';
const SDK_SECTION = { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, SDK_DEFAULT_PRICETAG: 0 };
const EXPECT_RENDER = { app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'], sdk: SDK_SECTION };
let n = 0;
const app = (label) => copyApp(BASE, path.join(TMP, `${String(++n).padStart(2, '0')}-${label}`));
const build = (a) => runBin(a, ASTRO, ['build']);
const count = (out, s) => out.split(s).length - 1;

function renderStatic(a) {
  const out = execFileSync(process.execPath, ['probes/render.mjs'], { cwd: a.dir, env: ENV, encoding: 'utf8' });
  const html = parseRenderOutput(out);
  return { ...summarize(html), island: markers(section(html, 'island')) };
}

before(() => {
  requirePacks('stunt-double-0.1.0.tgz', 'acme-core-1.0.0.tgz', 'acme-core-1.0.0-nested-react.tgz', 'acme-core-1.0.0-bad-relative.tgz', 'acme-core-2.0.0.tgz');
  installExample(path.join(REPO, 'examples/customer-astro'), BASE);
});
after(() => cleanup(TMP));

describe('astro build (Astro 7, static + React island)', () => {
  test('positive: prerendered HTML (server graph) and the island bundle (client graph) carry the overrides', () => {
    const a = app('ok');
    const r = build(a);
    assert.equal(r.code, 0, r.out);
    const s = renderStatic(a);
    assert.deepEqual(compareRender(s, { ...EXPECT_RENDER, island: SDK_SECTION }), []);
    assert.match(a.read('dist/index.html'), /<astro-island[^>]*component-export="CartIsland"[^>]*client="load"/);
    const island = grepFiles(a.file('dist/_astro'), 'BRAND_PRICE');
    assert.equal(island.length, 1, 'one client chunk (the island) carries the overrides');
    for (const m of ['BRAND_BUTTON', 'BRAND_LOGO', 'SDK_DEFAULT_BUTTON']) assert.ok(grepFiles(a.file('dist/_astro'), m).length, `${m} in the island bundle`);
    assert.deepEqual(grepFiles(a.file('dist'), 'SDK_DEFAULT_PRICETAG'), [], 'replaced default must be absent from HTML and client chunks');
  });

  for (const m of MISTAKES) {
    // Reported twice: once by the dev server that `astro build` starts for its sync step (stunt-double's
    // configureServer pushes the error; sync itself does not fail), once by the build, which exits 1.
    test(`${m.id} ${m.title}: build exits non-zero with the [${m.id.slice(0, 2)}] line`, () => {
      const a = app(m.id);
      m.apply(a, CTX);
      const r = build(a);
      assert.equal(r.code, 1, r.out);
      const line = firstDiagnostic(r.out);
      assert.match(line ?? '', m.line, r.out);
      assert.equal(count(r.out, line.split(' (tsc ')[0]), 2);
      assert.doesNotMatch(r.out, /\[build\] Complete!/);
    });
  }

  test('F6c: vite.ssr.external: ["@acme/core"] fails in the sync step ([F6] Vite environment "ssr" externalizes)', () => {
    const a = app('F6c');
    a.edit('astro.config.mjs', 'vite: { plugins: [stuntDouble()] },', "vite: { plugins: [stuntDouble()], ssr: { external: ['@acme/core'] } },");
    const r = build(a);
    assert.equal(r.code, 1, r.out);
    assert.match(firstDiagnostic(r.out) ?? '', /^\[F6\] Vite environment "ssr" externalizes @acme\/core/);
  });

  test('stunt-double check and tsc --noEmit pass on the example', () => {
    const a = app('typecheck');
    const c = runBin(a, 'node_modules/stunt-double/bin/stunt-double.mjs', ['check']);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /stunt-double: OK - 3 slots of @acme\/core@1\.0\.0; overridden: Button, Logo, PriceTag/);
    const t = runBin(a, 'node_modules/typescript/bin/tsc', ['--noEmit', '-p', '.']);
    assert.equal(t.code, 0, t.out);
  });
});

describe('astro dev', () => {
  test('typo while running: live overlay with the [F2] poisoned-import text, page HTTP 500; fixing restores the overrides', async () => {
    const a = app('dev');
    const port = freePort();
    const url = `http://localhost:${port}/`;
    const o = await devTypoScenario(a, { args: [a.file(ASTRO), 'dev', '--port', String(port)], ov: 'src/overrides', url });
    assert.ok(!o.start.timedOut, `dev server never served the overrides:\n${o.log()}`);
    // Astro scans every src/** file for dependencies; the optimizer tripwire must not mistake that for pre-bundling.
    assert.doesNotMatch(o.log(), /optimizer-tripwire|Failed to run dependency scan/);
    assert.equal(o.startOverlay, null);
    assert.ok(!o.liveOverlay.timedOut, `no overlay:\n${o.log()}`);
    // Astro replaces Vite's overlay with its own; it shows the poisoned import (punctuation stripped), not the push.
    assert.match(o.liveOverlay.text, /Could not import \.\/STUNT-DOUBLE-ERROR -- \[F2\] src overrides Buton\.tsx overrides unknown slot Buton \(did you mean Button \)/);
    assert.equal(o.http.status, 500);
    assert.match(o.http.text, /<title>FailedToLoadModuleSSR<\/title>/);
    assert.match(o.log(), /\[F2\] src\/overrides\/Buton\.tsx overrides unknown slot "Buton"/);
    assert.ok(!o.fixed.timedOut, `never recovered: ${o.fixed.status}\n${o.log()}`);
    assert.equal(o.fixedOverlay, null);
    assert.ok(o.fixedMarkers.includes('BRAND_PRICE') && o.fixedMarkers.includes('BRAND_LOGO') && !o.fixedMarkers.includes('SDK_DEFAULT_PRICETAG'));
    assert.match(o.log(), /stunt-double: injection errors fixed/);
  });
});
