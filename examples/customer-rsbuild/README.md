# customer-rsbuild

An Rsbuild 2 app (web and node environments) that injects its own components and services into the fixture SDK
`@acme/core` with stunt-double. Rsbuild builds with Rspack, so the webpack adapter applies through its
`tools.rspack` hook:

```ts
// rsbuild.config.ts
import { withStuntDouble } from 'stunt-double/webpack';
export default defineConfig({ plugins: [pluginReact()], tools: { rspack: (config) => withStuntDouble(config) } });
```

The overrides in [src/overrides/](src/overrides) are the same as customer-vite's.

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build                  # rsbuild build (web + node); fails with an [Fx] report on any injection mistake
npm run probe                  # renders the SSR bundle and prints the render markers
```
