// esbuild 0.28 (JS API + stuntDoubleEsbuild()). Fixture: examples/customer-esbuild, the same overrides as
// customer-vite. Runs the positive scenario, the per-tool scenarios of the shared catalogue and the universal
// tier. See tests/README.md.
import { defineToolSuite } from './harness/index.mjs';

/** The same two builds as scripts/build.mjs, with or without the plugin. */
const buildScript = (withPlugin) => `import * as esbuild from 'esbuild';
${withPlugin ? `import { stuntDoubleEsbuild } from 'stunt-double/esbuild';\n` : ''}
const common = { bundle: true, jsx: 'automatic', logLevel: 'warning'${withPlugin ? ', plugins: [stuntDoubleEsbuild()]' : ''} };
await esbuild.build({ ...common, entryPoints: ['src/main.tsx'], outdir: 'dist', format: 'esm', platform: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await esbuild.build({ ...common, entryPoints: ['src/entry-server.tsx'], outfile: 'dist-ssr/entry-server.js', format: 'esm', platform: 'node', external: ['react', 'react/*', 'react-dom', 'react-dom/*'] });
`;

defineToolSuite({
  name: 'esbuild',
  fixtureDir: 'examples/customer-esbuild',
  toolConfig: 'scripts/build.mjs',
  commands: {
    build: 'node scripts/build.mjs',
    render: 'node probes/render.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/*.js' },
    alsoPass: ['check'],
  },
  // a second build script that never got the plugin (a one-off script, a docs build, ...)
  unwired: {
    files: { 'scripts/build.unwired.mjs': buildScript(false) },
    command: 'node scripts/build.unwired.mjs',
  },
  universal: {
    files: { 'scripts/build.universal.mjs': buildScript(false) },
    build: 'stunt-double check && node scripts/build.universal.mjs',
    bare: 'node scripts/build.universal.mjs',
  },
});
