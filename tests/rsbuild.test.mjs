// Rsbuild 2 (web + node environments) through the webpack adapter's tools.rspack hook. Fixture:
// examples/customer-rsbuild, the same overrides as customer-vite. Runs the positive scenario, the shared
// catalogue, the webpack-family scenarios that apply, the type gate under TypeScript 5.9 and the universal tier.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './harness/util.mjs';
import { defineToolSuite } from './harness/index.mjs';

/** rsbuild.config.ts without stunt-double (a config nobody wired, or the universal tier with a package link). */
const withoutAdapter = () => fs.readFileSync(path.join(REPO_ROOT, 'examples/customer-rsbuild/rsbuild.config.ts'), 'utf8')
  .replace(/^import \{ withStuntDouble \} from 'stunt-double\/webpack';\n/m, '')
  .replace(/^\s*\/\/ Rsbuild builds with Rspack[^\n]*\n\s*tools: \{ rspack: \(config\) => withStuntDouble\(config\) \},\n/m, '');

defineToolSuite({
  name: 'rsbuild',
  family: 'webpack',
  fixtureDir: 'examples/customer-rsbuild',
  toolConfig: 'rsbuild.config.ts',
  commands: {
    build: 'rsbuild build',
    render: 'node probes/render.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/static/js/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { 'rsbuild.unwired.config.ts': withoutAdapter() },
    command: 'rsbuild build -c rsbuild.unwired.config.ts',
  },
  expectations: {
    'F6g-alias-webpack': "the fixture's rsbuild.config.ts has no resolve block to add an alias to (the adapter's precedence over user aliases is covered by the webpack and rspack suites)",
  },
  typescript5: true,
  universal: {
    files: { 'rsbuild.universal.config.ts': withoutAdapter() },
    build: 'stunt-double check && rsbuild build -c rsbuild.universal.config.ts',
    bare: 'rsbuild build -c rsbuild.universal.config.ts',
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b', 'V1c'],
  },
});
