# Farm

Farm runs the Vite plugin, `stuntDouble()` from `stunt-double/vite`, through its Vite-plugin compatibility layer (`vitePlugins`). Validation and the contract type check fail `farm build`; the post-bundle audit does not run under Farm.

Verified with @farmfe/core 1.7.11, @farmfe/cli 1.0.5, @farmfe/plugin-react 1.2.6, react-refresh 0.19.0, TypeScript 7.0.2, React 19.3.0 and Node 22.22.0. Reference project: [`examples/customer-farm`](../../examples/customer-farm).

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

Plus the usual project wiring from `npx stunt-double init`: the `@acme/core-slots` link in `package.json`, `paths` and `files` in `tsconfig.json`, and `"postinstall": "stunt-double gen --no-fail"`. `farm start` with `@farmfe/plugin-react` also needs `react-refresh` installed.

For an SSR build, set `output.targetEnv: 'node'` and keep `@acme/core` bundled (`external` may list React, never the SDK); see `farm.config.ssr.ts` in the example.

## Which mistakes fail where

"Build" means `farm build` exits non-zero with the message shown. The IDs are explained in [DESIGN.md §2](../DESIGN.md#2-failure-catalogue-the-north-star).

| Mistake | `farm build` with `stuntDouble()` | `farm start` (dev) |
|---|---|---|
| F1 props don't fit the contract; F9c async client override | build (type gate at `buildStart`) | logged in the terminal shortly after start (non-blocking) |
| F2, F2b, F4, F5, F6a, F6g (import scan), F7, F8 (install preflight) | build (`buildStart`) | refuses to start; while running, the shims are poisoned and Farm logs the `[Fx]` lines plus its own resolve error; fixing the file recovers |
| F3 required slot missing; F9b `server-only` in a client slot | build: the `[F3]` / `[F9]` line, next to Farm's own resolve error for the same file | same as above |
| F6b tool not wired at all | n/a (the placeholder fails resolution without the plugin) | |
| F6g a plugin resolves a socket elsewhere; F8 duplicate copies in the bundle | **not checked under Farm** (no audit, see below) | |

## Known gaps

- **No post-bundle audit.** Farm's Vite-compatibility context has no `getModuleIds()`, so the plugin prints `stunt-double: post-bundle audit skipped, this host has no module-graph API` and continues. Validation (including the installed-dist scan for F6a and the install-level duplicate check for F8) and the contract type check still run.
- Farm's config proxy throws on Vite config keys it does not support (for example `environments`); the plugin tolerates that, so the SSR-environment guard of the Vite adapter does not apply under Farm.
- The browser overlay in `farm start` was not verified; errors are verified in the terminal.
