# stunt-double

**Build-time component injection for React + TypeScript.** A project replaces UI components of a product SDK with its own, and every injection mistake fails the build or shows in the dev overlay. It never becomes a runtime crash, and an override never silently fails to apply.

> The SDK component is the lead actor; your override is its stunt double.
> It has to fit the costume (the SDK's props contract), or it doesn't get on set: the build fails.

## Why

Runtime DI (Swinject, a React context registry) finds a missing registration, a typo or a wrongly typed registration only when the code runs. stunt-double moves each of those mistakes to the build:

| Swinject (runtime) | stunt-double (build time) |
|---|---|
| `container.register(Button.self) {…}` | the file `src/overrides/Button.tsx` |
| `resolve()` | a static `import` |
| a wrong registration, a missing registration, or a type mismatch crashes at runtime | a non-zero exit from `vite build` / `next build` / `webpack` / `tsc`, or an overlay in the dev server, with an `[Fx]` message that names the file and the fix |

## How it works

- **The SDK side.** The SDK (here `@acme/core`) renders every overridable component through a bare *socket* import, `@acme/core-slots/Button`, and never satisfies that import itself.
- **The project side.** The project answers each socket with a generated one-line shim. The shim re-exports either your override (`src/overrides/Button.tsx`) or the SDK default (`@acme/core/original/Button`).
- **Wiring.** One static alias, added by a thin adapter in your tool's config, points the socket at the shims. The adapter also validates your overrides and runs a generated contract type check (`src/stunt-double.check.ts`) inside the build. Tools without an adapter reach the shims through a linked package and run `stunt-double check &&` first.
- **Fail-closed.** A tool nobody wired resolves the socket to a registry placeholder whose only content is an import that cannot resolve (`STUNT-DOUBLE-NOT-WIRED -- … run npx stunt-double doctor`). The build fails, instead of quietly rendering the SDK default.

The override applies everywhere: in your app's own `<Button>` and inside SDK components that render a `Button`, such as the SDK's `Dialog`. If you replace a component outright, the SDK default is not in the bundle at all.

## Quickstart (Vite)

This assumes your SDK has adopted slots: socket imports, a `slot-manifest.json`, `@acme/core/contracts`, and a published `@acme/core-slots` placeholder. See [DESIGN.md §3](docs/DESIGN.md#3-sdk-side-what-acmecore-publishes). In this repository, `examples/acme-core` is such an SDK.

1. **Install.**

   ```bash
   npm i -D stunt-double
   ```

2. **Initialise.** `init` writes the `@acme/core-slots` link dependency, the committed `sdk-slots/package.json` stub, the `.gitignore` entries, tsconfig `paths` and `files`, the `postinstall` hook, and the adapter line where it can.

   ```bash
   npx stunt-double init
   ```

3. **Check the plugin line** in `vite.config.ts`. `init` adds it, or prints it if it cannot edit your config. Vitest picks it up from the same config.

   ```ts
   import react from '@vitejs/plugin-react';
   import { stuntDouble } from 'stunt-double/vite';

   export default { plugins: [react(), stuntDouble()] };
   ```

4. **Write overrides** in `src/overrides/`, one file per slot, named after it.

   ```tsx
   // src/overrides/Button.tsx: wraps the SDK default
   import { Button as Original } from '@acme/core/original/Button';
   import type { SlotProps } from '@acme/core/contracts';

   export function Button(props: SlotProps['Button']) {
     return <span className="brand"><Original {...props} /></span>;
   }
   ```

5. **Gate CI.**

   ```bash
   npm ci && npx stunt-double check && npm run build && npm test
   ```

A mistake then looks like this, and `vite build` exits 1:

```
stunt-double: 2 injection errors (@acme/core@1.0.0)
  [F2] src/overrides/Buton.tsx overrides unknown slot "Buton" (did you mean "Button"?). @acme/core@1.0.0 slots: Button, Card, Logo. Helpers belong in _-prefixed files or inside src/overrides/<Slot>/.
  [F3] required slot "Logo" has no implementation: create src/overrides/Logo.tsx exporting `Logo` (scaffold: npx stunt-double eject Logo).
```

The full list of mistakes, and how each tool reports them, is the [failure catalogue](docs/DESIGN.md#2-failure-catalogue-the-north-star).

## Tool support

| Tool | Integration | Status |
|---|---|---|
| Vite 8 (build and dev) | `stuntDouble()` from `stunt-double/vite` | **v0.1.0** |
| Vitest 5 | the same Vite plugin | **v0.1.0** |
| Rollup 4 | the same plugin | **v0.1.0** |
| Rolldown 1 | the same plugin | **v0.1.0** |
| esbuild | `stuntDoubleEsbuild()` from `stunt-double/esbuild` | planned |
| webpack 5 | `withStuntDouble()` from `stunt-double/webpack` | planned |
| Rspack 2 / Rsbuild 2 | `withStuntDouble()` from `stunt-double/webpack` | planned |
| Next.js 16 (Turbopack and `--webpack`) | `withStuntDouble()` from `stunt-double/next` | planned |
| Jest 30 | `withStuntDouble()` from `stunt-double/jest` | planned |
| Storybook 10 (builder-vite, or webpack via `webpackFinal`) | the Vite plugin, or `withStuntDouble()` | planned |
| React Router 8 / Remix, Astro 7 | the Vite plugin | planned |
| CRA 5 (craco), Gatsby | `withStuntDouble()` from `stunt-double/webpack` | planned |
| Metro (React Native / Expo) | `withStuntDouble()` from `stunt-double/metro` | planned |
| Parcel 2 | universal tier + optional `stunt-double/parcel` resolver | planned |
| Bun 1.4 | `stuntDoubleBun()` from `stunt-double/bun`, or the universal tier | planned |
| Farm, any other bundler | universal tier: package link + `stunt-double check && <build>` | planned |

Status key:

- **v0.1.0** means the row is covered by the first milestone of the reference implementation.
- **planned** means the row is designed in [DESIGN.md §7](docs/DESIGN.md#7-per-tool-integration) but not yet implemented.

The type gate runs TypeScript 5.9 or 7, whichever the project installs. The quickstart uses npm. The link forms for pnpm, Yarn 4 PnP and Bun are designed in [DESIGN.md §4.4](docs/DESIGN.md#44-wiring-written-by-stunt-double-init).

## Repository layout

```
packages/stunt-double/                  the npm package: core, adapters (stunt-double/vite, …) and the CLI
examples/acme-core/                     fixture product SDK, @acme/core: renders its components through sockets
examples/acme-core-slots-placeholder/   the registry placeholder, @acme/core-slots (fails on purpose when not wired)
examples/customer-vite/                 a customer app on Vite + Vitest with overrides in src/overrides/
tests/                                  the test suite
docs/                                   design document and decision record
```

## Running the tests

From the repository root:

```bash
npm run setup && npm test
```

To run one part, use `npm run test:core` for the core unit tests or `npm run test:vite` for the Vite suite.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) is the full design: the failure catalogue, the SDK and project sides, resolution, type safety, per-tool integration, SSR/RSC, rollout, alternatives considered and known limitations.
- [docs/DECISIONS.md](docs/DECISIONS.md) is the decision record: the designs that competed, why this one won, what was grafted or rejected, and the open questions.

## License

MIT. Copyright (c) 2026 Kevin Hamby. See [LICENSE](LICENSE).
