# Create React App (via craco)

Create React App 5 is webpack 5 underneath, so stunt-double uses the same wrapper as webpack, `withStuntDouble()` from `stunt-double/webpack`. CRA does not let you edit its webpack config, so you apply the wrapper through [craco](https://craco.js.org).

CRA 5 type-checks with TypeScript 5.x only (its fork-ts-checker 6 uses the TypeScript API). TypeScript 7 is not supported here.

## Setup

1. `npm i -D stunt-double @craco/craco` and replace `react-scripts` with `craco` in your scripts:

   ```json
   "scripts": {
     "postinstall": "stunt-double gen --no-fail",
     "start": "craco start",
     "build": "craco build"
   }
   ```

2. Create `craco.config.js` next to `package.json`:

   ```js
   const { withStuntDouble } = require('stunt-double/webpack');

   module.exports = {
     webpack: {
       configure: (config, { env }) => withStuntDouble(config, { mode: env, root: __dirname }),
     },
   };
   ```

   `stunt-double/webpack` is an ES module. `require()` loads it on Node 22.12 or newer.

3. Link the generated slot package and point TypeScript at it, as for every tool:

   ```jsonc
   // package.json
   "dependencies": { "@acme/core-slots": "file:./sdk-slots" }
   ```

   ```jsonc
   // tsconfig.json (only the stunt-double parts)
   {
     "compilerOptions": {
       "moduleResolution": "bundler",
       "paths": { "@acme/core-slots/*": ["./sdk-slots/gen/*"] }
     },
     "include": ["src"],
     "files": ["src/stunt-double.check.ts"]
   }
   ```

   react-scripts 5.0.1 checks `tsconfig.json` only when it creates the app (`init`), not on `start` or `build`. `"moduleResolution": "bundler"` and `paths` stay as you write them. You need `bundler` (or `node16`) because the SDK's `@acme/core/contracts` and `@acme/core/original/*` exist only in its `exports` map.

4. Put your components in `src/overrides/<Slot>.tsx`.

`craco build` and `craco start` now validate the overrides at every start and rebuild.

### What the wrapper changes in CRA's config

The same things as for plain webpack (see [webpack.md](webpack.md#what-the-wrapper-changes-in-your-config)). Four of them only matter under CRA:

- **ModuleScopePlugin.** CRA rejects imports from `src/` that resolve outside `src/`. The shims live in `sdk-slots/gen/`, so the wrapper adds exactly those shim files to the plugin's allow-list. Without it, `import { PriceTag } from '@acme/core-slots/PriceTag'` in app code fails with "falls outside of the project src/ directory". Other files outside `src/` stay blocked.
- **`bail`.** CRA's production config sets `bail: true`. When the overrides already have errors at config load, the wrapper turns `bail` off for that run. Otherwise webpack stops at the first module error (for a renamed override that is the old shim's `Module not found`) and the `[Fx]` message never prints.
- **Error order.** CRA prints only the first error. webpack sorts errors that have no module after all module errors, so the wrapper moves its own errors to the front.
- **Exit code.** With `TSC_COMPILE_ON_ERROR=true`, CRA's build prints every error under "Compiled with the following type errors" and exits 0. Without stunt-double that happens for any error, including `Module not found`. When stunt-double reported an error in a one-shot build, the wrapper sets `process.exitCode = 1`.

CRA's babel-loader only compiles `src/`. The generated shims are plain ES modules, so they need no compiling. Your overrides are compiled because they live in `src/`.

## Verified with

react-scripts 5.0.1, @craco/craco 7.1.0, webpack 5.111.1, webpack-dev-server 4.15.2, fork-ts-checker-webpack-plugin 6.5.3, babel-loader 8.4.1, TypeScript 5.9.3 (forced over react-scripts' `^3.2.1 || ^4` peer range with an npm `overrides` entry), React 19.3.0, Node 22.22.0. The example app is [`examples/customer-cra`](../../examples/customer-cra); the suite is `tests/cra.test.mjs`. CRA has no SSR build, so the suite checks the rendered markers by loading `build/` in headless Chromium (playwright-core 1.56.1).

## Where each mistake fails

Stages: **config load** = the wrapper validates when craco loads the config, and the build reports it. **type gate** = the wrapper's contract check, which runs during the build. **CRA tsc** = CRA's own fork-ts-checker, which checks every file under `src/`, including `src/stunt-double.check.ts`. Every cell in the `craco build` column exits 1 with the shown message as CRA's single printed error. The suite runs it with `CI=true`.

| # | Mistake | `craco build` | `craco start` overlay | Without the wrapper (link only) |
|---|---|---|---|---|
| F1a | Override props incompatible with the contract | `[F1] … TS2322` (type gate); CRA tsc fails too | ✓ appears, clears on fix | CRA tsc fails (TS2741 at the call site, or TS2322 in the check file) |
| F1b | Override ignores contract props | `[F1] … override ignores these SDK props` (type gate); CRA tsc fails too | same channel | CRA tsc fails |
| F1c | `forwardRef` / `memo` override (must pass) | passes | passes | passes |
| F2a | Typo or stray file (`Buton.tsx`) | `[F2]` (config load); a *renamed* override also prints `[F2]` first | ✓ appears, clears on fix | renamed: `Module not found` for the old target; stray extra file: silent |
| F2b | Slot renamed or removed by an SDK upgrade | `[F2] … RENAMED to "Price"`, `[F3] … "Footer"` (config load) | same channel | (not run) |
| F3 | Required slot not provided | `[F3]` (config load) | same channel | (not run) |
| F4 | Two files claim one slot | `[F4]` (config load) | same channel | (not run) |
| F5 | Default export instead of named | `[F5]` (config load) | same channel | `export 'Button' … was not found` (webpack, exit 1) |
| F6a | The installed SDK imports its own default | `[F6] … dist/Checkout.js imports the default …` (config load) | same channel | (not run) |
| F6b | craco config without the wrapper, placeholder installed | `Module not found: … './STUNT-DOUBLE-NOT-WIRED -- …'` | same text | that cell |
| F6e | Warm filesystem cache after removing or re-adding an override | correct output (CRA's `node_modules/.cache` is warm) | — | — |
| F6f | Placeholder installed instead of the link | `[F6] … resolves @acme/core-slots to … (the registry placeholder …)` (config load) | same channel | → F6b |
| F6g | App code imports `@acme/core/original/X` | `[F6] … outside src/overrides` (config load) | same channel | (not run) |
| F6h | Override added or removed without regenerating | regenerated at config load; correct output | ✓ regenerated live | bare `tsc`: TS2578 on the staleness probe |
| F6 audit | A plugin resolves a socket elsewhere | `[F6] … PriceTag.jsx is not in the bundle` (module-graph audit) | same channel | — |
| F7 | Override imports its own slot | `[F7]` (config load) | same channel | build passes; the page never finishes rendering (infinite render) |
| F8 | Two copies of React | `[F8] "react" resolves to 2 copies` (config load) | same channel | (not run) |
| F9c | Async component in a client slot | `[F9]` (type gate); CRA tsc fails too | same channel | CRA tsc fails |

In the dev column, ✓ marks what the suite drives in a real browser through `examples/customer-cra/probes/dev.mjs`. That includes a "rapid" scenario where the typo and its fix land within 300 ms. "Same channel" cells report through `compilation.errors` like the ✓ cells but were not run separately. The last column was run only where it shows a result. For the "(not run)" cells, see the "T0 bare" column in [DESIGN.md §2.3](../DESIGN.md#23-the-catalogue): some fail on resolution, others are silent. Without the wrapper, run `stunt-double check &&` before `craco build`.

With the wrapper, nothing in this table reaches runtime.

## Dev server behaviour

- Adding or removing an override shows up in the same rebuild, without restarting `craco start`.
- CRA reports type errors about 1–2 s after the bundle (its type check runs asynchronously in dev). The wrapper's type check runs too, after rebuilds that touched an override.
- The wrapper works around a fork-ts-checker 6.5.3 bug. When an override is renamed away and back (a typo and its fix), fork-ts-checker used to keep reporting `TS2307 Cannot find module './overrides/Button.js'` in `src/stunt-double.check.ts` until a restart, although the bundle was correct. The wrapper now announces the deletion to it.

## Cost

The wrapper's type check adds about 1.3–1.9 s to a `craco build` of the example (7.2 s → 8.5–9.1 s, TypeScript 5.9.3, 4 CPUs). It runs next to CRA's own type check. You could set `typecheck: false`, because CRA's type check also covers `src/stunt-double.check.ts` (the suite checks this for F1a and F9c). Don't: under `TSC_COMPILE_ON_ERROR=true` CRA demotes its own type errors to warnings and exits 0, while the wrapper's `[F1]` still fails the build.

## Known gaps

- **Implementations outside `src/`** (`"map": { "Logo": { "from": "shared/BrandLogo.tsx" } }`) fail the build, but with webpack's error instead of an `[Fx]` line: `Module parse failed: Unexpected token (1:12) … File was parsed as module type 'javascript/auto'`. CRA only runs babel on `src/`. Keep implementations under `src/`, or add the folder to CRA's babel-loader `include` in `craco.config.js`.
- **`CI=true` makes warnings fatal** (CRA behaviour). stunt-double warnings, such as `[W7]` consumer cycles and `[X2]` check file not in tsconfig, then fail CI builds as well.
- **Only the first error prints.** All stunt-double problems come in one block, so you see every `[Fx]` line. Other errors after that block stay hidden until you fix it.
- **`TSC_COMPILE_ON_ERROR=true`** still prints CRA's misleading header "Compiled with the following type errors" above an `[F2]`. The exit code is 1. Without the wrapper, every error exits 0 under this variable: run `stunt-double check &&` before the build.
- **TypeScript 7** cannot be used with CRA 5: react-scripts' type checker needs the TypeScript 5 API.
- **A relative import of a shim** (`import … from '../sdk-slots/gen/PriceTag.jsx'`) is allowed by the ModuleScopePlugin allow-list too. It is the same module as `@acme/core-slots/PriceTag`.
