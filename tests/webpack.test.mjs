// webpack 5 + Babel 8 (withStuntDouble() from stunt-double/webpack) and Jest 30 (withStuntDouble() from
// stunt-double/jest). Fixture: examples/customer-webpack, the same overrides as customer-vite, built as one
// multi-compiler config (client + SSR) and tested with Jest. Runs the positive scenario, the per-tool scenarios of
// the shared catalogue, the webpack-family scenarios and the universal tier. See tests/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './harness/util.mjs';
import { defineToolSuite } from './harness/index.mjs';

// Mistakes Jest must also refuse at startup (withStuntDouble() validates when Jest loads jest.config.mjs).
const ALSO_JEST = ['F2a'];

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
    test: 'jest',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/*.js' },
    alsoPass: ['check', 'test'],
  },
  unwired: {
    files: { 'webpack.unwired.config.mjs': withoutAdapter() },
    command: 'webpack --mode production --config webpack.unwired.config.mjs',
  },
  expectations: (m) => (ALSO_JEST.includes(m.id) ? { also: [{ command: 'test' }] } : undefined),
  universal: {
    files: { 'webpack.universal.config.mjs': withoutAdapter() },
    build: 'stunt-double check && webpack --mode production --config webpack.universal.config.mjs',
    bare: 'webpack --mode production --config webpack.universal.config.mjs',
  },
});
