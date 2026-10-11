// Rsbuild 2 (web + node environments): examples/customer-rsbuild with stunt-double/webpack through tools.rspack.
// Shared cases: tests/webpack-family/suite.mjs. Rsbuild-specific expectations are below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { defineSuite } from './webpack-family/suite.mjs';

const run = (d, argv, env = {}) => {
  const r = spawnSync('npx', argv, { cwd: d, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const UNWIRE = (src) => src.replace("import { withStuntDouble } from 'stunt-double/webpack';", '').replace('  tools: { rspack: (config) => withStuntDouble(config) },\n', '');

defineSuite({
  tool: 'rsbuild',
  packageName: '@rsbuild/core',
  configFile: 'rsbuild.config.ts',
  build: ['rsbuild', 'build'],
  dev: ['rsbuild', 'dev'],
  overlay: 'rsbuild-error-overlay',
  replace: {
    // KNOWN GAP: Rsbuild's default resolve.aliasStrategy 'prefer-tsconfig' hands tsconfig.json to Rspack, and the
    // project's tsconfig "paths" maps @acme/core-slots/* to the generated shims. An unwired Rsbuild config therefore
    // never reaches the registry placeholder: it builds (exit 0) with the LAST GENERATED decision ("T0 bare").
    // Only `stunt-double check` (the STA wiring self-test) catches the placeholder.
    F6b: (h) => {
      test('rsbuild: F6b unwired config + registry placeholder: build exits 0 with the last generated shims (gap); `stunt-double check` fails', () => {
        const d = h.fresh();
        assert.equal(h.build(d).status, 0); // generate the shims once, as postinstall / a wired build would
        fs.rmSync(path.join(d, 'node_modules/@acme/core-slots'), { recursive: true, force: true });
        h.npmInstall(d, '--no-save', path.join(h.packs, 'acme-core-slots-0.0.1.tgz'));
        h.write(d, 'rsbuild.config.ts', UNWIRE(h.read(d, 'rsbuild.config.ts')));
        h.assertRenders(d, h.build(d));
        h.assertFails(run(d, ['stunt-double', 'check']), /\[F6\] @acme\/core resolves @acme\/core-slots to node_modules\/@acme\/core-slots \(the registry placeholder/);
      });
      test('rsbuild: F6b unwired config without generated shims fails on the registry placeholder', () => {
        const d = h.fresh();
        fs.rmSync(path.join(d, 'node_modules/@acme/core-slots'), { recursive: true, force: true });
        h.npmInstall(d, '--no-save', path.join(h.packs, 'acme-core-slots-0.0.1.tgz'));
        fs.rmSync(path.join(d, 'sdk-slots/gen'), { recursive: true, force: true });
        h.write(d, 'rsbuild.config.ts', UNWIRE(h.read(d, 'rsbuild.config.ts')));
        h.assertFails(h.build(d), /Module not found[^\n]*STUNT-DOUBLE-NOT-WIRED/);
      });
      test("rsbuild: F6b unwired config with resolve.aliasStrategy 'prefer-alias' fails on the registry placeholder", () => {
        const d = h.fresh();
        assert.equal(h.build(d).status, 0);
        fs.rmSync(path.join(d, 'node_modules/@acme/core-slots'), { recursive: true, force: true });
        h.npmInstall(d, '--no-save', path.join(h.packs, 'acme-core-slots-0.0.1.tgz'));
        h.write(d, 'rsbuild.config.ts', UNWIRE(h.read(d, 'rsbuild.config.ts')).replace("resolve: { dedupe: ['react', 'react-dom'] }", "resolve: { dedupe: ['react', 'react-dom'], aliasStrategy: 'prefer-alias' }"));
        h.assertFails(h.build(d), /Module not found[^\n]*STUNT-DOUBLE-NOT-WIRED/);
      });
    },
    'F6-audit': (h) => {
      test('rsbuild: F6 audit: a plugin that resolves a socket elsewhere fails the build', () => {
        const d = h.fresh();
        h.write(d, 'rsbuild.config.ts', h.read(d, 'rsbuild.config.ts').replace(
          'tools: { rspack: (config) => withStuntDouble(config) },',
          "tools: { rspack: [(config) => withStuntDouble(config), (config, { rspack }) => { config.plugins!.unshift(new rspack.NormalModuleReplacementPlugin(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag')); }] },",
        ));
        h.assertFails(h.build(d), /\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but [^\n]*PriceTag\.jsx is not in the bundle/);
      });
    },
  },
  extra: (h) => {
    test('rsbuild: performance.buildCache gets the stunt-double fingerprint in the Rspack cache version (both environments)', () => {
      const d = h.fresh();
      const r = run(d, ['rsbuild', 'inspect'], { NODE_ENV: 'production' });
      assert.equal(r.status, 0, r.out);
      for (const env of ['web', 'node'])
        assert.match(h.read(d, `.rsbuild/rspack.config.${env}.mjs`), new RegExp(`version: '${env}-production\\|stunt-double:[0-9a-f]+'`));
    });

    test('rsbuild: F8 fails at STA even with resolve.dedupe (install preflight; the bundle itself would be deduped)', () => {
      const d = h.fresh();
      h.npmInstall(d, '--no-save', h.sdkPack('1.0.0-nested-react'));
      assert.match(h.read(d, 'rsbuild.config.ts'), /dedupe: \['react', 'react-dom'\]/);
      h.assertFails(h.build(d), /\[F8\] "react" resolves to 2 copies/);
    });

    test('rsbuild: resolve.dedupe of the SDK itself breaks its exports subpaths (documented: dedupe react/react-dom only)', () => {
      const d = h.fresh();
      h.write(d, 'rsbuild.config.ts', h.read(d, 'rsbuild.config.ts').replace("dedupe: ['react', 'react-dom']", "dedupe: ['react', 'react-dom', '@acme/core']"));
      h.assertFails(h.build(d), /Cannot find module '@acme\/core\/original\/Button' for matched aliased key '@acme\/core'/);
    });

    // Regression for the multi-compiler shim invalidation (adapters/webpack.mjs shimChanges): the web AND the node
    // environment must compile the new decision in the FIRST rebuild after an override is removed / re-added.
    test('rsbuild: dev, both environments get the new decision in the first rebuild', { timeout: 120_000 }, async () => {
      const d = h.fresh();
      h.write(d, 'rsbuild.config.ts', h.read(d, 'rsbuild.config.ts').replace(
        'tools: { rspack: (config) => withStuntDouble(config) },',
        `tools: { rspack: (config) => { const c: any = withStuntDouble(config); c.plugins.push({ apply(compiler: any) {
    compiler.hooks.done.tap('probe', (stats: any) => {
      const mods: string[] = stats.toJson({ modules: true, all: false }).modules.map((m: any) => m.name ?? '');
      const has = (s: string) => mods.some((m) => m.includes(s));
      console.log(\`PROBE \${compiler.options.name} errors=\${stats.compilation.errors.length} override=\${has('overrides/PriceTag')} default=\${has('original/PriceTag')}\`);
    });
  } }); return c; } },`,
      ));
      const port = 20000 + Math.floor(Math.random() * 20000);
      const srv = spawn('npx', ['rsbuild', 'dev'], { cwd: d, env: { ...process.env, PORT: String(port), NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      const probes = [];
      let log = '';
      srv.stdout.on('data', (b) => { log += b; for (const m of String(b).matchAll(/^PROBE (\w+) errors=(\d+) override=(\w+) default=(\w+)$/gm)) probes.push({ env: m[1], errors: +m[2], override: m[3] === 'true', def: m[4] === 'true' }); });
      srv.stderr.on('data', (b) => { log += b; });
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const firstAfter = async (n0, env) => { for (let i = 0; i < 300; i++) { const p = probes.slice(n0).find((x) => x.env === env); if (p) return p; await sleep(100); } throw new Error(`no ${env} rebuild\n${log.slice(-3000)}`); };
      const ov = path.join(d, 'src/overrides/PriceTag.tsx');
      const saved = fs.readFileSync(ov, 'utf8');
      try {
        for (const env of ['web', 'node']) assert.deepEqual(await firstAfter(0, env), { env, errors: 0, override: true, def: false });
        await sleep(1500);
        let n0 = probes.length;
        fs.rmSync(ov);
        for (const env of ['web', 'node']) assert.deepEqual(await firstAfter(n0, env), { env, errors: 0, override: false, def: true }, `first ${env} rebuild after removing PriceTag`);
        await sleep(2500);
        n0 = probes.length;
        fs.writeFileSync(ov, saved);
        for (const env of ['web', 'node']) assert.deepEqual(await firstAfter(n0, env), { env, errors: 0, override: true, def: false }, `first ${env} rebuild after re-adding PriceTag`);
      } finally {
        try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
      }
    });
  },
});
