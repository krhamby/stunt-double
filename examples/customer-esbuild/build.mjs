// esbuild build script: a browser bundle (dist/) and an SSR bundle for the render probe (dist-ssr/).
// stuntDoubleEsbuild() validates src/overrides, maps @acme/core-slots/* to the generated shims, runs the
// contract type check and audits the bundle: any injection mistake fails this script with an [Fx] message.
import fs from 'node:fs';
import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';

const shared = { bundle: true, jsx: 'automatic', logLevel: 'info', plugins: [stuntDoubleEsbuild()] };

try {
  await esbuild.build({
    ...shared,
    entryPoints: ['src/main.tsx'],
    outdir: 'dist/assets',
    platform: 'browser',
    format: 'esm',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await esbuild.build({
    ...shared,
    entryPoints: ['src/entry-server.tsx'],
    outdir: 'dist-ssr',
    platform: 'node',
    format: 'esm',
    // React stays external (Node loads it); @acme/core MUST be bundled so its socket imports reach the shims.
    external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
  });
  fs.copyFileSync('index.html', 'dist/index.html');
} catch {
  process.exit(1); // esbuild already printed the errors (logLevel: 'info')
}
