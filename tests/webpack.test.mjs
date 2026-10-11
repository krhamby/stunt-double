// webpack 5 + webpack-dev-server: examples/customer-webpack (client + node SSR compilers, swc-loader, filesystem
// cache) with stunt-double/webpack. Runs the positive scenario, the shared mutation catalogue, the
// webpack-family scenarios (tests/webpack-family/extras.mjs), a live dev-server probe in Chromium, the type gate
// under TypeScript 5.9 and the universal tier. See tests/README.md and docs/tools/webpack.md.
import { defineToolSuite } from './harness/index.mjs';
import { unwiredConfig, webpackFamilyMutations, webpackDevProbe } from './webpack-family/extras.mjs';

const fixtureDir = 'examples/customer-webpack';
const build = 'webpack --mode production';
const NO_ADAPTER = unwiredConfig(fixtureDir, 'webpack.config.mjs');

defineToolSuite({
  name: 'webpack',
  family: 'webpack',
  fixtureDir,
  toolConfig: 'webpack.config.mjs',
  commands: {
    build,
    render: 'node probes/render.mjs dist-ssr/entry-server.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/*.js' }, alsoPass: ['check'] },
  unwired: {
    files: { 'webpack.unwired.config.mjs': NO_ADAPTER },
    command: `${build} --config webpack.unwired.config.mjs`,
  },
  addDevDependencies: { 'webpack-node-externals': '3.0.0' },
  mutations: (list) => [...list, ...webpackFamilyMutations({ build, toolPackage: 'webpack' })],
  devProbe: webpackDevProbe({ dev: 'webpack serve --mode development', overlay: '#webpack-dev-server-client-overlay' }),
  typescript5: true,
  universal: {
    files: { 'webpack.universal.config.mjs': NO_ADAPTER },
    build: `stunt-double check && ${build} --config webpack.universal.config.mjs`,
    bare: `${build} --config webpack.universal.config.mjs`,
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});
