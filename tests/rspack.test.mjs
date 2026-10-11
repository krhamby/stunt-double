// Rspack 2 + builtin:swc-loader, through the webpack adapter (withStuntDouble() from stunt-double/webpack).
// Fixture: examples/customer-rspack, the same overrides as customer-vite, one multi-compiler config (client +
// SSR). Runs the positive scenario, the per-tool scenarios of the shared catalogue, the webpack-family scenarios
// and the universal tier. See tests/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './harness/util.mjs';
import { defineToolSuite, watchProbe } from './harness/index.mjs';

/** The fixture's Rspack config without stunt-double (a second config nobody wired, or the universal tier). */
const withoutAdapter = () => fs.readFileSync(path.join(REPO_ROOT, 'examples/customer-rspack/rspack.config.mjs'), 'utf8')
  .replace(/^import \{ withStuntDouble \} from 'stunt-double\/webpack';\n/m, '')
  .replace(/^export default withStuntDouble\(([\s\S]*)\);\s*$/m, 'export default $1;\n');

defineToolSuite({
  name: 'rspack',
  family: 'webpack',
  fixtureDir: 'examples/customer-rspack',
  toolConfig: 'rspack.config.mjs',
  commands: {
    build: 'rspack build --mode production',
    render: 'node probes/render.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { 'rspack.unwired.config.mjs': withoutAdapter() },
    command: 'rspack build --mode production --config rspack.unwired.config.mjs',
  },
  devProbe: watchProbe({ command: 'rspack build --mode development --watch' }),
  universal: {
    files: { 'rspack.universal.config.mjs': withoutAdapter() },
    build: 'stunt-double check && rspack build --mode production --config rspack.universal.config.mjs',
    bare: 'rspack build --mode production --config rspack.universal.config.mjs',
  },
});
