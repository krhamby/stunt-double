# customer-bun

A Bun 1.4 app (Bun's bundler, `Bun.build()`) that injects its own components and services into the fixture SDK
`@acme/core` with stunt-double. The overrides in [src/overrides/](src/overrides) are the same as customer-vite's.

The setup is one plugin in [scripts/build.ts](scripts/build.ts):

```ts
import { stuntDoubleBun } from 'stunt-double/bun';
await Bun.build({ entrypoints: ['./src/main.tsx'], outdir: './dist', plugins: [stuntDoubleBun()] });
```

```bash
npm run setup                  # at the repository root: builds .packs/
npm install                    # (or bun install with a "workspace:*" universal-tier link)
bun run build                  # browser + SSR bundles; fails with an [Fx] report on any injection mistake
node probes/render.mjs         # renders the SSR bundle and prints the render markers
```
