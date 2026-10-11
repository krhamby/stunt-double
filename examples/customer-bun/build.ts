// `bun build.ts`: the Bun bundler with stunt-double. The `bun build` CLI cannot load plugins, so builds go
// through Bun.build(). Any injection error rejects Bun.build(), so this script exits 1.
import { stuntDoubleBun } from 'stunt-double/bun';

const sd = stuntDoubleBun();

// Browser bundle (what ships).
await Bun.build({ entrypoints: ['./src/main.tsx'], outdir: './dist', target: 'browser', minify: true, plugins: [sd] });

// SSR bundle for Node (render probe): everything bundled, so @acme/core and the overrides are inlined.
await Bun.build({ entrypoints: ['./src/entry-server.tsx'], outdir: './dist-ssr', target: 'node', format: 'esm', plugins: [sd] });

console.log('customer-bun: built dist/ and dist-ssr/');
