// The production build: a browser bundle (dist/) and an SSR bundle the render probe imports (dist-ssr/).
// stuntDoubleEsbuild() is the whole setup: it validates src/overrides at every build start, answers
// @acme/core-slots/* with the generated shims, runs the contract type check and audits the bundle. Any
// injection mistake makes build() reject, so this script exits non-zero.
import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';

const common = { bundle: true, jsx: 'automatic', logLevel: 'warning', plugins: [stuntDoubleEsbuild()] };

await esbuild.build({
  ...common,
  entryPoints: ['src/main.tsx'],
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

// SSR: React stays external (Node loads its CommonJS build natively); @acme/core MUST be bundled, so its slot
// imports go through the plugin. Externalizing the SDK is an [F6] build error.
await esbuild.build({
  ...common,
  entryPoints: ['src/entry-server.tsx'],
  outfile: 'dist-ssr/entry-server.js',
  format: 'esm',
  platform: 'node',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
});
