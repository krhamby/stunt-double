// The universal tier WITHOUT the `stunt-double check &&` prefix ("bare"), per package manager: what each override
// mistake does when nothing validates. The harness suites (tests/{vite,pnpm,yarn,bun}.test.mjs) cover the adapter
// tier and the chained universal build with the shared catalogue; this file pins the documented residuals of the
// bare build (R1) under npm, pnpm, Yarn PnP and Bun, so a change in any of them is noticed, and checks that the
// chained build still catches each one. It also pins Yarn's handling of an SDK that bundles its own React.
// Run: npm run setup && node --test tests/package-managers.test.mjs   (needs the npm registry and Bun)
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { summarize, compareRender, parseRenderOutput } from './harness/markers.mjs';
import { packageManagers, makeProject, install, script, node, firstProblem } from './package-managers/project.mjs';
import { OVERRIDE_MISTAKES, applyMistake, snapshot } from './package-managers/mistakes.mjs';

const PMS = (process.env.SD_PMS ?? 'npm,pnpm,yarn,bun').split(',');
const CONCURRENCY = Number(process.env.SD_CONCURRENCY ?? 4);
const pms = packageManagers();

export const EXPECT_RENDER = {
  app: ['BRAND_BUTTON(dark)', 'SDK_DEFAULT_BUTTON(none)'],
  sdk: { BRAND_LOGO: 1, BRAND_PRICE: 3, 'BRAND_BUTTON(dark)': 3, 'SDK_DEFAULT_BUTTON(in-cart)': 3, SDK_DEFAULT_PRICETAG: 0 },
};

async function render(pm, dir) {
  // F7 renders forever: a small heap turns the infinite render into a quick, recognisable OOM
  const r = await node(pms, pm, dir, ['probes/render.mjs', 'dist-ssr/entry-server.js'], { timeout: 120_000, env: { NODE_OPTIONS: '--max-old-space-size=256' } });
  const html = r.code === 0 ? parseRenderOutput(r.out) : null;
  return { ...r, summary: html ? summarize(html) : null };
}

async function assertRender(pm, dir, expect = EXPECT_RENDER, label = '') {
  const r = await render(pm, dir);
  assert.equal(r.code, 0, `${label} render failed:\n${r.out.slice(-1500)}`);
  assert.deepEqual(compareRender(r.summary, expect), [], `${label} render`);
}

function build(pm, dir, name) {
  for (const d of ['dist', 'dist-ssr']) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  return script(pms, pm, dir, name);
}

describe('package managers', { concurrency: CONCURRENCY }, () => {
for (const pm of PMS) {
  describe(`${pm}`, { concurrency: 3, skip: !pms[pm] && `${pm} not available (install Bun 1.4 or set BUN_BIN)` }, () => {
    for (const tier of ['universal']) {
      describe(`${pm} ${tier}`, { concurrency: 1 }, () => {
        let dir;
        before(async () => {
          dir = makeProject(`${pm}-${tier}`, pm, tier);
          const r = await install(pms, pm, dir);
          assert.equal(r.code, 0, `${pm} install failed:\n${r.out.slice(-3000)}`);
          if (tier === 'universal') assert.ok(fs.existsSync(path.join(dir, 'sdk-slots/gen/Button.jsx')), `postinstall "stunt-double gen --no-fail" did not generate into the linked sdk-slots/ under ${pm}`);
        });

        test('builds and renders the overrides in app code and inside the SDK', async () => {
          const b = await build(pm, dir, 'build');
          assert.equal(b.code, 0, b.out.slice(-3000));
          if (tier === 'universal') assert.match(b.out, /stunt-double: OK - 3 slots of @acme\/core@1\.0\.0/);
          await assertRender(pm, dir);
          if (tier === 'universal') {
            const bare = await build(pm, dir, 'build:bare');
            assert.equal(bare.code, 0, bare.out.slice(-3000));
            await assertRender(pm, dir, EXPECT_RENDER, 'bare');
          }
        });

        test('override mistakes', async () => {
          const restore = snapshot(dir);
          try {
            for (const m of OVERRIDE_MISTAKES) {
              const modes = tier === 'adapter' ? [['build', m.gated]] : [['build', m.gated], ['build:bare', m.bare]];
              for (const [mode, want] of modes) {
                restore();
                applyMistake(dir, m);
                const b = await build(pm, dir, mode);
                const label = `${pm} ${tier} ${m.id} ${mode}`;
                if (want.fails) {
                  assert.notEqual(b.code, 0, `${label}: expected a failing build\n${b.out.slice(-2000)}`);
                  assert.match(b.out, want.fails, `${label}: first problem was: ${firstProblem(b.out)}`);
                } else {
                  assert.equal(b.code, 0, `${label}: expected the bare build to pass (documented gap)\n${b.out.slice(-2000)}`);
                  if (want.runtime) {
                    const r = await render(pm, dir);
                    assert.notEqual(r.code, 0, `${label}: expected a runtime failure`);
                    assert.match(r.out, want.runtime, label);
                  } else await assertRender(pm, dir, want.render, label);
                }
              }
            }
          } finally {
            restore();
          }
        });
      });
    }

    if (pm === 'yarn') describe(`${pm} SDK variants (adapter)`, { concurrency: 3 }, () => {
      const variants = {
        // Yarn Berry ignores bundleDependencies: the "nested React" SDK has one React there, and builds correctly.
        // the other variants are in the harness catalogue (tests/yarn.test.mjs), which skips F8 for this reason
        '1.0.0-nested-react': { render: EXPECT_RENDER },
      };
      for (const [v, want] of Object.entries(variants)) {
        test(`@acme/core@${v}`, async () => {
          const dir = makeProject(`${pm}-sdk-${v}`, pm, 'adapter', { sdk: v });
          const i = await install(pms, pm, dir);
          assert.equal(i.code, 0, i.out.slice(-2000));
          const b = await build(pm, dir, 'build');
          if (want.fails) {
            assert.notEqual(b.code, 0, b.out.slice(-2000));
            assert.match(b.out, want.fails, firstProblem(b.out));
          } else {
            assert.equal(b.code, 0, b.out.slice(-2000));
            await assertRender(pm, dir, want.render);
          }
        });
      }
    });
  });
}
});
