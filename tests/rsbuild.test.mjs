// Rsbuild 2 (web + node environments): examples/customer-rsbuild, stunt-double/webpack through
// `tools: { rspack: (c) => withStuntDouble(c) }`. Runs the positive scenario, the shared catalogue, the
// Rsbuild-specific scenarios below, a live dev-server probe in Chromium, the TypeScript 5.9 type gate and the
// universal tier. See tests/README.md and docs/tools/rsbuild.md.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { defineToolSuite } from './harness/index.mjs';
import { browserDevProbe } from './harness/browser-dev.mjs';

const BUILD = 'rsbuild build';
const WIRED = 'tools: { rspack: (config) => withStuntDouble(config) },';

// The same app built by Rsbuild WITHOUT the adapter: what a second, forgotten config looks like.
const UNWIRED_CONFIG = `import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

// A second Rsbuild config that never got withStuntDouble (e.g. a docs site or a one-off build).
export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './src/main.tsx' } },
});
`;

// Universal tier: no adapter, the socket resolves through the package link.
const UNIVERSAL_CONFIG = `import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  environments: {
    web: { source: { entry: { index: './src/main.tsx' } } },
    node: {
      source: { entry: { 'entry-server': './src/entry-server.tsx' } },
      output: { target: 'node', module: true, distPath: { root: 'dist-ssr', js: '' }, filename: { js: '[name].mjs' }, filenameHash: false, minify: false },
    },
  },
});
`;
const UNIVERSAL_BUILD = 'rsbuild build -c rsbuild.universal.config.ts';

const DEFAULT_PRICETAG = { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, BRAND_LOGO: 1 } };

/** Rsbuild-specific scenarios (appended to the shared catalogue). */
const RSBUILD = [
  {
    id: 'RSB-F6e',
    title: 'warm Rspack persistent cache (performance.buildCache): removing an override is never served from the cache',
    catches: 'fingerprint in cache.version + shim content',
    tags: ['cache', 'must-pass'],
    apply: async (fx) => {
      const warm = await fx.run(BUILD);
      assert.equal(warm.code, 0, `warm-up build failed\n${warm.output.slice(-3000)}`);
      fx.remove(fx.override('PriceTag.tsx'));
    },
    expect: { outcome: 'pass', command: 'build', render: DEFAULT_PRICETAG },
  },
  {
    id: 'RSB-F6e-readd',
    title: 'warm cache built WITHOUT the PriceTag override: adding it back renders the override',
    catches: 'fingerprint in cache.version + shim content',
    tags: ['cache', 'must-pass'],
    apply: async (fx) => {
      fx.remove(fx.override('PriceTag.tsx'));
      const warm = await fx.run(BUILD);
      assert.equal(warm.code, 0, `warm-up build failed\n${warm.output.slice(-3000)}`);
      fx.restore(fx.override('PriceTag.tsx'));
    },
    expect: { outcome: 'pass', command: 'build', render: { sdk: { BRAND_PRICE: 3, SDK_DEFAULT_PRICETAG: 0 } } },
  },
  {
    id: 'RSB-cache-version',
    title: 'performance.buildCache: the stunt-double fingerprint is folded into both environments\' Rspack cache version',
    catches: 'CFG (withStuntDouble)',
    tags: ['cache'],
    apply: () => {},
    expect: {
      outcome: 'pass',
      run: `NODE_ENV=production rsbuild inspect >/dev/null && grep -q "version: 'web-production|stunt-double:[0-9a-f]*'" .rsbuild/rspack.config.web.mjs && grep -q "version: 'node-production|stunt-double:[0-9a-f]*'" .rsbuild/rspack.config.node.mjs`,
    },
  },
  {
    id: 'RSB-audit',
    title: 'a plugin in tools.rspack resolves the PriceTag socket to the SDK default: the bundle audit fails the build',
    catches: 'AUD',
    tags: ['aud'],
    apply: (fx) => fx.edit('rsbuild.config.ts', (s) => s.replace(WIRED, "tools: { rspack: [(config) => withStuntDouble(config), (config, { rspack }) => { config.plugins!.unshift(new rspack.NormalModuleReplacementPlugin(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag')); }] },")),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but [^\n]*PriceTag\.jsx is not in the bundle/] },
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

const browser = browserDevProbe({ command: 'rsbuild dev --port {port}', overlay: 'rsbuild-error-overlay' });

defineToolSuite({
  name: 'rsbuild',
  fixtureDir: 'examples/customer-rsbuild',
  toolConfig: 'rsbuild.config.ts',
  commands: {
    build: BUILD,
    render: 'node probes/render.mjs dist-ssr/entry-server.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/static/js/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { 'rsbuild.unwired.config.ts': UNWIRED_CONFIG },
    command: 'rsbuild build -c rsbuild.unwired.config.ts',
  },
  mutations: (list) => [...list, ...RSBUILD],
  devProbe: async (fx, t, suite) => {
    await browser(fx, t, suite);
    await bothEnvironmentsInFirstRebuild(fx, t);
  },
  typescript5: true,
  universal: {
    files: { 'rsbuild.universal.config.ts': UNIVERSAL_CONFIG },
    build: `stunt-double check && ${UNIVERSAL_BUILD}`,
    bare: UNIVERSAL_BUILD,
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});
