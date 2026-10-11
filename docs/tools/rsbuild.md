# stunt-double with Rsbuild 2

Rsbuild has no stunt-double plugin of its own. It uses the webpack / Rspack adapter (`stunt-double/webpack`) through `tools.rspack`. Every Rsbuild environment (`web`, `node`, …) is wrapped, so the client bundle and the server bundle both get the overrides.

## Verified versions

| Package | Version |
|---|---|
| `@rsbuild/core` | 2.2.12 (bundles `@rspack/core` 2.2.8) |
| `@rsbuild/plugin-react` | 2.1.1 |
| `typescript` | 7.0.2 (also 5.9.3 through the `typescript5` alias) |
| `react` / `react-dom` | 19.3.0 |
| Node | 22.22 |

Reference app: [`examples/customer-rsbuild/`](../../examples/customer-rsbuild/). Tests: `npm test -- rsbuild` ([tests/rsbuild.test.mjs](../../tests/rsbuild.test.mjs)).

## Setup

Setup takes three steps:

1. `npm i -D stunt-double`
2. Add one line to `rsbuild.config.ts`.
3. Write your overrides in `src/overrides/<Slot>.tsx`.

```ts
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { withStuntDouble } from 'stunt-double/webpack';

export default defineConfig({
  plugins: [pluginReact()],
  tools: { rspack: (config) => withStuntDouble(config) },   // the one line
  // Optional:
  performance: { buildCache: true },          // the adapter folds its fingerprint into the Rspack cache version
  resolve: { dedupe: ['react', 'react-dom'] }, // see "Duplicate React" below
});
```

No other change is needed: no tsconfig edits, postinstall, `@acme/core-slots` dependency or `stunt-double check &&` prefix. The type gate runs inside `rsbuild build`. Generated files go to `.stunt-double/`, which has its own `.gitignore`.

At every start and every dev rebuild, the adapter validates `src/overrides` and regenerates the shims. Each `@acme/core-slots/<Slot>` is aliased to its shim in every environment. During compilation it runs the contract type check and the module-graph audit. Every mistake goes to `compilation.errors`, so `rsbuild build` exits 1 and `rsbuild dev` shows the Rsbuild error overlay.

Rsbuild options to avoid:

- Don't put the SDK in `resolve.dedupe`. Rsbuild implements dedupe as a directory alias, which bypasses the SDK's `package.json` `exports` subpaths. The build then fails with `Cannot find module '@acme/core/original/Button' for matched aliased key '@acme/core'`. Dedupe `react` and `react-dom` only.
- Don't add tsconfig `paths` for `@acme/core-slots/*`. Rsbuild's default `resolve.aliasStrategy: 'prefer-tsconfig'` hands the tsconfig to Rspack, and `paths` then win over the adapter's aliases at bundle time:
  - If the `paths` point at the generated shims, a config without the adapter renders the last generated shims instead of failing on the registry placeholder (observed with the earlier setup that had such a `paths` entry).
  - If they point anywhere else, the build fails with `[F6] @acme/core imports @acme/core-slots/X but …/X.jsx is not in the bundle`.

## Which mistake fails where

Stages: STA is the generator at compilation start, TYP the contract type gate (about 200 ms with TS 7.0.2), AUD the module-graph audit, RES Rspack's own resolution or linking.

Every mistake prints its `[Fx]` line once per environment, so with `web` + `node` you see it twice. Every row below was observed with `rsbuild build` in the test suite.

| # | Mistake | `rsbuild build` | `rsbuild dev` (Chromium, Rsbuild overlay) |
|---|---|---|---|
| F1a / F1b | Override props incompatible with the contract, or the override ignores contract props, or a 1.1.0 upgrade widens the contract | exit 1, TYP `[F1] …` | F1a: overlay about 0.4 s after save; clears on fix |
| F1c | `React.FC`, `memo`, `forwardRef`, class component, or an override that returns its children | passes and renders | |
| F2a | Typo or stray file (`Buton.tsx`, `Button.override.tsx`) | exit 1, STA `[F2]` | overlay about 0.2 s after save; clears on fix |
| F2b / F3b | SDK 2.0.0 renames PriceTag or adds a required Footer | exit 1, STA `[F2] … RENAMED to "Price"` / `[F3] … "Footer"` | |
| F3a | Required slot missing | exit 1, STA `[F3]` (+ RES) | overlay; clears on fix |
| F4 | Two files claim one slot | exit 1, STA `[F4]` | |
| F5a / F5b | Default export, or the wrong export name | exit 1, STA `[F5]` | F5a: overlay; clears on fix |
| CFG | Typo in a `stunt-double.config.json` key | exit 1, `[CFG]` | |
| F6a | SDK imports a slot default directly (`1.0.0-bad-relative`) | exit 1, STA dist scan `[F6]` | |
| F6b | A second Rsbuild config without `withStuntDouble` | exit 1, RES `Module not found: Can't resolve './STUNT-DOUBLE-NOT-WIRED -- …'` | |
| F6b (Node) | Plain Node imports the SDK | `ERR_MODULE_NOT_FOUND … STUNT-DOUBLE-NOT-WIRED` | |
| F6e | Warm `buildCache`, override removed or re-added | correct: the next build renders the new decision. The fingerprint is in `cache.version` of both environments | |
| F6g | App imports `@acme/core/original/X` outside overrides | exit 1, STA `[F6]` | |
| F6g (plugin) | A plugin in `tools.rspack` resolves a socket elsewhere | exit 1, AUD `[F6] … is not in the bundle` | |
| F6h | Override added or removed since the last generation | prevented: regenerated at every start | prevented: both environments compile the new decision in the first rebuild |
| F7a–d | Override reaches its own slot (socket, barrel, helper, namespace) | exit 1, STA `[F7]` | F7: overlay; clears on fix |
| F8 | Duplicate React (`1.0.0-nested-react`) | exit 1, STA `[F8] "react" resolves to 2 copies`, with or without `resolve.dedupe` | |
| F9b | Client-slot override imports `server-only` | exit 1, STA `[F9]` | |
| F9c | Async override in a client slot | exit 1, TYP `[F9]` | |

The type-gate rows also hold with TypeScript 5.9 (`"typescript": "typescript5"`). Without the adapter (universal tier: the package link plus `stunt-double check && rsbuild build`), the check catches F1a, F2a, F3a, F5a and F7b. Without the `check &&` prefix, a typo'd new override is silently unused (R1).

On 4 CPUs, a production build of both environments takes about 0.7 to 2 s, and the suite (59 tests) about 2 minutes.

## Known gaps

1. F8 with `resolve.dedupe` still fails the build. With `dedupe: ['react', 'react-dom']`, the bundle really does contain a single React. Verified by disabling only the install preflight in a scratch copy: the build passed and rendered the overrides in the app and in the SDK internals. Without dedupe, the AUD audit reports `[F8] "react" is bundled from 2 locations`.

   The STA preflight checks the install, not the bundle. It fails the build whenever `@acme/core` sees its own React copy, even when dedupe would make the bundle correct. This fails closed. Fix the install (dedupe your lockfile) rather than relying on `resolve.dedupe`.

2. Each decision change in `rsbuild dev` causes one extra rebuild. When you add or remove an override, or make or fix a typo, the first rebuild already compiles the new decision in every environment. The watcher then sees the regenerated shims and runs one more rebuild that changes nothing.
