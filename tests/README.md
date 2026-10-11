# The test harness

stunt-double promises that every injection mistake is a **build failure**: the production build (or CI) exits non-zero with an actionable `[Fx]` message, or the dev server shows it. Never a runtime crash, never a silent fallback to the SDK default. This directory turns that promise into regression tests that run against real tools on real installs:

- **one fixture app per toolchain** (`examples/customer-<tool>/`), installed from the tarballs `npm run setup` packs, exactly like a user's project;
- **one shared mutation catalogue** (`tests/mutations/`): every mistake of the failure catalogue ([docs/DESIGN.md §2](../docs/DESIGN.md#2-failure-catalogue-the-north-star)) written once, run by every toolchain;
- **one small suite file per toolchain** (`tests/<tool>.test.mjs`) that says how to build and render its fixture and, where the tool differs, what it expects instead.

A new toolchain adds three new files and edits nothing (see [Adding a toolchain](#adding-a-toolchain)).

## Contents

- [Running the tests](#running-the-tests)
- [How a suite runs](#how-a-suite-runs)
- [The fixture contract](#the-fixture-contract)
- [The mutation catalogue](#the-mutation-catalogue)
- [Adding a toolchain](#adding-a-toolchain)
- [API reference](#api-reference)
- [Rules](#rules)
- [Debugging a failure](#debugging-a-failure)

## Running the tests

From the repository root, with Node 22.12 or later:

```bash
npm ci            # root dependencies (TypeScript, oxc-parser, ...)
npm run setup     # build every @acme/core variant, sdk-lint it, pack all tarballs into .packs/
npm test          # core unit tests, then every tests/*.test.mjs suite (in parallel processes)
```

| Command | Runs |
|---|---|
| `npm test` | everything |
| `npm run test:core` (`npm test -- core`) | the core unit tests in `packages/stunt-double/test/` (no install, about 1 s) |
| `npm run test:vite` (`npm test -- vite`) | `tests/vite.test.mjs` |
| `npm test -- <tool> [<tool> ...]` | those suites (add `core` to include the unit tests) |
| `npm test -- vite --test-name-pattern=F7` | flags after the filters go to `node --test` |
| `npm test -- --list` | what would run |

Environment variables:

| Variable | Effect |
|---|---|
| `STUNT_DOUBLE_WORK_DIR` | where fixtures are installed. Default: `<os tmpdir>/stunt-double-tests` |
| `STUNT_DOUBLE_REINSTALL=1` | ignore a cached install |
| `STUNT_DOUBLE_CLEAN=1` | delete each suite's work dir when it finishes |

The Vite suite (54 scenarios) takes about 70 seconds on 4 CPUs once its fixture is installed; the first run adds two `npm install`s (seconds with a warm npm cache). The core unit tests take about 1 second.

## How a suite runs

```
tests/<tool>.test.mjs ── defineToolSuite({...}) ──┐
                                                  v
  before:   copy examples/customer-<tool> (git-tracked + untracked-not-ignored files)
            -> <work>/<tool>/pristine/    file: specs pointing outside the fixture rewritten to absolute paths
            -> <work>/<tool>/app/         npm install, ONCE (reused while the fixture and the tarballs are unchanged)
  per test: reset app/ to pristine/ (fresh-clone state: nothing generated, no dist/, cold tool caches)
            install another SDK variant if the scenario asks for one (a real reinstall, like a user's upgrade)
            apply the mutation (file edits)
            run the command(s); assert
  after:    put the default SDK back; print a summary table; write <work>/<tool>/results.json
```

What a test asserts:

- **A mistake fails**: the command exits **non-zero**. Exit codes are never matched exactly (TypeScript 7 exits 1, TypeScript 5.9 exits 2).
- **With the right message**: regexes on the stable `[Fx]` code plus a key phrase (`/\[F2\][^\n]*did you mean "Button"/`), never the full text, so wording can improve without touching tests.
- **The positive case renders the overrides**: the fixture's render probe prints the server-rendered HTML; the harness counts `data-sd` markers in the app section and inside the SDK's `<Checkout>`.
- **The replaced default is gone**: the client bundle does not contain `SDK_DEFAULT_PRICETAG`, and does contain the wrapped original `SDK_DEFAULT_BUTTON`.
- **The simplicity bar**: after the positive build, no project file changed and nothing new exists outside the build outputs and `.stunt-double/` (no generated files in `src/`, no tsconfig, `package.json` or `.gitignore` edits).

Every command runs through `sh -c` in the installed app with `node_modules/.bin` first on `PATH`, `NO_COLOR=1`, `CI=1` and no inherited `npm_*` variables. Output is ANSI-stripped before matching.

## The fixture contract

Every `examples/customer-<tool>/` app is the same "project that injects its own components into `@acme/core`", so the shared catalogue applies to all of them unchanged:

| Requirement | customer-vite does it with |
|---|---|
| depends on `@acme/core` and `stunt-double` via `file:` specs into `../../.packs/`, and stands in for the registry's auto-installed placeholder peer with `"overrides": { "@acme/core-slots": "file:../../.packs/acme-core-slots-0.0.1.tgz" }` | `package.json`, `.npmrc` |
| overrides in `src/overrides/`: **Button** wraps `@acme/core/original/Button` in `<span data-sd="BRAND_BUTTON" data-ctx={theme}>` where the app theme is `"dark"`; **PriceTag** replaces the default (`data-sd="BRAND_PRICE"`); **Logo** implements the required slot (`data-sd="BRAND_LOGO"`). Typed with `SlotProps['X']` | `src/overrides/*.tsx`, `src/theme.tsx` |
| renders `<section data-probe="app">` with one app-level `<Button>` from `@acme/core`, and `<section data-probe="sdk">` with `<Checkout products={2 products}>` | `src/App.tsx`, `src/products.ts` |
| a **build** command that is the tool's real production build, plus whatever produces something the probe can render | `vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr` |
| a **render** command that prints `STUNT-DOUBLE-RENDER <JSON string of the HTML>` (see `tests/harness/markers.mjs`) | `node probes/render.mjs` |
| app sources under `src/` (the bypass scan and several mutations write there) | |

The standard render that results (`STANDARD_RENDER` in `tests/harness/expect.mjs`):

```
app: BRAND_BUTTON(dark) > SDK_DEFAULT_BUTTON(none)
sdk: BRAND_LOGO x1, BRAND_PRICE x3, BRAND_BUTTON(dark) x3, SDK_DEFAULT_BUTTON(in-cart) x3, SDK_DEFAULT_PRICETAG x0
```

The context values prove more than "something rendered": `dark` is the app's own React context seen from deep inside the SDK, `in-cart` is the SDK's context seen by the original the override wraps. A pre-bundled or duplicated module would break one of them.

Everything else (the tool's config, extra scripts, a different SSR or render strategy) is up to the fixture. Keep it a realistic minimal app for that tool.

## The mutation catalogue

`tests/mutations/*.mjs`, assembled in `tests/mutations/index.mjs`. Each entry: `id`, `title`, `catches` (the stage expected to catch it), `tags`, optional `sdk` (SDK variant to install), `family` (only for tools of that family), `needs` (suite features), `apply(fx, suite)` (the edit) and `expect`.

| id | mistake | expected (default) |
|---|---|---|
| F1a | override requires a prop the SDK never passes | build fails, `[F1] Button (…Button.tsx) … TS2322 … tone` |
| F1b | override ignores SDK props (declares only `children`) | build fails, `[F1] … override ignores these SDK props` |
| F1b-upgrade | SDK 1.1.0 widens a contract the override typed by hand | build fails, `[F1] Button` |
| F1c-fc, -memo, -forwardRef, -class, -children | `React.FC`, `memo()`, `forwardRef()`, class component, returns `children` | **must pass** and render |
| F2a | typo `Buton.tsx` | build fails, `[F2] … did you mean "Button"` |
| F2a-stray | stray `Button.override.tsx` | build fails, `[F2]` |
| F2b | SDK 2.0.0 renames PriceTag to Price | build fails, `[F2] … RENAMED to "Price"` |
| F3a | required Logo missing | build fails, `[F3] required slot "Logo"` |
| F3b | SDK 2.0.0 adds the required slot Footer | build fails, `[F3] required slot "Footer"` |
| F4 | `Button.tsx` and `Button/index.tsx` | build fails, `[F4] … claimed by 2 files` |
| F5a, F5b | default export; wrong export name | build fails, `[F5] … must export a named \`Logo\`` |
| CFG | typo in a config key | build fails, `[CFG] unknown key` |
| UPG-minor | SDK 1.1.0 adds an optional slot | **must pass**, Badge renders the SDK default |
| F6a | installed SDK imports a default relatively (1.0.0-bad-relative) | build fails, `[F6] … Checkout.js imports the default of slot "Button" directly` |
| F6b-config | a second tool config without the adapter (`needs: ['unwired']`) | that build fails, `STUNT-DOUBLE-NOT-WIRED` |
| F6b-node | plain Node imports `@acme/core` | fails, `ERR_MODULE_NOT_FOUND` + `STUNT-DOUBLE-NOT-WIRED` |
| F6g | app code imports `@acme/core/original/Button` outside the overrides | build fails, `[F6] … outside src/overrides` |
| F6h-add, F6h-remove | override added / removed after the last `stunt-double gen` | **must pass**: the adapter regenerates |
| F7a–F7d | override reaches its own slot: socket, barrel, helper file, namespace | build fails, `[F7]` with the import chain |
| F8 | duplicate React (1.0.0-nested-react) | build fails, `[F8] "react" … 2 copies` |
| F9b | client-slot override imports `server-only` | build fails, `[F9]` |
| F9c | async override in a client slot | build fails, `[F9] Logo … must not be an async component` |
| F6c-ssr *(vite family)* | SSR environment externalizes the SDK | build fails, `[F6] … environment "ssr" externalizes` |
| F6c-vitest *(vite family)* | Vitest `deps.optimizer` pre-bundles the SDK | `vitest run` fails, `[F6] Vitest deps.optimizer` |
| F6g-alias *(vite family)* | a user alias aims the Button socket at the default | `safe`: inert (adapter alias wins) or `[F6]` from the audit |

Outcomes: `fail` (non-zero exit + every message), `pass` (exit 0, optional render/bundle checks), `safe` (either fails with the messages or passes **and renders the overrides**: for mistakes a tool may make impossible by construction).

Besides the catalogue, `defineToolSuite` adds: the positive test, an optional dev-server test, an optional TypeScript 5.9 run of every `typegate` mutation, and an optional universal-tier block (positive, a subset of the catalogue through `stunt-double check &&`, "link declared but not installed", and the pinned residual "no `check &&` prefix").

A scenario that applies to every tool goes in the catalogue (append to the matching file, unique id). A scenario that only makes sense for one tool family goes in a family file with `family: '<name>'` (like `vite-family.mjs`). Adding a catalogue entry is a change every suite inherits, so it needs every existing suite green.

## Adding a toolchain

Your change is **three new files**. You edit nothing that already exists: not the harness, not the catalogue, not `package.json`, not another workflow.

```
examples/customer-<tool>/        the fixture app (see the contract above)
tests/<tool>.test.mjs            one defineToolSuite({...}) call
.github/workflows/<tool>.yml     its CI job
```

`scripts/run-tests.mjs` discovers `tests/*.test.mjs` on its own, so `npm test` and `npm test -- <tool>` pick the suite up immediately.

### 1. The fixture app

Copy `examples/customer-vite`'s `src/` (App, theme, products, overrides) and replace only what the tool needs: its config with the stunt-double adapter, its build script, and a render probe. Install it once by hand to create its lockfile:

```bash
npm run setup
cd examples/customer-<tool> && npm install && npm run build && node probes/render.mjs
```

Like customer-vite, pin every direct dependency to an exact version and add an `.npmrc` with `package-lock=false`: a lockfile would pin the integrity of the locally built tarballs, and npm would quietly reinstall a stale build from its cache after the next `npm run setup`. The harness rewrites the `file:` specs when it copies the app.

### 2. The suite

```js
// tests/webpack.test.mjs
import { defineToolSuite } from './harness/index.mjs';

defineToolSuite({
  name: 'webpack',                                  // test names, work dir, `npm test -- webpack`
  fixtureDir: 'examples/customer-webpack',
  family: 'webpack',                                // enables catalogue entries with family: 'webpack'
  toolConfig: 'webpack.config.mjs',                 // family mutations edit this file
  commands: {
    build: 'webpack --mode production && webpack --mode production --config webpack.ssr.config.mjs',
    render: 'node probes/render.mjs',
    test: 'jest',                                   // optional; any name, referenced from expectations
  },
  outputs: ['dist', 'dist-ssr'],                    // dirs the build may create (simplicity bar)
  positive: { bundle: { files: 'dist/*.js' }, alsoPass: ['check'] },
  unwired: {                                        // the same tool WITHOUT the adapter (enables F6b-config)
    files: { 'webpack.unwired.config.mjs': `export default { mode: 'production', entry: './src/main.tsx' /* ... */ };\n` },
    command: 'webpack --config webpack.unwired.config.mjs',
  },
  expectations: {
    // only where the tool really differs from the catalogue default; every entry is a documented decision
    F5a: { messages: [/export 'Logo' \(imported as 'Logo'\) was not found/] },  // native message instead
  },
  typescript5: true,                                // also run the type-gate mutations with TypeScript 5.9
});
```

Per-mutation `expectations` (an object keyed by id, or a function `(mutation, expect) => override`), merged over the catalogue's `expect`:

| You need | Write |
|---|---|
| the tool catches it only through the CLI gate | `F1a: { command: 'checkThenBuild' }` (`checkThenBuild` defaults to `` `${check} && ${build}` ``) |
| the tool's own message | `F5a: { messages: [/…/] }` |
| another command must fail too | `F2a: { also: [{ command: 'test' }] }` |
| a documented residual: the mistake reaches runtime with this tool | `F5a: { outcome: 'pass', residual: 'Bun bundler: missing export is a runtime error (R1); scripts chain stunt-double check &&' }` |
| the scenario cannot apply to this tool | `F6c-ssr: 'no SSR environment in this tool'` (a string is a skip reason) |

The harness refuses a suite that turns a failing mistake into a pass or `safe` without a `residual` reason, and `false` without a reason. A residual must also be in the tool's page under `docs/tools/` and in [docs/limitations.md](../docs/limitations.md).

Optional blocks:

```js
  devProbe: async (fx, t, suite) => { /* drive the dev server; see tests/harness/vite-dev.mjs */ },
  universal: {                                      // the universal tier (package link, no adapter)
    pm: 'npm',                                      // link line per package manager: tests/harness/pm.mjs
    files: { 'webpack.universal.config.mjs': '...' },  // the tool's config WITHOUT the adapter
    build: 'stunt-double check && webpack --config webpack.universal.config.mjs',
    bare: 'webpack --config webpack.universal.config.mjs',
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],  // caught by the `check &&` prefix
  },
  pm: 'pnpm',                                       // install the fixture with another package manager
```

A dev probe receives the installed fixture (`fx`, reset to pristine), the node:test context and the suite. Use `fx.run()`, `fx.override()`, `fx.pristineText()` and `fx.dir` (a scratch dir next to the app), and `assert` what the developer would see. For Vite-based tools, reuse `viteDevProbe()`.

### 3. The workflow

```yaml
# .github/workflows/webpack.yml
name: webpack
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
concurrency:
  group: webpack-${{ github.ref }}
  cancel-in-progress: true
jobs:
  webpack:
    name: webpack 5 suite
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup     # Node 22 + npm cache + npm ci + npm run setup
      - run: npm test -- webpack
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: webpack-results
          path: /tmp/stunt-double-tests/*/results.json
          if-no-files-found: ignore
```

Install anything else the tool needs (Bun, pnpm via corepack, a browser) in this workflow, not in the shared action.

### Checklist

- `npm test -- <tool>` is green locally, and `npm test -- vite` still is.
- Every catalogue entry either passes with the default expectation or has an override you can justify in one line.
- Versions you ran are pinned exactly in the fixture's `package.json` and named in `docs/tools/<tool>.md`.

## API reference

Import everything from `tests/harness/index.mjs`.

**`defineToolSuite(spec)`**: registers a `describe(name)` with the tests above.

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | suite name |
| `fixtureDir` | yes | the example app, relative to the repo root |
| `commands.build` | yes | the production build; must exit non-zero on every mistake |
| `commands.render` | yes | prints the `STUNT-DOUBLE-RENDER` line for the built app |
| `commands.check` | | default `stunt-double check` |
| `commands.checkThenBuild` | | default `` `${check} && ${build}` `` |
| `commands.<any>` | | referenced by `expectations` (`command: '<any>'`) or `positive.alsoPass` |
| `family`, `toolConfig` | | enable and target family-specific mutations |
| `pm` | | `npm` (default), `pnpm`, `yarn`, `bun` (only npm is exercised so far) |
| `positive` | | `{ render, bundle: { files, contains, absent }, alsoPass: [command names] }` |
| `outputs` | | dirs the build may create (default `['dist']`) |
| `generatedDir` | | where stunt-double may write (default `.stunt-double`) |
| `unwired` | | `{ files, command }`: the tool without the adapter |
| `expectations` | | per-mutation overrides, see above |
| `mutations` | | `(list) => list` to filter or extend the applicable catalogue |
| `devProbe` | | `(fx, t, suite) => Promise` |
| `typescript5` | | `true` or `{ spec, select }`: rerun `typegate` mutations with the npm alias `typescript5` |
| `universal` | | universal-tier block, see above |
| `addDependencies`, `addDevDependencies` | | extra deps written into the copy before install |
| `sdk`, `layout` | | another SDK naming or source layout (defaults in `tests/harness/fixture.mjs`) |
| `timeout` | | per test, default 5 minutes |

**`Fixture`** (`fx` in mutations and probes): `run(cmd, opts)`, `read(rel)`, `write(rel, text)`, `edit(rel, fn)` (throws when `fn` changes nothing), `remove(rel)`, `rename(from, to)`, `json(rel, fn)`, `config(patch)` (merges into `stunt-double.config.json`), `override('Button.tsx')`, `src('x.tsx')`, `spec(fromRel, toRel)`, `restore(rel)`, `pristineText(rel)`, `useSdk(variant)`, `core()` (the installed `stunt-double/core`), and `app`, `dir`, `pristine`, `layout`, `sdk`.

**Assertions** (`tests/harness/expect.mjs`): `assertFailed`, `assertPassed`, `assertMessages`, `assertRender`, `assertBundle`, `STANDARD_RENDER`, `STANDARD_BUNDLE`.

**Universal tier** (`universalTransform({ pm, dir, files })`): turns an adapter-tier copy into its universal-tier twin. It adds the package manager's link line for `@acme/core-slots` (`file:` for npm, `link:` for pnpm, `portal:` for Yarn, `workspace:*` plus `workspaces` for Bun), the stub `sdk-slots/package.json` (no dependencies or peers) and `"outDir": "sdk-slots"`.

## Rules

- **Never weaken a test to get green.** A tool that cannot meet a guarantee gets an explicit `residual` expectation (it pins the observed behaviour, so a fix is noticed) and a line in its docs page.
- Match `[Fx]` codes and key phrases, not full messages. Never match an exact exit code.
- Every expectation is observed for real: no scenario is "known to pass" without running.
- Keep a suite under about 10 minutes on 4 CPUs: install once, prefer the default SDK, group scenarios that share an SDK variant.

## Debugging a failure

- An assertion quotes the command, its exit status and the tail of its output.
- The installed app stays in `<work>/<suite>/app` (reset to pristine after the run); `<work>/<suite>/results.json` lists every scenario's commands, exit codes and timings.
- Rerun one scenario: `npm test -- vite --test-name-pattern="F7c"`.
- Reproduce by hand: `cd <work>/vite/app`, apply the edit, run the build command from the test output.
