# React Router 8 (framework mode)

React Router's framework mode is a Vite plugin, so it uses the [Vite adapter](vite.md) unchanged:

```ts
// vite.config.ts
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { stuntDouble } from 'stunt-double/vite';

export default defineConfig({ plugins: [reactRouter(), stuntDouble()] });
```

`react-router build` runs two Vite environments, client and SSR; the plugin aliases the slot sockets in both and keeps `@acme/core` bundled in the server environment (`[F6]` if a config externalizes it). Prerendered pages (`prerender` in `react-router.config.ts`) contain the overrides.

**Install `isbot` yourself.** If it is missing, `react-router build` installs it, which rewrites `package.json` and can prune `node_modules` mid-build.

**Verified with** react-router / @react-router/dev 8.4.0, vite 8.3.4, TypeScript 7.0.2 and 5.9.3: `tests/react-router.test.mjs` runs the shared catalogue, the Vite-family scenarios (SSR externals, a user alias bypassing a slot) and the universal tier, reading the prerendered `build/client/index.html`.
