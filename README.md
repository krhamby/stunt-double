# stunt-double

Build-time dependency injection for React + TypeScript. A project replaces parts of a product SDK with its own implementations: components, and also services, functions and objects such as an analytics client, an API client or a formatter. Injection mistakes fail the build (or show in the dev server's error overlay) instead of failing at runtime, and an override can't silently fail to apply.

## Why

Runtime DI in TypeScript (InversifyJS, tsyringe, or a React context that hands components down) reports a missing registration, a typo or a wrongly typed implementation only when the code runs. stunt-double moves those checks to the build:

| Runtime DI | stunt-double |
|---|---|
| `container.register('Analytics', { useClass: BrandAnalytics })`, or `<SlotsProvider components={{ Button: BrandButton }}>` | a file in `src/overrides/`: `analytics.ts`, `Button.tsx` |
| the interface or token a registration is typed against | the SDK's contract: `SlotProps['Button']` for a component, `SlotTypes['analytics']` for anything else |
| `container.resolve()` / `useContext()` | a static `import` |
| a missing or wrong registration fails at runtime | `next build`, `vite build`, `webpack`, `jest` or `stunt-double check` exits non-zero with an `[Fx]` message naming the file and the fix |

## How it works

- **SDK side.** The SDK (here `@acme/core`) imports each overridable piece through a *socket*, e.g. `@acme/core-slots/Button`, and never resolves that import itself.
- **Project side.** stunt-double generates a one-line shim per socket that re-exports either your override (`src/overrides/Button.tsx`) or the SDK default (`@acme/core/original/Button`).
- **Wiring.** An adapter in your tool's config aliases the sockets to the shims, validates the overrides, and runs a generated contract type check as part of the build. Generated files live in `.stunt-double/`, which ignores itself in git. Tools without an adapter use a linked package and run `stunt-double check &&` first.
- **Fail-closed.** If a tool isn't wired, the socket resolves to a placeholder package that can't be imported (`STUNT-DOUBLE-NOT-WIRED -- … run npx stunt-double doctor`), so the build fails rather than quietly using the SDK default.

An override applies everywhere the SDK uses that slot, including inside the SDK's own components. If you replace a default outright, it is not in the bundle.

## Quickstart (Next.js)

This assumes your SDK has adopted slots: socket imports, a `slot-manifest.json`, `@acme/core/contracts`, and a published `@acme/core-slots` placeholder. See [docs/sdk-authors.md](docs/sdk-authors.md). In this repository, `examples/acme-core` is such an SDK.

1. **Install.**

   ```bash
   npm i -D stunt-double
   ```

2. **Wrap your Next config.** No tsconfig, `.gitignore` or other changes are needed.

   ```js
   // next.config.mjs
   import { withStuntDouble } from 'stunt-double/next';

   export default withStuntDouble({ /* your Next config */ });
   ```

   This works with Turbopack (the default) and `next build --webpack`. `next build` checks your overrides and their types before compiling. In `next dev`, adding, removing or fixing an override takes effect without a restart. Details: [docs/tools/next.md](docs/tools/next.md).

3. **Write overrides** in `src/overrides/`, one file per slot, named after it.

   ```tsx
   // src/overrides/Button.tsx: wraps the SDK default
   import { Button as Original } from '@acme/core/original/Button';
   import type { SlotProps } from '@acme/core/contracts';

   export function Button(props: SlotProps['Button']) {
     return <span className="brand"><Original {...props} /></span>;
   }
   ```

   `npx stunt-double eject Button` writes a typed starter; `npx stunt-double ls` lists the slots.

A mistake looks like this, and `next build` exits 1:

```
stunt-double: 2 injection errors (@acme/core@1.0.0)
  [F2] src/overrides/Buton.tsx overrides unknown slot "Buton" (did you mean "Button"?). @acme/core@1.0.0 slots: Button, Card, Logo. Helpers belong in _-prefixed files or inside src/overrides/<Slot>/.
  [F3] required slot "Logo" has no implementation: create src/overrides/Logo.tsx exporting `Logo` (scaffold: npx stunt-double eject Logo).
```

Every code is explained in the [error reference](docs/errors.md).

**Other tools** use the same overrides with a different adapter: `stuntDouble()` from `stunt-double/vite` (Vite, Vitest, React Router, Storybook), `withStuntDouble()` from `stunt-double/webpack` (webpack, Rspack, Rsbuild) or `stunt-double/jest`, `stuntDoubleEsbuild()`, `stuntDoubleBun()`, and a Parcel resolver. See [Tool support](#tool-support).

**CI:** `npm ci && npx stunt-double check && npm run build && npm test`. `npx stunt-double init` lists optional extras: `--editor` (contract errors in the IDE), `--ci`, and `--universal` (for tools without an adapter).

## Value slots: injecting more than components

An SDK can declare a slot with `"kind": "value"` for anything it wants projects to replace: a service, an API client, a formatter, a hook, a class, a config object. The project overrides it the same way, with one file in `src/overrides/`.

```ts
// @acme/core contracts: a value slot's contract is its whole type, in SlotTypes
export interface Analytics { readonly id: string; track(event: string, data?: Record<string, unknown>): void }
export interface SlotTypes {
  formatPrice: (amount: number, currency?: string) => string;
  analytics: Analytics;
}

// @acme/core ProductCard: calls the socket, never its own default
import { analytics } from '@acme/core-slots/analytics';
analytics.track('add_to_cart', { product: product.id });
```

```ts
// src/overrides/analytics.ts
import type { Analytics } from '@acme/core';

class BrandAnalytics implements Analytics {
  readonly id = 'brand';
  track(event: string, data?: Record<string, unknown>) { segment.track(event, data); }
}
export const analytics = new BrandAnalytics();

// src/overrides/formatPrice.ts
import type { SlotTypes } from '@acme/core/contracts';
export const formatPrice: SlotTypes['formatPrice'] = (amount, currency = 'USD') => `${currency} ${amount.toFixed(2)}`;
```

The same mistakes fail the build: a misspelled file name ([F2]), a missing required value ([F3]), a wrong export ([F5]), or an override that imports itself through `@acme/core` ([F7]). The contract check is stricter than TypeScript's assignability in one respect: TypeScript lets an implementation narrow a parameter when `strict` is off, and lets a method narrow its parameters even when `strict` is on. stunt-double compares parameter lists directly, so this fails:

```
stunt-double: 1 injection error (@acme/core@1.0.0)
  [F1] analytics (src/overrides/analytics.ts): narrows the parameters of these members: "track" (the SDK may pass any value its contract allows: accept the contract's parameter types) (tsc 7.0.2, 123 ms)
```

Fewer parameters, optional extras, rest parameters, generics, class instances and constructors all pass. Choosing an implementation at runtime (per user, per feature flag) is out of scope for a build-time tool; inject a factory or strategy object for that. Details: [DESIGN.md §6.6](docs/DESIGN.md#66-value-slots).

## Tool support

| Tool | Integration | Status |
|---|---|---|
| Next.js 16 (Turbopack and `--webpack`; build and dev) | `withStuntDouble()` from `stunt-double/next` | **verified** ([page](docs/tools/next.md)) |
| Vite 8 (build and dev), Vitest 5 | `stuntDouble()` from `stunt-double/vite` | **verified** ([page](docs/tools/vite.md)) |
| React Router 8 (framework mode) | the Vite plugin | **verified** ([page](docs/tools/react-router.md)) |
| Storybook 10 (builder-vite) | the Vite plugin, from `vite.config.ts` | **verified** ([page](docs/tools/storybook.md)) |
| webpack 5 | `withStuntDouble()` from `stunt-double/webpack` | **verified** ([page](docs/tools/webpack.md)) |
| Rspack 2 | `withStuntDouble()` from `stunt-double/webpack` | **verified** ([page](docs/tools/webpack.md)) |
| Rsbuild 2 | `withStuntDouble()` from `stunt-double/webpack` in `tools.rspack` | **verified** ([page](docs/tools/webpack.md)) |
| Jest 30 | `withStuntDouble()` from `stunt-double/jest` | **verified** ([page](docs/tools/jest.md)) |
| esbuild 0.28 (JS API) | `stuntDoubleEsbuild()` from `stunt-double/esbuild` | **verified** ([page](docs/tools/esbuild.md)) |
| Bun 1.4 (bundler, `Bun.build()`) | `stuntDoubleBun()` from `stunt-double/bun` | **verified** ([page](docs/tools/bun.md)) |
| Parcel 2 | the `stunt-double/parcel` resolver, from a one-line local file | **verified** ([page](docs/tools/parcel.md)) |
| Rollup 4, Rolldown 1 | the Vite plugin | **v0.1.0** |
| CRA 5 (craco), Gatsby, Storybook (webpack builder) | `withStuntDouble()` from `stunt-double/webpack` through their webpack hook | designed |
| Remix, Astro 7 | the Vite plugin | designed |
| Bun 1.4 (runtime, dev server) | universal tier | designed |
| Metro (React Native / Expo) | `withStuntDouble()` from `stunt-double/metro` | planned |
| Farm, any other bundler | universal tier: package link + `stunt-double check && <build>` | works today |

Status key:

- **verified**: a suite in `tests/` builds a real app with the tool, renders the result (SSR, a prerendered page, or Chromium), and runs every mistake whose outcome depends on the tool (resolution, config guards, the post-bundle audit, regeneration, one smoke test per stage) plus the universal tier. The Vite suite runs the full mistake catalogue under TypeScript 7 and 5.9.
- **v0.1.0**: the adapter exists and shares the Vite plugin's code, with no suite of its own.
- **designed**: the tool can use an existing adapter through its config hook ([DESIGN.md §7](docs/DESIGN.md#7-per-tool-integration)), but no suite runs it yet.
- **planned**: designed, not written; importing it fails with an error.

The type check uses whichever TypeScript the project installs (5.9 or 7). npm, pnpm 10 and Yarn 4 Plug'n'Play are verified, including their universal-tier link forms; see [docs/package-managers.md](docs/package-managers.md).

## Repository layout

```
packages/stunt-double/                  the npm package: core, adapters (stunt-double/next, …) and the CLI
examples/acme-core/                     example product SDK, @acme/core: imports its components through sockets
examples/acme-core-slots-placeholder/   the registry placeholder, @acme/core-slots (fails on purpose when not wired)
examples/customer-<tool>/               example apps with the same overrides in src/overrides/: next, vite (+ Vitest),
                                        webpack (+ Jest), rspack, rsbuild, esbuild, bun, parcel, react-router,
                                        storybook, yarn-pnp
tests/                                  one toolchain suite per tool; the shared mistake catalogue in tests/mutations/
docs/                                   design, decision record, error reference, SDK-author guide, tool pages
```

## Running the tests

```bash
npm run setup && npm test
```

Run one part by name: `npm test -- core` (unit tests), `npm test -- next next-webpack`, `npm test -- --list`. [tests/README.md](tests/README.md) explains the harness and how to add a tool.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): the full design (failure catalogue, SDK and project sides, resolution, type checking, per-tool integration, SSR/RSC, alternatives, limitations).
- [docs/DECISIONS.md](docs/DECISIONS.md): the decision record and open questions.
- [docs/errors.md](docs/errors.md): every `[Fx]` code; each report links to its section.
- [docs/sdk-authors.md](docs/sdk-authors.md): for the team publishing the SDK, including the `sdk-lint` publish gate.
- [docs/tools/](docs/tools): one page per tool. [docs/package-managers.md](docs/package-managers.md) covers npm, pnpm and Yarn PnP; [docs/limitations.md](docs/limitations.md) lists what can still reach runtime.

## License

MIT. Copyright (c) 2026 Kevin Hamby. See [LICENSE](LICENSE).
