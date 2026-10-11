# customer-esbuild

An esbuild 0.28 app that injects its own components and services into the fixture SDK `@acme/core` with
stunt-double. The overrides in [src/overrides/](src/overrides) are the same as customer-vite's: `Button` wraps
the SDK default, `PriceTag` replaces it, `Logo` implements the required slot, and the value slots `formatPrice`
(a function) and `analytics` (a service object) replace the SDK's formatter and analytics.

The setup is one plugin in [scripts/build.mjs](scripts/build.mjs). esbuild's CLI cannot load JavaScript plugins,
so the build goes through the JS API:

```js
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';
await esbuild.build({ entryPoints: ['src/main.tsx'], bundle: true, plugins: [stuntDoubleEsbuild()] });
```

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build                  # browser + SSR bundles; fails with an [Fx] report on any injection mistake
npm run probe                  # renders the SSR bundle and prints the render markers
```
