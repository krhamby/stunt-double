// webpack 5 + Babel 8 (withStuntDouble() from stunt-double/webpack). Fixture: examples/customer-webpack, the same
// overrides as customer-vite, built as one multi-compiler config (client + SSR). Runs the positive scenario, the
// shared mutation catalogue, the webpack-family scenarios, the type gate under TypeScript 5.9 and the universal
// tier. See tests/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './harness/util.mjs';
import { defineToolSuite } from './harness/index.mjs';

/** The fixture's webpack config without stunt-double (a second config nobody wired, or the universal tier). */
const withoutAdapter = () => fs.readFileSync(path.join(REPO_ROOT, 'examples/customer-webpack/webpack.config.mjs'), 'utf8')
  .replace(/^import \{ withStuntDouble \} from 'stunt-double\/webpack';\n/m, '')
  .replace(/^export default withStuntDouble\(([\s\S]*)\);\s*$/m, 'export default $1;\n');

defineToolSuite({
  name: 'webpack',
  family: 'webpack',
  fixtureDir: 'examples/customer-webpack',
  toolConfig: 'webpack.config.mjs',
  commands: {
    build: 'webpack --mode production',
    render: 'node probes/render.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { 'webpack.unwired.config.mjs': withoutAdapter() },
    command: 'webpack --mode production --config webpack.unwired.config.mjs',
  },
  typescript5: true,
  universal: {
    files: { 'webpack.universal.config.mjs': withoutAdapter() },
    build: 'stunt-double check && webpack --mode production --config webpack.universal.config.mjs',
    bare: 'webpack --mode production --config webpack.universal.config.mjs',
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b', 'V1c'],
  },
});
