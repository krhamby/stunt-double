# esbuild 0.28

esbuild's CLI cannot load JavaScript plugins, so build through its JavaScript API:

```js
// scripts/build.mjs
import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';

await esbuild.build({ entryPoints: ['src/main.tsx'], bundle: true, jsx: 'automatic', plugins: [stuntDoubleEsbuild()] });
```

| Stage | What happens |
|---|---|
| plugin setup | validates `src/overrides`, writes `.stunt-double/`, turns on `metafile` for the audit |
| `onStart` (every build, and every watch/serve rebuild) | regenerates; validation errors, `[F6]` for `packages: "external"` or an `external` entry matching the SDK, and the contract type check become esbuild errors: `build()` rejects and nothing is written |
| `onResolve` | `@acme/core-slots/<Slot>` → `.stunt-double/gen/<Slot>.jsx`, watching `src/overrides` so watch mode rebuilds on add/remove/edit |
| `onEnd` | the post-bundle graph audit of the metafile |

**SSR bundles:** keep the SDK bundled. Leaving React external is fine (`external: ['react', 'react/*', 'react-dom', 'react-dom/*']`), and avoids esbuild's "Dynamic require" error for React's CommonJS build in an ESM bundle.

Options: `stuntDoubleEsbuild({ typecheck, audit, ...anyConfigKey })`.

**Verified with** esbuild 0.28.2, TypeScript 7.0.2 and 5.9.3: `tests/esbuild.test.mjs` (the shared catalogue and the universal tier), plus watch mode (a typo fails the rebuild with `[F2]`, the fix recovers).
