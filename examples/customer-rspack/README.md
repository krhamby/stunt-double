# customer-rspack

An Rspack 2 app (`builtin:swc-loader` for TypeScript and JSX) that injects its own components and services into the
fixture SDK `@acme/core` with stunt-double. Rspack uses the webpack adapter unchanged:

```js
import { withStuntDouble } from 'stunt-double/webpack';
export default withStuntDouble((env, argv) => configs(argv.mode));
```

The overrides in [src/overrides/](src/overrides) are the same as customer-vite's.

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build                  # rspack build --mode production (client + SSR)
npm run probe                  # renders the SSR bundle and prints the render markers
```
