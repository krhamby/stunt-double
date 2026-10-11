# stunt-double with Rsbuild 2

Rsbuild has no stunt-double plugin of its own. It uses the webpack / Rspack adapter (`stunt-double/webpack`) through `tools.rspack`. Every Rsbuild environment (`web`, `node`, …) is wrapped, so the client bundle and the server bundle both get the overrides.

## Verified versions

| Package | Version |
|---|---|
| `@rsbuild/core` | 2.2.12 (bundles `@rspack/core` 2.2.8) |
| `@rsbuild/plugin-react` | 2.1.1 |
| `typescript` | 7.0.2 (the type gate) |
| `react` / `react-dom` | 19.3.0 |
| Node | 22.22 |

Reference app: [`examples/customer-rsbuild/`](../../examples/customer-rsbuild/).

## Setup

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { withStuntDouble } from 'stunt-double/webpack';

export default defineConfig({
  plugins: [pluginReact()],
  tools: { rspack: (config) => withStuntDouble(config) },
  // Optional. The adapter folds its fingerprint into the Rspack cache version.
  performance: { buildCache: true },
  // Optional. Fixes a duplicate React in the bundle, but see F8 below.
  resolve: { dedupe: ['react', 'react-dom'] },
});
```

Use the same `package.json` wiring and `tsconfig.json` as every other tool:

- `"@acme/core-slots": "file:./sdk-slots"`
- `"postinstall": "stunt-double gen --no-fail"`
- tsconfig `paths` for `@acme/core-slots/*`
- tsconfig `files: ["src/stunt-double.check.ts"]`

Run `rsbuild build` and `rsbuild dev` as usual. You don't need a `stunt-double check &&` prefix: the type gate runs inside the build.

What it does:

- **Every start and every dev rebuild:** validates `src/overrides` and regenerates the shims.
- **Aliases:** each `@acme/core-slots/<Slot>` points to its shim.
- **During compilation:** runs the contract type check and the module-graph audit.
- **Error reporting:** every mistake goes to `compilation.errors`. `rsbuild build` exits 1, and `rsbuild dev` shows the Rsbuild error overlay.

Two things to know:

- **Don't put the SDK in `resolve.dedupe`.** Rsbuild implements dedupe as a directory alias, which bypasses the SDK's `package.json` `exports` subpaths. The build then fails with `Cannot find module '@acme/core/original/Button' for matched aliased key '@acme/core'`. Dedupe `react` and `react-dom` only.
- **tsconfig `paths` win over the adapter's aliases.** Rsbuild's default `resolve.aliasStrategy: 'prefer-tsconfig'` hands the tsconfig to Rspack, so `@acme/core-slots/*` resolves through `paths`. With the standard `paths` entry that is the same shim file, so it is harmless. If you point `paths` somewhere else, the build fails with `[F6] @acme/core imports @acme/core-slots/X but sdk-slots/gen/X.jsx is not in the bundle`.

## Which mistake fails where

Stages: **STA** is the generator at compilation start. **TYP** is the contract type gate, about 200 ms with TS 7.0.2. **AUD** is the module-graph audit. **RES** is Rspack's own resolution or linking.

Every mistake prints its `[Fx]` line once per environment, so with `web` + `node` you see it twice.

| # | Mistake | `rsbuild build` | `rsbuild dev` |
|---|---|---|---|
| F1a | Override props incompatible with the contract | exit 1, TYP `[F1] … TS2322` | overlay about 0.4 s after save; clears on fix |
| F1b | Override ignores contract props | exit 1, TYP `[F1] override ignores these SDK props` | overlay (same path as F1a) |
| F2a | Typo or stray file (`Buton.tsx`, `Button.override.tsx`) | exit 1, STA `[F2]` | overlay about 0.2 s after save; clears on fix |
| F2b | Slot renamed or removed by an SDK upgrade (2.0.0) | exit 1, STA `[F2] … RENAMED to "Price"` + `[F3] Footer`, plus RES `Cannot find module '@acme/core-slots/Price'` | overlay (STA) |
| F3 | Required slot missing | exit 1, STA `[F3]` + RES | overlay; clears on fix |
| F4 | Two files claim one slot | exit 1, STA `[F4]` | overlay (STA) |
| F5 | Wrong export | exit 1, STA `[F5]` + RES `ESModulesLinkingError` | overlay (STA) |
| F6a | SDK imports a slot default directly (`1.0.0-bad-relative`) | exit 1, STA dist scan `[F6]` | overlay (STA) |
| F6b | Tool never wired (no `withStuntDouble`) | **exit 0, renders the last generated shims** (gap 1). Only `stunt-double check` fails: `[F6] … the registry placeholder` | same as build |
| F6b′ | Registry placeholder installed instead of the link, adapter present | exit 1, STA wiring `[F6] … the registry placeholder` | overlay (STA) |
| F6e | Warm persistent cache, override added or removed | correct: the decision changes on the next build (fingerprint in `cache.version`) | n/a |
| F6g | App imports `@acme/core/original/X` outside overrides | exit 1, STA `[F6]` | overlay (STA) |
| F6h | Override added or removed without `stunt-double gen` | prevented: regenerated at every start | prevented: picked up in the first rebuild in both environments, then one extra no-op rebuild |
| F7 | Override imports its own slot (directly or transitively) | exit 1, STA `[F7]` | overlay (STA) |
| F8 | Duplicate React (`1.0.0-nested-react`) | exit 1, STA `[F8] "react" resolves to 2 copies`, **with or without** `resolve.dedupe` | overlay (STA) |
| F9c | Async override in a client slot | exit 1, TYP `[F9]` | overlay (TYP) |

Tests: `node --test tests/rsbuild.test.mjs` runs the shared webpack-family cases plus the Rsbuild-specific ones.

Measured on a 4-CPU container: a production build of both environments takes about 0.9 to 1.4 s of wall time.

The dev results above were observed in real Chromium against the Rsbuild error overlay. The ones marked "(STA)", "(TYP)" or "same path as F1a" were not run separately in dev: they go through the same reporting path.

## Known gaps

1. **An unwired Rsbuild config does not hit the placeholder poison.**

   Suppose a second `rsbuild.config.ts`, or a Storybook Rsbuild builder, lacks `withStuntDouble`. Rsbuild still resolves `@acme/core-slots/*` through the tsconfig `paths` entry (`aliasStrategy: 'prefer-tsconfig'` is the default). It renders whatever shims are currently in `sdk-slots/gen/`. Even with the registry placeholder installed in place of the link, `rsbuild build` exits 0 and renders the last generated decision.

   This is the "T0 bare" behaviour (DESIGN §2.2): the decision may be stale, and new mistakes in `src/overrides` go unreported. It is loud only in two cases:
   - `sdk-slots/gen/` does not exist. Rspack then prints the placeholder's `Module not found: Can't resolve './STUNT-DOUBLE-NOT-WIRED -- …'`.
   - A stale shim points at an override that was deleted. Rspack then prints `Module not found: Can't resolve '../../src/overrides/X.tsx'`.

   With `resolve.aliasStrategy: 'prefer-alias'` the poison does fire. That setting disables tsconfig `paths` in the bundler for every alias, though, and it would have to be set in the unwired config itself. Mitigation: wire every Rsbuild config, or chain `stunt-double check &&` in front of any script that runs one. The check runs the wiring self-test, exits 1 and prints `[F6] @acme/core resolves @acme/core-slots to node_modules/@acme/core-slots (the registry placeholder …)`.

2. **F8 with `resolve.dedupe` still fails the build.**

   With `dedupe: ['react', 'react-dom']`, the bundle really does contain a single React. Verified by disabling only the install preflight: the build passes and renders overrides in the app and in the SDK internals. Without dedupe, the AUD audit reports `[F8] "react" is bundled from 2 locations`.

   The STA preflight checks the install, not the bundle. It fails the build whenever `@acme/core` sees its own React copy, even when dedupe would make the bundle correct. This fails closed. Fix the install (dedupe your lockfile) rather than relying on `resolve.dedupe`.

3. **One extra dev rebuild per decision change.** When you add or remove an override, or make or fix a typo, the first rebuild already compiles the new decision in every environment. The watcher then sees the regenerated shims and runs one more rebuild that changes nothing.
