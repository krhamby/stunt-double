// The production build with Bun's bundler: a browser bundle (dist/) and an SSR bundle the render probe imports
// (dist-ssr/). stuntDoubleBun() validates src/overrides and runs the contract type check at every build start,
// and answers @acme/core-slots/* with the generated shims. Any injection mistake fails the build (exit 1).
import { stuntDoubleBun } from 'stunt-double/bun';

const plugins = [stuntDoubleBun()];

async function build(options: Parameters<typeof Bun.build>[0]) {
  const result = await Bun.build({ ...options, plugins });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

await build({ entrypoints: ['./src/main.tsx'], outdir: './dist', target: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });

// SSR: React stays external (Node loads its CommonJS build); @acme/core MUST be bundled, so its slot imports go
// through the plugin. Externalizing the SDK is an [F6] build error.
await build({ entrypoints: ['./src/entry-server.tsx'], outdir: './dist-ssr', target: 'node', format: 'esm', external: ['react', 'react/*', 'react-dom', 'react-dom/*'] });
