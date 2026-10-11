# Vite 8, Vitest 5, Rollup 4, Rolldown 1

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

export default { plugins: [react(), stuntDouble()] };
```

Vitest picks the plugin up from the same config. The same object is a Rollup and Rolldown plugin (`stunt-double/rollup`, `stunt-double/rolldown`). Plugin order does not matter.

| Stage | What happens |
|---|---|
| config | validates `src/overrides`, writes `.stunt-double/`, adds one alias `@acme/core-slots/<Slot>` → `.stunt-double/gen/<Slot>.jsx`, keeps the SDK in the SSR bundle (`ssr.noExternal`, Vitest `server.deps.inline`) and out of the dependency optimizer |
| config resolved | `[F6]` if a server environment externalizes the SDK, or the optimizer would pre-bundle the slot package |
| `vite build` | every validation error and the contract type check fail the build before bundling (exit 1); after bundling, the graph audit |
| `vite` (dev) | errors appear in the browser overlay and the terminal; editing, adding or removing an override regenerates live; the type check runs asynchronously and pushes F1 to the overlay |
| `vitest` | refuses to start on any validation error; contracts are not type-checked (residual R3) |

Options: `stuntDouble({ typecheck, audit, ...anyConfigKey })`. An unknown option is a `[CFG]` error.

**Verified with** vite 8.3.4, vitest 5.0.3, @vitejs/plugin-react 6.1.2, TypeScript 7.0.2 and 5.9.3: `tests/vite.test.mjs` (the shared catalogue, the Vite-family scenarios, a live dev-server probe and the universal tier).
