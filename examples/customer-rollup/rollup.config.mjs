// Rollup 4: a browser bundle (dist/) and an SSR bundle for the render probe (dist-ssr/).
// stuntDouble() is the same plugin object as in Vite: it validates src/overrides, maps @acme/core-slots/* to
// the generated shims, runs the contract type check at buildStart and audits the module graph at buildEnd.
// Every injection mistake fails `rollup -c` with an [Fx] message (this.error).
import { stuntDouble } from 'stunt-double/rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import esbuild from 'rollup-plugin-esbuild';

const plugins = (browser) => [
  stuntDouble(),
  nodeResolve({ browser, extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'] }),
  commonjs(),
  replace({ preventAssignment: true, values: { 'process.env.NODE_ENV': JSON.stringify('production') } }),
  esbuild({ jsx: 'automatic', target: 'es2022' }),
];

// The SDK's dist keeps its "use client" directives; Rollup drops them in a client bundle, which is fine here.
const onwarn = (w, warn) => { if (w.code !== 'MODULE_LEVEL_DIRECTIVE') warn(w); };

export default [
  { input: 'src/main.tsx', output: { dir: 'dist/assets', format: 'es' }, plugins: plugins(true), onwarn },
  {
    input: 'src/entry-server.tsx',
    output: { dir: 'dist-ssr', format: 'es' },
    // React stays external (Node loads it); @acme/core MUST be bundled so its socket imports reach the shims.
    external: [/^react(-dom)?(\/|$)/],
    plugins: plugins(false),
    onwarn,
  },
];
