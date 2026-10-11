// Zero-plugin variant: only esbuild's own `alias` option. Nothing validates here, so the npm script MUST be
// `stunt-double check && node build-alias.mjs` (the check runs validation + the contract type check).
import * as esbuild from 'esbuild';
import { stuntDoubleAlias } from 'stunt-double/esbuild';

const shared = { bundle: true, jsx: 'automatic', logLevel: 'info', alias: stuntDoubleAlias() };

try {
  await esbuild.build({ ...shared, entryPoints: ['src/main.tsx'], outdir: 'dist/assets', platform: 'browser', format: 'esm', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
  await esbuild.build({ ...shared, entryPoints: ['src/entry-server.tsx'], outdir: 'dist-ssr', platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react/*', 'react-dom/*'] });
} catch {
  process.exit(1);
}
