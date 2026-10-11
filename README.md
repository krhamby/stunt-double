# stunt-double

**Build-time dependency injection for React + TypeScript.** A project replaces parts of a product SDK with its own: UI components, and also services, functions and objects (an analytics client, an API client, a formatter). Every injection mistake fails the build or shows in the dev overlay. It never becomes a runtime crash, and an override never silently fails to apply.

> The SDK component is the lead actor; your override is its stunt double.
> It has to fit the costume (the SDK's props contract), or it doesn't get on set: the build fails.

## Why

Runtime DI (Swinject, a React context registry) finds a missing registration, a typo or a wrongly typed registration only when the code runs. stunt-double moves each of those mistakes to the build:

| Swinject (runtime) | stunt-double (build time) |
|---|---|
| `container.register(Button.self) {…}` | the file `src/overrides/Button.tsx` |
| `container.register(Analytics.self) {…}` (any type, not only views) | the file `src/overrides/analytics.ts` (a [value slot](#value-slots-inject-anything-not-only-components)) |
| the protocol a registration must conform to | the SDK's contract: `SlotProps['Button']` for a component, `SlotTypes['analytics']` for a value |
| `resolve()` | a static `import` |
| a wrong registration, a missing registration, or a type mismatch crashes at runtime | a non-zero exit from `vite build` / `next build` / `webpack` / `esbuild` / `jest` / `stunt-double check`, or an overlay in the dev server, with an `[Fx]` message that names the file and the fix |

## How it works

- **The SDK side.** The SDK (here `@acme/core`) renders every overridable component through a bare *socket* import, `@acme/core-slots/Button`, and never satisfies that import itself.
- **The project side.** The project answers each socket with a generated one-line shim. The shim re-exports either your override (`src/overrides/Button.tsx`) or the SDK default (`@acme/core/original/Button`).
- **Wiring.** One static alias, added by a thin adapter in your tool's config, points the socket at the shims. The adapter also validates your overrides and runs a generated contract type check inside the build. Everything generated lives in one self-ignoring directory, `.stunt-double/`. Tools without an adapter reach the shims through a linked package and run `stunt-double check &&` first.
- **Fail-closed.** A tool nobody wired resolves the socket to a registry placeholder whose only content is an import that cannot resolve (`STUNT-DOUBLE-NOT-WIRED -- … run npx stunt-double doctor`). The build fails, instead of quietly rendering the SDK default.

The override applies everywhere: in your app's own `<Button>` and inside SDK components that render a `Button`, such as the SDK's `Dialog`. If you replace a component outright, the SDK default is not in the bundle at all.

## Quickstart

This assumes your SDK has adopted slots: socket imports, a `slot-manifest.json`, `@acme/core/contracts`, and a published `@acme/core-slots` placeholder. See [docs/sdk-authors.md](docs/sdk-authors.md). In this repository, `examples/acme-core` is such an SDK.

1. **Install.**

   ```bash
   npm i -D stunt-double
   ```

2. **Add the adapter** to your tool's config: one line. Nothing else is edited: no tsconfig, no `.gitignore`, no extra dependency.

   ```ts
   // vite.config.ts (Vitest picks it up from the same file)
   import react from '@vitejs/plugin-react';
   import { stuntDouble } from 'stunt-double/vite';

   export default { plugins: [react(), stuntDouble()] };
   ```

   Other tools: `withStuntDouble(config)` from `stunt-double/next`, `stunt-double/webpack` (also Rspack) or `stunt-double/jest`, and `stuntDoubleEsbuild()` from `stunt-double/esbuild`. See [Tool support](#tool-support).

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

**CI:** `npm ci && npx stunt-double check && npm run build && npm test`. **Optional extras** (`npx stunt-double init` lists them): `--editor` (contract errors as IDE squiggles), `--ci`, and `--universal` (a package link for tools without an adapter).

A mistake then looks like this, and `vite build` exits 1:

```
stunt-double: 2 injection errors (@acme/core@1.0.0)
  [F2] src/overrides/Buton.tsx overrides unknown slot "Buton" (did you mean "Button"?). @acme/core@1.0.0 slots: Button, Card, Logo. Helpers belong in _-prefixed files or inside src/overrides/<Slot>/.
  [F3] required slot "Logo" has no implementation: create src/overrides/Logo.tsx exporting `Logo` (scaffold: npx stunt-double eject Logo).
```

Every code is explained in the [error reference](docs/errors.md). How each tool reports each mistake is the [failure catalogue](docs/DESIGN.md#2-failure-catalogue-the-north-star).

## Value slots: inject anything, not only components

A slot does not have to be a component. An SDK can declare a **value slot** (`"kind": "value"` in its manifest) for anything it wants a project to be able to replace: an analytics service, an API client, a formatter, a hook, a class, a config object. The SDK calls it through the same kind of socket import, and the project answers it the same way: one file in `src/overrides/`, named after the slot.

```ts
// @acme/core contracts: a value slot's contract is its whole type, in SlotTypes (components keep SlotProps)
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
// src/overrides/analytics.ts: every event the SDK reports lands here
import type { Analytics } from '@acme/core';

class BrandAnalytics implements Analytics {
  readonly id = 'brand';
  track(event: string, data?: Record<string, unknown>) { segment.track(event, data); }
}
export const analytics = new BrandAnalytics();

// src/overrides/formatPrice.ts: a plain function works the same way
import type { SlotTypes } from '@acme/core/contracts';
export const formatPrice: SlotTypes['formatPrice'] = (amount, currency = 'USD') => `${currency} ${amount.toFixed(2)}`;
```

The same mistakes fail the build: a typo'd file name ([F2]), a missing required value ([F3]), a wrong export ([F5]), an override that imports itself through `@acme/core` ([F7], which is a circular import here rather than an infinite render). The contract check is stricter than plain TypeScript assignability. TypeScript lets an implementation **narrow a parameter** when `strict` is off, and lets a **method** narrow its parameters even when `strict` is on. stunt-double compares the argument lists itself, so this fails:

```
stunt-double: 1 injection error (@acme/core@1.0.0)
  [F1] analytics (src/overrides/analytics.ts): narrows the parameters of these members: "track" (the SDK may pass any value its contract allows: accept the contract's parameter types) (tsc 7.0.2, 123 ms)
```

Fewer parameters, optional extras, rest parameters, generics, class instances and constructors all pass. What a build-time container cannot do is choose an implementation **at runtime** (per user, per feature flag). For that, inject a factory or a strategy object that decides at runtime. Details are in [DESIGN.md §6.6](docs/DESIGN.md#66-value-slots).

## Tool support

| Tool | Integration | Status |
|---|---|---|
| Vite 8 (build and dev), Vitest 5 | `stuntDouble()` from `stunt-double/vite` | **verified** ([page](docs/tools/vite.md)) |
| Rollup 4, Rolldown 1 | the same plugin | **v0.1.0** |
| esbuild 0.28 (JS API) | `stuntDoubleEsbuild()` from `stunt-double/esbuild` | **verified** ([page](docs/tools/esbuild.md)) |
| webpack 5 | `withStuntDouble()` from `stunt-double/webpack` | **verified** ([page](docs/tools/webpack.md)) |
| Rspack 2 | `withStuntDouble()` from `stunt-double/webpack` | **verified** ([page](docs/tools/webpack.md)) |
| Next.js 16 (Turbopack and `--webpack`; build and dev) | `withStuntDouble()` from `stunt-double/next` | **verified** ([page](docs/tools/next.md)) |
| Jest 30 | `withStuntDouble()` from `stunt-double/jest` | **verified** ([page](docs/tools/jest.md)) |
| Rsbuild 2 | `withStuntDouble()` from `stunt-double/webpack` in `tools.rspack` | **verified** ([page](docs/tools/webpack.md)) |
| CRA 5 (craco), Gatsby | `withStuntDouble()` from `stunt-double/webpack` through their webpack hook | designed |
| Storybook 10 (builder-vite) | the Vite plugin, from `vite.config.ts` | **verified** ([page](docs/tools/storybook.md)) |
| Storybook 10 (webpack builder, `webpackFinal`) | `withStuntDouble()` from `stunt-double/webpack` | designed |
| React Router 8 (framework mode) | the Vite plugin | **verified** ([page](docs/tools/react-router.md)) |
| Remix, Astro 7 | the Vite plugin | designed |
| Metro (React Native / Expo) | `withStuntDouble()` from `stunt-double/metro` | planned |
| Parcel 2 | universal tier + optional `stunt-double/parcel` resolver | planned |
| Bun 1.4 (bundler, `Bun.build()`) | `stuntDoubleBun()` from `stunt-double/bun` | **verified** ([page](docs/tools/bun.md)) |
| Bun 1.4 (runtime, dev server) | universal tier | designed |
| Farm, any other bundler | universal tier: package link + `stunt-double check && <build>` | works today |

Status key:

- **verified** means a toolchain suite in `tests/` runs the whole shared mistake catalogue against a real app built with that tool (production build, SSR render, TypeScript 7 and 5.9, and the universal tier).
- **v0.1.0** means the adapter exists and shares the Vite plugin's code, without a suite of its own.
- **designed** means the tool uses an existing adapter through its own config hook, as in [DESIGN.md §7](docs/DESIGN.md#7-per-tool-integration), not yet run in a suite.
- **planned** means the adapter is designed but not written; importing it fails loudly, never silently.

The type gate runs TypeScript 5.9 or 7, whichever the project installs. **Package managers:** npm (every suite), pnpm 10 and Yarn 4 Plug'n'Play are verified, each including its universal-tier link form; see [docs/package-managers.md](docs/package-managers.md).

## Repository layout

```
packages/stunt-double/                  the npm package: core, adapters (stunt-double/vite, …) and the CLI
examples/acme-core/                     fixture product SDK, @acme/core: renders its components through sockets
examples/acme-core-slots-placeholder/   the registry placeholder, @acme/core-slots (fails on purpose when not wired)
examples/customer-<tool>/               customer apps with the same overrides in src/overrides/: vite (+ Vitest),
                                        esbuild, bun, webpack (+ Jest), rspack, rsbuild, next, react-router,
                                        storybook
tests/                                  the core unit tests run from packages/; one toolchain suite per tool;
                                        the shared mistake catalogue in tests/mutations/
docs/                                   design, decision record, error reference, SDK-author guide, tool pages
```

## Running the tests

From the repository root:

```bash
npm run setup && npm test
```

To run one part, name it: `npm test -- core` for the core unit tests, `npm test -- vite`, `npm test -- next next-webpack`, and so on (`npm test -- --list` shows them). [tests/README.md](tests/README.md) explains the harness and how to add a toolchain.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) is the full design: the failure catalogue, the SDK and project sides, resolution, type safety, per-tool integration, SSR/RSC, rollout, alternatives considered and known limitations.
- [docs/DECISIONS.md](docs/DECISIONS.md) is the decision record: the designs that competed, why this one won, what was grafted or rejected, and the open questions.
- [docs/errors.md](docs/errors.md) explains every `[Fx]` code; each report links to its section.
- [docs/sdk-authors.md](docs/sdk-authors.md) is for the team that publishes the SDK: what to change once, and the `sdk-lint` publish gate.
- [docs/tools/](docs/tools) has one page per tool, [docs/package-managers.md](docs/package-managers.md) covers npm, pnpm and Yarn PnP, and [docs/limitations.md](docs/limitations.md) lists what can still reach runtime.

## License

MIT. Copyright (c) 2026 Kevin Hamby. See [LICENSE](LICENSE).
