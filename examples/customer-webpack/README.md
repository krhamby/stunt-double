# customer-webpack

A webpack 5 app (Babel 8 for TypeScript and JSX) that injects its own components and services into the fixture
SDK `@acme/core` with stunt-double. The overrides in [src/overrides/](src/overrides) are the same as
customer-vite's.

The setup is one wrapper in [webpack.config.mjs](webpack.config.mjs):

```js
import { withStuntDouble } from 'stunt-double/webpack';
export default withStuntDouble([client, ssr]);   // an object, an array or a function config
```

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build                  # webpack --mode production (client + SSR); fails with an [Fx] report on any injection mistake
npm run probe                  # renders the SSR bundle and prints the render markers
```
