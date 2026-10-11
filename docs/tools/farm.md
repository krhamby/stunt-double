# Farm

Farm runs the Vite plugin, `stuntDouble()` from `stunt-double/vite`, through its Vite-plugin compatibility layer (`vitePlugins`). Validation and the contract type check fail `farm build`; the post-bundle audit does not run under Farm.

Verified with @farmfe/core 1.7.11, @farmfe/cli 1.0.5, @farmfe/plugin-react 1.2.6, react-refresh 0.19.0, TypeScript 7.0.2, React 19.3.0 and Node 22.22.0. Reference project: [`examples/customer-farm`](../../examples/customer-farm). Regression suite: `npm test -- farm` (the shared mistake catalogue, the type gate under TypeScript 7.0.2 and 5.9.3, the universal tier, plus farm-specific tests).

## Setup

```ts
// farm.config.ts
import { defineConfig } from '@farmfe/core';
import { stuntDouble } from 'stunt-double/vite';

export default defineConfig({
  compilation: { input: { index: './index.html' }, output: { path: 'dist' } },
  plugins: ['@farmfe/plugin-react'],
  vitePlugins: [stuntDouble()],
});
```

That is the whole setup: `npm i -D stunt-double`, this one plugin line, and your overrides in `src/overrides/<Slot>.tsx`. No tsconfig, `.gitignore` or `package.json` edits: generated files go to `.stunt-double/` (it ignores itself). `npx stunt-double init` only offers optional extras (editor squiggles, a CI script). `farm start` with `@farmfe/plugin-react` also needs `react-refresh` installed.

For an SSR build, set `output.targetEnv: 'node'` and keep `@acme/core` bundled (`external` may list React, never the SDK); see `farm.config.ssr.ts` in the example.

## Which mistakes fail where

"Build" means `farm build` exits non-zero with the message shown. The IDs are explained in [DESIGN.md §2](../DESIGN.md#2-failure-catalogue-the-north-star).

| Mistake | `farm build` with `stuntDouble()` | universal tier: `stunt-double check && farm build` (no plugin) | Farm without the plugin and without the chain (universal tier) |
|---|---|---|---|
| F1 props don't fit the contract; F9c async client override | build (type gate at `buildStart`) | `check` | **passes** |
| F1 an SDK upgrade widened the contract of an own-props override (tested: 1.0.0 → 1.1.0) | build | `check` | build: ``Can not resolve `@acme/core-slots/Badge` `` (1.1.0 adds a slot; nothing regenerated the shims) |
| F1c `forwardRef`, `memo`, class overrides (must pass) | passes | passes | passes |
| F2a typo'd or stray override file | build | `check` | passes (file unused) |
| F2b slot renamed / new required slot in an SDK upgrade | build, with the rename hint | `check` | build: ``Can not resolve `@acme/core-slots/Price` `` |
| F3 required slot missing | build: `[F3]` next to Farm's own resolve error | `check` | build: resolve error (old shim) |
| F4 two files claim a slot | build | `check` | passes |
| F5 wrong export name | build | `check` | **passes: fails only at runtime** (Farm does not check missing exports) |
| F6a SDK imports a default directly | build | `check` | passes: the SDK default renders there (R2) |
| F6b no plugin and no universal-tier link: the registry placeholder answers the sockets | passes: the plugin is the wiring (the default setup) | build: `STUNT-DOUBLE-NOT-WIRED` | build: same |
| F6g app code imports `@acme/core/original/X` | build (import scan) | `check` | passes |
| F6g a plugin resolves a socket elsewhere | **not checked under Farm** (no audit) | not checked | n/a |
| F6h override deleted without regenerating | regenerated: the SDK default renders, correctly | regenerated | build: resolve error (old shim) |
| F6h override added without regenerating | regenerated | regenerated | passes: **the SDK default renders** (R1) |
| F7 override imports its own slot | build | `check` | passes: infinite render at runtime |
| F8 duplicate React / SDK | build (install preflight only, no bundle audit) | `check` | passes |
| F9b `server-only` in a client slot | build: `[F9]` next to Farm's resolve error | `check` | fails only because `server-only` is not installed |

`farm start` (dev): an injection error at start makes the dev server refuse to start with the `[Fx]` lines. While it runs, the plugin regenerates on every change in `src/overrides`: a mistake poisons the shims, Farm logs the `[Fx]` lines and its own resolve error, and fixing the file recovers; contract (F1) errors are logged in the terminal shortly after start, without blocking (both observed manually, not covered by the test suite).

The adapter and `check &&` columns are regression-tested by the suite; the last column was observed for every row, and the suite keeps a subset of it (the universal tier's bare build, not-wired and R1 residual cases).

## Known gaps

- Farm's persistent cache (on by default) treats the generated shims as unchanged after a regeneration, because they are reached from `node_modules`: removing an override kept the old shim (`Can not resolve …/PriceTag.tsx`) and an SDK upgrade kept the old SDK modules. The plugin therefore adds `define: { __STUNT_DOUBLE_FINGERPRINT__: … }` under Farm; `define` is one of Farm's cache keys, so the cache is invalidated exactly when an override decision or the SDK changes.

- **No post-bundle audit.** Farm's Vite-compatibility context has no `getModuleIds()`, so the plugin prints `stunt-double: post-bundle audit skipped, this host has no module-graph API` and continues. Validation (including the installed-dist scan for F6a and the install-level duplicate check for F8) and the contract type check still run.
- Farm's config proxy throws on Vite config keys it does not support (for example `environments`); the plugin tolerates that, so the SSR-environment guard of the Vite adapter does not apply under Farm.
- An SSR build that leaves `@acme/core` external is **not** detected under Farm (that check needs the module graph): keep the SDK out of `compilation.external`.
- The browser overlay in `farm start` was not verified; errors are verified in the terminal.
