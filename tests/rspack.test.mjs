// Rspack 2 + @rspack/dev-server: examples/customer-rspack (client + node SSR compilers, builtin:swc-loader, persistent
// cache) with stunt-double/webpack. Runs the positive scenario, the shared mutation catalogue, the
// webpack-family scenarios (tests/webpack-family/extras.mjs), a live dev-server probe in Chromium, the type gate
// under TypeScript 5.9 and the universal tier. See tests/README.md and docs/tools/rspack.md.
import { defineToolSuite } from './harness/index.mjs';
import { unwiredConfig, webpackFamilyMutations, webpackDevProbe } from './webpack-family/extras.mjs';

const fixtureDir = 'examples/customer-rspack';
const build = 'rspack build --mode production';
const NO_ADAPTER = unwiredConfig(fixtureDir, 'rspack.config.mjs');

defineToolSuite({
  name: 'rspack',
  family: 'webpack',
  fixtureDir,
  toolConfig: 'rspack.config.mjs',
  commands: {
    build,
    render: 'node probes/render.mjs dist-ssr/entry-server.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/*.js' }, alsoPass: ['check'] },
  unwired: {
    files: { 'rspack.unwired.config.mjs': NO_ADAPTER },
    command: `${build} --config rspack.unwired.config.mjs`,
  },
  addDevDependencies: { 'webpack-node-externals': '3.0.0' },
  mutations: (list) => [...list, ...webpackFamilyMutations({ build, toolPackage: '@rspack/core' })],
  devProbe: webpackDevProbe({ dev: 'rspack dev --mode development', overlay: '#rspack-dev-server-client-overlay' }),
  typescript5: true,
  universal: {
    files: { 'rspack.universal.config.mjs': NO_ADAPTER },
    build: `stunt-double check && ${build} --config rspack.universal.config.mjs`,
    bare: `${build} --config rspack.universal.config.mjs`,
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});
