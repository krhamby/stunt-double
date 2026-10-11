# Jest

stunt-double works with Jest 30 through a one-line config wrapper, `withStuntDouble()` from `stunt-double/jest`.
It validates your overrides when Jest loads its config, so an injection mistake stops `jest` before a single test runs.

Verified with jest 30.5.2, jest-environment-jsdom 30.5.2, babel-jest 30.5.2 (Babel 8.0.7), @swc/jest 0.2.39
(@swc/core 1.16.13), @testing-library/react 16.3.3, React 19.3.0, TypeScript 7.0.2, Node 22.22 and npm 10.9.
The reference project is [`examples/customer-jest`](../../examples/customer-jest), tested by
[`tests/jest.test.mjs`](../../tests/jest.test.mjs).

## Setup

```js
// jest.config.mjs
import { withStuntDouble } from 'stunt-double/jest';

export default withStuntDouble({
  testEnvironment: 'jsdom',
  // ...the rest of your Jest config
});
```

That is all for babel-jest. For @swc/jest, keep your `transform` entry as usual. It must cover `.jsx`, because
the generated shims are `.jsx` files:

```js
export default withStuntDouble({
  testEnvironment: 'jsdom',
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } } }] },
});
```

In CI, run the contract type check as well. babel-jest and @swc/jest never type-check:

```json
{ "scripts": { "test": "jest", "ci": "stunt-double check && jest" } }
```

Or let Jest run it, at the cost of one `tsc` run (about 0.2 s with TypeScript 7) every time Jest starts:

```js
export default withStuntDouble({ testEnvironment: 'jsdom' }, { typecheck: true });   // returns a Promise; Jest awaits it
```

### What the wrapper adds

| Key | Value |
|---|---|
| `moduleNameMapper` | `^@acme/core-slots/([A-Za-z0-9_]+)$` → `<root>/sdk-slots/gen/$1.jsx`, placed **before** your own entries. Jest applies it to requires from inside `node_modules` too, so SDK components render your overrides. |
| `transformIgnorePatterns` | if you did not set it: everything in `node_modules` except the SDK, written to match pnpm's `.pnpm/` layout as well (`transformIgnorePatternsFor()` is exported if you need to extend it). If you set it and it would skip the SDK or the shims, the config is refused with `[F6]`. |
| `watchPlugins` | a plugin that regenerates the shims on every file change during `jest --watch` (opt out with `{ watch: false }`). |

The project root is `opts.root`, else `rootDir`, else the current directory.

### Without the wrapper (universal tier)

Jest also works with no stunt-double code in its config: `@acme/core-slots` is linked to `./sdk-slots`, and
jest-resolve follows the link to the generated shims. Nothing validates in that setup, so chain the check, and
transform both the SDK and the slot package:

```js
// jest.config.mjs
export default {
  testEnvironment: 'jsdom',
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?@acme/core(-slots)?/)'],
};
```

```json
{ "scripts": { "test": "stunt-double check && jest" } }
```

### ts-jest

ts-jest is not a supported gate. It has no TypeScript 7 support, and it type-checks with its own Node10-style
resolution rather than your tsconfig. Use babel-jest or @swc/jest and keep `stunt-double check` (or `tsc`) in CI.

## Which mistakes fail where

`jest` = the plain `jest` command with the wrapper. The first three columns were observed for every row in
`tests/jest.test.mjs`; in the last column, F2a, F3, F5, F6b and F6h were observed and the other cells follow from
the same mechanism (no stunt-double code runs).

| # | Mistake | `jest` (wrapper) | `jest`, `{ typecheck: true }` | `stunt-double check && jest` | Universal tier, bare `jest` |
|---|---|---|---|---|---|
| F1a | Override props incompatible with the contract | **passes** | exit 1 at config load, `[F1] … TS2322` | exit 1 | passes |
| F1b | Override ignores contract props | **passes** | exit 1, `[F1] … ignores these SDK props` | exit 1 | passes |
| F9c | Async override in a client slot | tests fail at runtime (React: "`<Logo>` is an async Client Component") | exit 1, `[F9]` | exit 1 | tests fail at runtime |
| F2a | Typo or stray file in `src/overrides` | exit 1 at config load, `[F2] … did you mean "Button"?` | same | exit 1 | silent (file unused) |
| F2b | SDK upgrade renamed a slot | exit 1, `[F2] slot "PriceTag" was RENAMED to "Price"` | same | exit 1 | loud (resolve error) |
| F3 | Required slot missing | exit 1, `[F3]` | same | exit 1 | loud: `Cannot find module '../../src/overrides/Logo.tsx' from 'sdk-slots/gen/Logo.jsx'` |
| F4 | Two files claim one slot | exit 1, `[F4]` | same | exit 1 | silent (previous shim) |
| F5 | Wrong export name | exit 1, `[F5]` | same | exit 1 | **runtime**: "Element type is invalid … got: undefined" (CommonJS interop) |
| F6a | Installed SDK imports a default directly | exit 1, `[F6]` | same | exit 1 | silent default inside that SDK component |
| F6b | Registry placeholder instead of the link | exit 1, `[F6] … the registry placeholder` | same | exit 1 | every test file fails: `Cannot find module './STUNT-DOUBLE-NOT-WIRED -- …'` |
| F6c | `transformIgnorePatterns` skips the SDK | exit 1, `[F6] Jest transformIgnorePatterns entry …` | same | — | loud: Jest cannot load the ESM SDK |
| F6g | App code imports `@acme/core/original/*` | exit 1, `[F6]` | same | exit 1 | silent at that call site |
| F6h | Override added without regenerating | regenerated at config load (and by the watch plugin) | same | regenerated | previous decision (your tests may notice) |
| F7 | Override imports its own slot | exit 1, `[F7]` | same | exit 1 | infinite render |
| F8 | Duplicate React (SDK bundles its own) | exit 1, `[F8]` | same | exit 1 | runtime `useContext` of null |

"exit 1 at config load" means Jest prints the `stunt-double: N injection errors` block and runs no test.

**Watch mode.** `jest --watch` / `--watchAll` loads the config once. The watch plugin regenerates on every change.
A new mistake poisons the shims, so the tests that render the slot fail with the `[Fx]` text (for example
`Cannot find module './STUNT-DOUBLE-ERROR -- [F2] src overrides Buton.tsx …'`), and the full message is printed
after the run. Fixing the file turns the run green again.

## Known gaps

- **Contract errors (F1, F9c) do not fail plain `jest`.** Jest's transformers strip types. Use `{ typecheck: true }`
  or chain `stunt-double check` in CI (`"ci": "stunt-double check && jest"`). With `{ typecheck: true }`, a type
  error anywhere in an override or the files it imports also fails Jest's startup.
- **Jest has no dev overlay.** Inside `jest --watch` the signal is a failing test carrying the `[Fx]` text.
- **The root is not the config file's directory.** If you run `jest -c path/to/jest.config.mjs` from another
  directory, pass `withStuntDouble(config, { root: import.meta.dirname })` (or set `rootDir`).
- **Native ESM mode** (`--experimental-vm-modules`, `extensionsToTreatAsEsm`) and Yarn PnP were not verified.
