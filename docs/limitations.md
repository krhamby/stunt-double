# Known limitations

stunt-double's promise: an injection mistake fails the build, the test run or `stunt-double check`, or shows in the dev overlay. It never becomes a runtime crash, and an override never silently fails to apply. This page lists where that promise has edges, and what contains each one. The design-level discussion is [DESIGN.md §14](DESIGN.md#14-known-limitations).

Two things are **never** possible in any setup: every override disappearing at once, and a tool nobody wired silently rendering SDK defaults. Both are resolve errors (the registry placeholder).

## Residuals: where a mistake can still reach runtime

| | Limitation | Contained by |
|---|---|---|
| R1 | **A tool with no adapter, run without `stunt-double check &&`** (the universal tier's "bare" mode). Nothing validates, so a typo'd new override is silently unused and a stale shim renders the previous decision. | Use an adapter wherever one exists (Vite family, esbuild, webpack family, Next, Jest): the gate lives in the tool's config, so a bare command cannot skip it. Otherwise chain `stunt-double check &&`; `stunt-double doctor` flags scripts that do not. CI runs `stunt-double check`. |
| R2 | A third-party SDK that imports a default relatively, consumed through a bare universal-tier tool. | The SDK's `sdk-lint` publish gate; every adapter and `stunt-double check` scans the installed SDK. |
| R3 | Dev servers and test runners do not block on contract mismatches (F1): `next dev`, Vitest, Jest, webpack/Rspack watch. The Vite overlay is asynchronous. | Production builds and CI fail. Jest can opt in with `withStuntDouble(config, { typecheck: true })`. |
| R4 | F7 through a third-party package, or through a computed `import(expr)`. | Add the package to `scanPackages`. |
| R5 | Parcel 2.16, node targets: the SDK's own `"use client"` modules land in a separate chunk with a second copy of React, which crashes at render (`useContext` of null). Seen with React external and with stunt-double's shims carrying no directives. | Browser targets are unaffected (verified). For Parcel SSR, use an SDK build without directives, or another bundler for the server. |
| R6 | An override that is type-correct but behaves wrongly, or an explicit `ignoresProps` opt-out. | Semantics are not checkable. Opt-outs live in `stunt-double.config.json`; put it under CODEOWNERS. |
| R7 | Vite dev, universal tier, cold cache: the first load re-optimizes once. | The adapter pre-bundles every original: zero reloads. |

## Type-check gaps

- `notAsync` cannot flag an async body hidden behind a `React.FC` annotation (`FC`'s return type already admits a promise).
- Value slots: `argsFit` compares the parameters of the value and of its **top-level** members. A nested object's methods (`client.users.get(id)`) get plain TypeScript assignability. For an overloaded function, only the last overload is compared.
- An implementation may omit an *optional* member of a value contract, as TypeScript allows.

## Not supported

- **A single-file bundled SDK.** Injection works at module level, so the SDK must publish one file per module (`tsc` emit, or a bundler with `preserveModules`).
- **Choosing an implementation at runtime** (per user, per feature flag, per test). That is a runtime decision by definition: inject a factory or strategy object that decides at runtime.
- **ts-jest as a gate.** It has no TypeScript 7 support and forces Node10 resolution. Use babel-jest or @swc/jest, and the build or `stunt-double check` as the gate.
- **The esbuild CLI.** It cannot load plugins: build through esbuild's JavaScript API with `stuntDoubleEsbuild()`, or use the universal tier.

## Not yet covered by an adapter

Metro (React Native / Expo), Farm and Astro have designs ([DESIGN.md §7](DESIGN.md#7-per-tool-integration)) but no adapter or suite yet, and neither have Bun's runtime and dev server (its bundler is covered). Use the universal tier there (`npx stunt-double init --universal`, then `stunt-double check && <tool>`); see R1.

## Untested

Windows (junctions, recursive `fs.watch`, case-insensitive file names), Bun as a package manager, several SDKs with slots in one app, and `kind: "server"` slots. See the open questions in [DECISIONS.md](DECISIONS.md#open-questions).
