# Metro (React Native, Expo)

## Setup

```js
// metro.config.js (CommonJS is fine)
const { getDefaultConfig } = require('@react-native/metro-config'); // Expo: require('expo/metro-config')
const { withStuntDouble } = require('stunt-double/metro');

module.exports = withStuntDouble(getDefaultConfig(__dirname));
```

The adapter needs no `@acme/core-slots` link: it answers every socket itself, even while npm's auto-installed registry placeholder sits in `node_modules`. For now, keep the tsconfig `paths` entry and the check file in `files` from `npx stunt-double init` for the type gate.

CI runs `npx stunt-double check`. A working example is in [`examples/customer-metro`](../../examples/customer-metro).

`stunt-double/metro` is an ES module. A CommonJS `metro.config.js` can `require()` it because Node 22.12+ loads synchronous ES modules through `require()`, and the adapter has no top-level await. Verified with no `ExperimentalWarning`. `withStuntDouble()` also accepts a promised config, for example from `metro-config`'s async `getDefaultConfig()`, and then returns a promise.

### What runs where

Metro has no build-start hook, so the adapter does its checks in three places:

| When | What | On a mistake |
|---|---|---|
| Config load | STA: `generate()` validates the overrides and writes the shims | Throws. `metro build`, `react-native bundle` and `expo export` exit 1 with the `[Fx]` lines |
| Config load, one-shot bundle commands only | TYP: `tsc` on `src/stunt-double.check.ts`, run synchronously (TS 7: about 150 ms) | Throws, exit 1 |
| `resolver.resolveRequest` | `@acme/core-slots/<Slot>` → `sdk-slots/gen/<Slot>.jsx`. Any earlier `resolveRequest` is chained for every other specifier | n/a |
| `serializer.experimentalSerializerHook` | AUD: audits the built module graph for F6 (a default bundled from outside the allowed files, or a socket that resolved somewhere other than its shim) and F8 (duplicate bundled packages) | Throws, the bundle fails. Any previous hook is chained |

A Metro config must stay a plain object, because other wrappers such as `withNativeWind` or `withSentryConfig` compose with it. For that reason the type gate runs synchronously instead of returning a promise.

`typecheck` defaults to `"auto"`. In auto mode, the adapter detects the CLI command from `process.argv`:

- **One-shot bundle commands block on the gate:** `build`, `bundle`, `export`, `export:embed`, `ram-bundle`. Xcode and Gradle release builds call `react-native bundle` or `expo export:embed`, so F1 fails them too.
- **Dev-server commands do not block:** `start`, `serve`, `run-ios`/`run:ios`, `run-android`/`run:android`. Type errors are printed to the terminal asynchronously.
- **Metro's JS API** (`Metro.runBuild(config, …)` from your own script) shows no command in `argv`. STA still throws there, but the type gate only runs if you pass `withStuntDouble(config, { typecheck: true })` or chain `stunt-double check &&`.

Other options:

- `typecheck: false` turns the gate off.
- `audit: false` turns the post-bundle audit off.
- `command: 'build' | 'serve'` overrides the detected command.

**Dev server (`metro serve`, `react-native start`, `expo start`):**

- An STA mistake does not stop the server. The shims are poisoned instead, so every bundle request returns HTTP 500 and the red box shows the `[Fx]` text.
- A watcher regenerates the shims when you edit an override, so the next request recovers without a restart. This was verified in the test.

## Versions verified

- metro 0.87.1 and @react-native/metro-config 0.87.1 (with its default @react-native/metro-babel-transformer).
- node 22.22.0, TypeScript 7.0.2, react / react-dom 19.3.0.
- Package `exports` resolution (`unstable_enablePackageExports`, default `true` in Metro 0.87) resolves `@acme/core/original/*`, and, in the universal tier, the linked slot package's `exports "./*"`. Metro follows the symlink natively.
- The generated files can live in a dot directory (`.stunt-double/gen`): `metro build` resolves, transforms and indexes them, and `metro serve` picks up rewrites live. No `watchFolders` or `blockList` change is needed.
- **Expo:** manually checked once, and not part of the test suite (the install is 265 MB):
  - expo 57.0.27 with `expo/metro-config` (@expo/metro-config 57.0.13) **pins metro 0.84.5, not 0.87**;
  - `withStuntDouble(getDefaultConfig(__dirname))` composes with Expo's config, including its `customSerializer`;
  - a `metro build` with that config, babel-preset-expo and Metro 0.84.5 rendered the overrides correctly;
  - F1 and F2 failed the build.

  `expo export` itself is **unverified**: it needs `react-native` and `app.json`, which the fixture does not have.

## Which mistakes fail where

Every row was observed by `tests/metro.test.mjs`.

- **Adapter:** `metro build` using `withStuntDouble`.
- **Bare:** the same config without the wrapper, with `@acme/core-slots` linked to the generated package, so no stunt-double code runs (universal tier, no `stunt-double check &&`).

| # | Mistake | Adapter (`metro build`) | `stunt-double check` | Bare Metro (no adapter, no chain) |
|---|---|---|---|---|
| F1 | Props incompatible with the contract | exit 1 at config load (type gate, one-shot commands only) | exit 1 | **silent**: bundles and renders |
| F2 | Typo `Buton.tsx` | exit 1 at config load | exit 1 | **silent**: the file is unused |
| F3 | Required `Logo` missing | exit 1 at config load | exit 1 | exit 1: `Unable to resolve module ../../src/overrides/Logo.tsx` (RES, from the last generated shim) |
| F4 | `Button.tsx` and `Button/index.tsx` | exit 1 at config load | exit 1 | **silent**: the previous shim decides |
| F5 | Default export instead of named | exit 1 at config load (STA) | exit 1 | **runtime**: bundles, then React error #130 (element type undefined). Metro does not check named imports |
| F6a | SDK imports `./original/Button.js` (variant `1.0.0-bad-relative`) | exit 1 at config load (dist scan) | exit 1 | **silent**: the SDK default renders inside `Checkout` |
| F6b | Unwired: no adapter and no link, so the registry placeholder answers `@acme/core-slots` | not a mistake: builds and renders correctly with the placeholder installed | passes | exit 1: `Unable to resolve module ./STUNT-DOUBLE-NOT-WIRED -- …` |
| F6g | App imports `@acme/core/original/Button` | exit 1 at config load | exit 1 | **silent**: the default renders at that call site |
| F6 (alias) | A resolver placed in front of the adapter sends a socket elsewhere | bundle fails (serializer-hook audit) | passes (nothing static to see) | silent |
| F7 | Override imports its own slot | exit 1 at config load | exit 1 | **runtime**: infinite render until out of memory |
| F8 | Nested React in the SDK (variant `1.0.0-nested-react`) | exit 1 at config load | exit 1 | **runtime**: `Cannot read properties of null (reading 'useContext')` |

When the build fails at config load, no bundle is written.

On the dev server, the same STA rows appear as HTTP 500 plus a red box. F1 is only logged.

## Known gaps

- **Metro's JS API** gets no type gate in `typecheck: "auto"`. Pass `typecheck: true`, or run `stunt-double check` first.
- **Dev server:** F1 does not block. It is logged asynchronously and is not pushed to the red box.
- **Detecting the command from `argv` is a heuristic.** A wrapper CLI that loads the Metro config in-process under another command name falls back to "unknown". Unknown means STA throws but the type gate does not run. Set `command: 'build'` or `typecheck: true` explicitly.
- **Error output:** a config-load throw prints Node's stack trace below the `[Fx]` lines. Metro's config loader tries `require()` and then `import()`, so generation runs twice before the error surfaces (about 0.1 s).
- **Bare Metro (no adapter):** silent for F1, F2, F4, F6a and F6g, and fails only at runtime for F5, F7 and F8. Without the adapter, always chain `stunt-double check && <bundle command>`.
- **The fixture is not a device app.** It has no `react-native` package, skips RN's `setup-env` prelude, and evaluates the bundle with `react-dom/server` in a V8 context. Device builds (Hermes) are unverified.
