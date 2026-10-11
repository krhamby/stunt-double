// Rsbuild 2 (web + node environments): examples/customer-rsbuild with stunt-double/webpack through
// `tools: { rspack: (c) => withStuntDouble(c) }`. Runs the positive scenario, the shared mutation catalogue, the
// webpack-family scenarios (tests/webpack-family/extras.mjs), the Rsbuild-specific scenarios below, a live
// dev-server probe in Chromium, the type gate under TypeScript 5.9 and the universal tier. See tests/README.md and
// docs/tools/rsbuild.md.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { defineToolSuite } from './harness/index.mjs';
import { unwiredConfig, webpackFamilyMutations, webpackDevProbe } from './webpack-family/extras.mjs';

const fixtureDir = 'examples/customer-rsbuild';
const build = 'rsbuild build';
const NO_ADAPTER = unwiredConfig(fixtureDir, 'rsbuild.config.ts');

// Rsbuild sets server externals with output.externals inside the node environment, and extends a config with
// mergeRsbuildConfig (tools.rspack functions of both run in order: withStuntDouble first, then the user plugin).
const family = webpackFamilyMutations({
  build,
  toolPackage: '@rspack/core',
  ssrMarker: "        target: 'node',\n",
  externalsLine: (v) => `        externals: ${v},\n`,
  auditConfig: (toolConfig) => ({
    file: 'audit.config.ts',
    text: `import { mergeRsbuildConfig } from '@rsbuild/core';
import base from './${toolConfig.replace(/\.ts$/, '')}';

// A user plugin that "helpfully" resolves the PriceTag socket itself.
export default mergeRsbuildConfig(base, {
  tools: { rspack: (config, { rspack }) => { config.plugins!.unshift(new rspack.NormalModuleReplacementPlugin(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag')); } },
});
`,
  }),
});

/** Rsbuild-specific scenarios: claims docs/tools/rsbuild.md makes about Rsbuild's own options. */
const RSBUILD = [
  {
    id: 'RSB-cache-version',
    title: "performance.buildCache: the stunt-double fingerprint is folded into both environments' Rspack cache version",
    catches: 'CFG (withStuntDouble)',
    tags: ['cache'],
    apply: () => {},
    expect: {
      outcome: 'pass',
      run: `NODE_ENV=production rsbuild inspect >/dev/null && grep -q "version: 'web-production|stunt-double:[0-9a-f]*'" .rsbuild/rspack.config.web.mjs && grep -q "version: 'node-production|stunt-double:[0-9a-f]*'" .rsbuild/rspack.config.node.mjs`,
    },
  },
  {
    id: 'RSB-F8-dedupe',
    title: 'duplicate React with resolve.dedupe in the config: still fails (install preflight), although the bundle would be deduped',
    catches: 'STA (singleton preflight)',
    tags: ['sta', 'sdk-bug'],
    sdk: '1.0.0-nested-react',
    apply: (fx) => assert.match(fx.read('rsbuild.config.ts'), /dedupe: \['react', 'react-dom'\]/),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F8\] "react" resolves to 2 copies/] },
  },
  {
    id: 'RSB-dedupe-sdk',
    title: 'resolve.dedupe of the SDK itself is a directory alias that breaks its exports subpaths (documented: dedupe react/react-dom only)',
    catches: 'RES',
    tags: ['res'],
    apply: (fx) => fx.edit('rsbuild.config.ts', (s) => s.replace("dedupe: ['react', 'react-dom']", "dedupe: ['react', 'react-dom', '@acme/core']")),
    expect: { outcome: 'fail', command: 'build', messages: [/Cannot find module '@acme\/core\/original\/Button' for matched aliased key '@acme\/core'/] },
  },
];

// Multi-compiler regression (adapters/webpack.mjs shimChanges): in `rsbuild dev`, the web AND the node
// environment compile the new decision in the FIRST rebuild after an override is removed / re-added.
async function bothEnvironmentsInFirstRebuild(fx, t) {
  fx.write('rsbuild.probe.config.ts', `import { mergeRsbuildConfig } from '@rsbuild/core';
import base from './rsbuild.config';

export default mergeRsbuildConfig(base, { tools: { rspack: (config: any) => {
  config.plugins.push({ apply(compiler: any) {
    compiler.hooks.done.tap('probe', (stats: any) => {
      const mods: string[] = stats.toJson({ modules: true, all: false }).modules.map((m: any) => m.name ?? '');
      const has = (s: string) => mods.some((m) => m.includes(s));
      console.log(\`PROBE \${compiler.options.name} errors=\${stats.compilation.errors.length} override=\${has('overrides/PriceTag')} default=\${has('original/PriceTag')}\`);
    });
  } });
} } });
`);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PATH: `${path.join(fx.app, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}`, NO_COLOR: '1', FORCE_COLOR: '0' };
  const srv = spawn('sh', ['-c', `rsbuild dev -c rsbuild.probe.config.ts --port ${port}`], { cwd: fx.app, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const probes = [];
  let log = '';
  srv.stdout.on('data', (b) => { log += b; for (const m of String(b).matchAll(/^PROBE (\w+) errors=(\d+) override=(\w+) default=(\w+)$/gm)) probes.push({ env: m[1], errors: +m[2], override: m[3] === 'true', def: m[4] === 'true' }); });
  srv.stderr.on('data', (b) => { log += b; });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const first = async (n0, env) => {
    for (let i = 0; i < 600; i++) { const p = probes.slice(n0).find((x) => x.env === env); if (p) return p; await sleep(100); }
    assert.fail(`no ${env} rebuild\n${log.slice(-3000)}`);
  };
  const price = fx.override('PriceTag.tsx');
  try {
    for (const e of ['web', 'node']) assert.deepEqual(await first(0, e), { env: e, errors: 0, override: true, def: false });
    await sleep(2000);
    let n0 = probes.length;
    fx.remove(price);
    for (const e of ['web', 'node']) assert.deepEqual(await first(n0, e), { env: e, errors: 0, override: false, def: true }, `first ${e} rebuild after removing PriceTag`);
    await sleep(3000);
    n0 = probes.length;
    fx.restore(price);
    for (const e of ['web', 'node']) assert.deepEqual(await first(n0, e), { env: e, errors: 0, override: true, def: false }, `first ${e} rebuild after re-adding PriceTag`);
    t.diagnostic('dev: both environments compiled the new decision in the first rebuild');
  } finally {
    try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
    await sleep(500);
  }
}

const browser = webpackDevProbe({ dev: 'rsbuild dev', overlay: 'rsbuild-error-overlay' });

defineToolSuite({
  name: 'rsbuild',
  family: 'webpack',
  fixtureDir,
  toolConfig: 'rsbuild.config.ts',
  commands: {
    build,
    render: 'node probes/render.mjs dist-ssr/entry-server.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/static/js/*.js' }, alsoPass: ['check'] },
  unwired: {
    files: { 'rsbuild.unwired.config.ts': NO_ADAPTER },
    command: `${build} --config rsbuild.unwired.config.ts`,
  },
  addDevDependencies: { 'webpack-node-externals': '3.0.0' },
  mutations: (list) => [...list, ...family, ...RSBUILD],
  devProbe: async (fx, t, suite) => {
    await browser(fx, t, suite);
    await bothEnvironmentsInFirstRebuild(fx, t);
  },
  typescript5: true,
  universal: {
    files: { 'rsbuild.universal.config.ts': NO_ADAPTER },
    build: `stunt-double check && ${build} --config rsbuild.universal.config.ts`,
    bare: `${build} --config rsbuild.universal.config.ts`,
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});
