// The wiring self-test (F6f / F8b) against REAL installs: links that are copies, Yarn __virtual__ instances,
// another app's slot package in npm workspaces, the registry placeholder instead of the link; plus the
// Yarn PnP + TypeScript [TS-PNP] refusals. Run: npm run setup && node --test tests/pm-wiring.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { summarize, compareRender, parseRenderOutput } from './harness/markers.mjs';
import { packageManagers, makeProject, projectDir, install, script, node, run, PACKS, firstProblem } from './package-managers/project.mjs';

const pms = packageManagers();

async function renderSummary(pm, dir) {
  const r = await node(pms, pm, dir, ['probes/render.mjs', 'dist-ssr/entry-server.js']);
  assert.equal(r.code, 0, r.out.slice(-1500));
  return summarize(parseRenderOutput(r.out));
}

async function expectBuildFails(pm, dir, re, name = 'build') {
  const b = await script(pms, pm, dir, name);
  assert.notEqual(b.code, 0, `expected ${name} to fail:\n${b.out.slice(-2000)}`);
  assert.match(b.out, re, `first problem: ${firstProblem(b.out)}`);
  return b;
}

const editJson = (file, fn) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); fn(j); fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n'); };

describe('wiring self-test', { concurrency: 4 }, () => {
  test('pnpm "file:./sdk-slots" installs a COPY: [F6]', async () => {
    const dir = makeProject('wiring-pnpm-file', 'pnpm', 'adapter', { link: 'file:./sdk-slots' });
    assert.equal((await install(pms, 'pnpm', dir)).code, 0);
    assert.ok(fs.realpathSync(path.join(dir, 'node_modules/@acme/core-slots')).includes(`${path.sep}.pnpm${path.sep}`), 'pnpm file: should be a copy in .pnpm');
    await expectBuildFails('pnpm', dir, /\[F6\] @acme\/core resolves @acme\/core-slots to node_modules\/\.pnpm\/@acme\+core-slots@file\+sdk-slots\/\S+ \(a copy, or another app's slot package\), not sdk-slots\//);
  });

  test('Bun "file:./sdk-slots": install fails, and the build reports [F6]', { skip: !pms.bun && 'Bun not available' }, async () => {
    const dir = makeProject('wiring-bun-file', 'bun', 'adapter', { link: 'file:./sdk-slots' });
    const i = await install(pms, 'bun', dir);
    assert.notEqual(i.code, 0, 'bun install with file:./sdk-slots was expected to fail (observed with Bun 1.4.2)');
    assert.match(i.out, /@acme%2fcore-slots - 404/);
    await expectBuildFails('bun', dir, /\[F6\] @acme\/core resolves @acme\/core-slots to node_modules\/@acme\/core-slots \(a copy, or another app's slot package\)/);
  });

  for (const tier of ['adapter', 'universal']) {
    test(`Yarn PnP stub with peerDependencies becomes __virtual__: [F8] (${tier})`, async () => {
      const dir = makeProject(`wiring-yarn-peers-${tier}`, 'yarn', tier, { edit: (d) => editJson(path.join(d, 'sdk-slots/package.json'), (j) => { j.peerDependencies = { react: '*' }; }) });
      assert.equal((await install(pms, 'yarn', dir)).code, 0);
      await expectBuildFails('yarn', dir, /\[F8\] @acme\/core-slots is a Yarn PnP __virtual__ instance because sdk-slots\/package\.json declares peerDependencies/);
      // without stunt-double, Vite cannot resolve the socket from the virtual SDK instance (loud, not silent)
      if (tier === 'universal') await expectBuildFails('yarn', dir, /failed to resolve import "@acme\/core-slots\/Button" from "[^"]*__virtual__/, 'build:bare');
    });
  }

  test('placeholder installed instead of the link: [F6] when gated, STUNT-DOUBLE-NOT-WIRED when bare', async () => {
    const dir = makeProject('wiring-npm-placeholder', 'npm', 'universal', { link: `file:${path.join(PACKS, 'acme-core-slots-0.0.1.tgz')}` });
    assert.equal((await install(pms, 'npm', dir)).code, 0);
    await expectBuildFails('npm', dir, /\[F6\] @acme\/core resolves @acme\/core-slots to node_modules\/@acme\/core-slots \(the registry placeholder: the link is missing or was replaced by an auto-installed peer\), not sdk-slots\//);
    await expectBuildFails('npm', dir, /\[UNRESOLVED_IMPORT\] Could not resolve '\.\/STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project/, 'build:bare');
  });

  describe('npm workspaces with two apps and a hoisted SDK', { concurrency: 1 }, () => {
    test('a link in each app: app B gets app A\'s slot package -> [F6]; bare renders app A\'s overrides', async () => {
      const ws = projectDir('ws-links');
      fs.rmSync(ws, { recursive: true, force: true });
      makeProject('ws-links/apps/a', 'npm', 'universal');
      makeProject('ws-links/apps/b', 'npm', 'universal', { edit: markAppB });
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'ws-links', private: true, workspaces: ['apps/a', 'apps/b'] }, null, 2));
      const i = await run(['npm'], ['install', '--no-audit', '--no-fund'], ws);
      assert.equal(i.code, 0, i.out.slice(-2000));
      assert.equal(fs.realpathSync(path.join(ws, 'node_modules/@acme/core-slots')), fs.realpathSync(path.join(ws, 'apps/a/sdk-slots')));
      const a = path.join(ws, 'apps/a'), b = path.join(ws, 'apps/b');
      assert.equal((await script(pms, 'npm', a, 'build')).code, 0);
      await expectBuildFails('npm', b, /\[F6\] @acme\/core resolves @acme\/core-slots to \.\.\/a\/sdk-slots \(a copy, or another app's slot package\), not sdk-slots\//);
      // the hazard the self-test exists for: app B's bare build ships app A's Button, without app B's theme
      assert.equal((await script(pms, 'npm', b, 'build:bare')).code, 0);
      const s = await renderSummary('npm', b);
      assert.deepEqual(compareRender(s, { app: ['BRAND_BUTTON(no-theme)', 'SDK_DEFAULT_BUTTON(none)'], sdk: { APP_B_BUTTON: 0 } }), []);
    });

    test('adapter-only wiring per app (the documented fix): each app renders its own overrides; an unwired config fails on the placeholder', async () => {
      const bare = (d) => fs.writeFileSync(path.join(d, 'vite.bare.config.ts'), `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()], ssr: { noExternal: ['@acme/core'] } });\n`);
      fs.rmSync(projectDir('ws-adapter'), { recursive: true, force: true });
      const a = makeProject('ws-adapter/apps/a', 'npm', 'adapter', { link: null, edit: (d, pkg) => { bare(d); pkg.scripts['build:unwired'] = 'vite build --config vite.bare.config.ts'; } });
      const b = makeProject('ws-adapter/apps/b', 'npm', 'adapter', { link: null, edit: (d, pkg) => { markAppB(d, pkg); bare(d); pkg.scripts['build:unwired'] = 'vite build --config vite.bare.config.ts'; } });
      const ws = path.dirname(path.dirname(a));
      // the registry placeholder, as npm would auto-install it for the SDK's peer
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'ws-adapter', private: true, workspaces: ['apps/a', 'apps/b'], dependencies: { '@acme/core-slots': `file:${path.join(PACKS, 'acme-core-slots-0.0.1.tgz')}` } }, null, 2));
      const i = await run(['npm'], ['install', '--no-audit', '--no-fund'], ws);
      assert.equal(i.code, 0, i.out.slice(-2000));
      for (const [dir, button] of [[a, 'BRAND_BUTTON(dark)'], [b, 'APP_B_BUTTON(dark)']]) {
        const r = await script(pms, 'npm', dir, 'build');
        assert.equal(r.code, 0, r.out.slice(-2000));
        const s = await renderSummary('npm', dir);
        assert.deepEqual(compareRender(s, { app: [button, 'SDK_DEFAULT_BUTTON(none)'], sdk: { [button]: 3, BRAND_LOGO: 1 } }), []);
        await expectBuildFails('npm', dir, /STUNT-DOUBLE-NOT-WIRED/, 'build:unwired');
      }
    });
  });
});

describe('Yarn PnP and the type gate', { concurrency: 2 }, () => {
  test('TypeScript 7 is refused with [TS-PNP]', async () => {
    const dir = makeProject('tspnp-ts7', 'yarn', 'adapter', { yarnTs5: false });
    assert.equal((await install(pms, 'yarn', dir)).code, 0);
    await expectBuildFails('yarn', dir, /\[TS-PNP\] TypeScript 7\.0\.2 cannot resolve modules under Yarn Plug'n'Play: add "typescript5": "patch:typescript@npm%3A5\.9\.3#optional!builtin<compat\/typescript>" to devDependencies/);
  });

  test('a plain npm: alias of TypeScript 5.9 (unpatched) is refused with [TS-PNP]', async () => {
    const dir = makeProject('tspnp-alias', 'yarn', 'adapter', { yarnTs5: false, config: { typescript: 'typescript5' }, edit: (d, pkg) => { pkg.devDependencies.typescript5 = 'npm:typescript@5.9.3'; } });
    assert.equal((await install(pms, 'yarn', dir)).code, 0);
    await expectBuildFails('yarn', dir, /\[TS-PNP\] "typescript5" is TypeScript 5\.9\.3 WITHOUT Yarn's PnP patch/);
  });
  // the patched alias passing (and catching F1) is covered by tests/package-managers.test.mjs (yarn adapter / universal)
});

function markAppB(dir) {
  const f = path.join(dir, 'src/overrides/Button.tsx');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('BRAND_BUTTON', 'APP_B_BUTTON'));
}
