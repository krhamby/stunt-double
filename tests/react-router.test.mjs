// React Router 8 framework mode suite: examples/customer-react-router (SSR) under `react-router build` and
// `react-router dev`. Run `npm run setup` first. node --test tests/react-router.test.mjs
//
// Every expectation below was observed for real (see docs/tools/react-router.md). The app is installed ONCE from
// the .packs/ tarballs (+ the npm registry for react-router) into a temp dir; each case works on a copy.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseRenderOutput, summarize, compareRender } from './harness/markers.mjs';
import { REPO, ENV, MISTAKES, requirePacks, tmpRoot, installExample, copyApp, runBin, firstDiagnostic, grepFiles, freePort, devTypoScenario, cleanup } from './frameworks/lib.mjs';

const TMP = tmpRoot('react-router');
const BASE = path.join(TMP, 'base');
const CTX = { ov: 'app/overrides', page: 'app/routes/home.tsx' };
const RR = 'node_modules/@react-router/dev/bin.cjs';
const EXPECT_RENDER = {
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, SDK_DEFAULT_PRICETAG: 0 },
};
let n = 0;
const app = (label) => copyApp(BASE, path.join(TMP, `${String(++n).padStart(2, '0')}-${label}`));
const build = (a) => runBin(a, RR, ['build']);
const count = (out, s) => out.split(s).length - 1;

/** Render the BUILT server bundle through react-router's own request handler (probes/render.mjs). */
function renderServerBuild(a) {
  const out = execFileSync(process.execPath, ['probes/render.mjs'], { cwd: a.dir, env: ENV, encoding: 'utf8' });
  return summarize(parseRenderOutput(out));
}

before(() => {
  requirePacks('stunt-double-0.1.0.tgz', 'acme-core-1.0.0.tgz', 'acme-core-1.0.0-nested-react.tgz', 'acme-core-1.0.0-bad-relative.tgz', 'acme-core-2.0.0.tgz');
  installExample(path.join(REPO, 'examples/customer-react-router'), BASE);
});
after(() => cleanup(TMP));

describe('react-router build (React Router 8, SSR)', () => {
  test('positive: server build and client bundle carry the overrides; PriceTag default eliminated', () => {
    const a = app('ok');
    const r = build(a);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(compareRender(renderServerBuild(a), EXPECT_RENDER), []);
    for (const m of ['BRAND_BUTTON', 'BRAND_PRICE', 'BRAND_LOGO', 'SDK_DEFAULT_BUTTON'])
      assert.ok(grepFiles(a.file('build/client/assets'), m).length, `${m} should be in the client bundle`);
    assert.deepEqual(grepFiles(a.file('build/client'), 'SDK_DEFAULT_PRICETAG'), [], 'replaced default must be absent from the client');
    assert.deepEqual(grepFiles(a.file('build/server'), 'SDK_DEFAULT_PRICETAG'), [], 'replaced default must be absent from the server build');
    // The router reloads the user config in a child Vite server (command "serve" -> stunt-double poison mode).
    // On a clean project that second generate() must leave real shims, not poison.
    assert.match(a.read('sdk-slots/gen/Button.jsx'), /export \{ Button \} from '\.\.\/\.\.\/app\/overrides\/Button\.tsx'/);
  });

  for (const m of MISTAKES) {
    test(`${m.id} ${m.title}: build exits non-zero with the [${m.id.slice(0, 2)}] line, reported once`, () => {
      const a = app(m.id);
      m.apply(a, CTX);
      const r = build(a);
      assert.equal(r.code, 1, r.out);
      const line = firstDiagnostic(r.out);
      assert.match(line ?? '', m.line, r.out);
      assert.equal(count(r.out, line.split(' (tsc ')[0]), 1, 'the child compiler must not report the error a second time');
    });
  }

  test('F6c: ssr.external: ["@acme/core"] fails at config time ([F6] Vite environment "ssr" externalizes)', () => {
    const a = app('F6c');
    a.edit('vite.config.ts', 'plugins: [stuntDouble(), reactRouter()],', "plugins: [stuntDouble(), reactRouter()],\n  ssr: { external: ['@acme/core'] },");
    const r = build(a);
    assert.equal(r.code, 1, r.out);
    assert.match(firstDiagnostic(r.out) ?? '', /^\[F6\] Vite environment "ssr" externalizes @acme\/core: Node would load it natively.*\(remove "@acme\/core" from ssr\.external \/ resolve\.external\)/);
  });

  test('must not fail: environments.ssr.resolve.external = true (stunt-double\'s noExternal wins) still renders the overrides', () => {
    const a = app('ssr-external-true');
    a.edit('vite.config.ts', 'plugins: [stuntDouble(), reactRouter()],', 'plugins: [stuntDouble(), reactRouter()],\n  environments: { ssr: { resolve: { external: true } } },');
    const r = build(a);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(a.read('build/server/index.js'), /from "@acme\/core"/);
    assert.deepEqual(compareRender(renderServerBuild(a), EXPECT_RENDER), []);
  });

  test('must not fail: plugin order reactRouter(), stuntDouble()', () => {
    const a = app('order');
    a.edit('vite.config.ts', 'plugins: [stuntDouble(), reactRouter()],', 'plugins: [reactRouter(), stuntDouble()],');
    assert.equal(build(a).code, 0);
    assert.deepEqual(compareRender(renderServerBuild(a), EXPECT_RENDER), []);
  });

  test('stunt-double check and react-router typegen && tsc pass on the example', () => {
    const a = app('typecheck');
    const c = runBin(a, 'node_modules/stunt-double/bin/stunt-double.mjs', ['check']);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /stunt-double: OK - 3 slots of @acme\/core@1\.0\.0; overridden: Button, Logo, PriceTag/);
    assert.equal(runBin(a, RR, ['typegen']).code, 0);
    const t = runBin(a, 'node_modules/typescript/bin/tsc', []);
    assert.equal(t.code, 0, t.out);
  });
});

describe('react-router dev', () => {
  test('typo while running: live overlay with the [F2] line, SSR request HTTP 500 with the text; fixing restores the overrides', async () => {
    const a = app('dev');
    const port = freePort();
    const url = `http://localhost:${port}/`;
    const o = await devTypoScenario(a, { args: [a.file(RR), 'dev', '--port', String(port), '--strictPort'], ov: 'app/overrides', url });
    assert.ok(!o.start.timedOut, `dev server never served the overrides:\n${o.log()}`);
    assert.equal(o.startOverlay, null);
    assert.ok(!o.liveOverlay.timedOut, `no overlay:\n${o.log()}`);
    // Two error channels race to the overlay; both name the file and slot: stunt-double's HMR push, or Vite's
    // failed import of the poisoned shim (punctuation stripped).
    assert.match(o.liveOverlay.text, /\[plugin:stunt-double\] stunt-double: 1 injection error \(@acme\/core@1\.0\.0\) \[F2\] app\/overrides\/Buton\.tsx overrides unknown slot "Buton" \(did you mean "Button"\?\)|Failed to load url \.\/STUNT-DOUBLE-ERROR -- \[F2\] app overrides Buton\.tsx overrides unknown slot Buton \(did you mean Button \)/);
    assert.equal(o.http.status, 500);
    assert.match(o.http.text, /Failed to load url \.\/STUNT-DOUBLE-ERROR -- \[F2\] app overrides Buton\.tsx overrides unknown slot Buton/);
    assert.match(o.log(), /\[F2\] app\/overrides\/Buton\.tsx overrides unknown slot "Buton"/);
    assert.ok(!o.fixed.timedOut, `never recovered: ${o.fixed.status}\n${o.log()}`);
    assert.equal(o.fixedOverlay, null);
    assert.ok(o.fixedMarkers.includes('BRAND_PRICE') && o.fixedMarkers.includes('BRAND_LOGO') && !o.fixedMarkers.includes('SDK_DEFAULT_PRICETAG'));
    assert.match(o.log(), /stunt-double: injection errors fixed/);
  });
});
