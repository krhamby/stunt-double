// Bun 1.4's bundler (Bun.build + stuntDoubleBun() from stunt-double/bun). Fixture: examples/customer-bun, the same
// overrides as customer-vite, installed with npm and built by `bun scripts/build.ts`. Runs the positive scenario,
// the shared catalogue, the type gate under TypeScript 5.9 and the universal tier. Needs `bun` on PATH.
import { defineToolSuite } from './harness/index.mjs';

/** The same two builds as scripts/build.ts, without the plugin (a script nobody wired, or the universal tier). */
const PLAIN_BUILD = `async function build(options: Parameters<typeof Bun.build>[0]) {
  const result = await Bun.build(options);
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

await build({ entrypoints: ['./src/main.tsx'], outdir: './dist', target: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await build({ entrypoints: ['./src/entry-server.tsx'], outdir: './dist-ssr', target: 'node', format: 'esm', external: ['react', 'react/*', 'react-dom', 'react-dom/*'] });
`;

defineToolSuite({
  name: 'bun',
  fixtureDir: 'examples/customer-bun',
  toolConfig: 'scripts/build.ts',
  commands: {
    build: 'bun scripts/build.ts',
    render: 'node probes/render.mjs',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { 'scripts/build.unwired.ts': PLAIN_BUILD },
    command: 'bun scripts/build.unwired.ts',
  },
  typescript5: true,
  universal: {
    files: { 'scripts/build.universal.ts': PLAIN_BUILD },
    build: 'stunt-double check && bun scripts/build.universal.ts',
    bare: 'bun scripts/build.universal.ts',
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b', 'V1c'],
  },
});
