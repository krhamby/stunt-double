# Storybook

stunt-double works in Storybook 10 with both builders. Stories render your overrides in app code and inside
SDK components, and `storybook build` exits non-zero on every injection mistake below.

**Verified with:** storybook / @storybook/react-vite / @storybook/react-webpack5 10.6.1, vite 8.3.4,
@vitejs/plugin-react 6.1.2, webpack 5.111.1, @storybook/addon-webpack5-compiler-babel 4.0.1 (babel 7.29.7),
typescript 7.0.2, react 19.3.0, node 22.22.0, npm 10.9.4. Examples:
[`examples/customer-storybook-vite`](../../examples/customer-storybook-vite) and
[`examples/customer-storybook-webpack`](../../examples/customer-storybook-webpack). Tests:
[`tests/storybook.test.mjs`](../../tests/storybook.test.mjs).

## Setup

Install the tool (`npm i -D stunt-double`), add the one adapter line below, and put each override in
`src/overrides/<Slot>.tsx`. You don't need tsconfig edits, .gitignore entries, a link dependency or a
postinstall script. The adapter writes its generated files to `.stunt-double/`, which ignores itself.

### builder-vite (`@storybook/react-vite`)

builder-vite loads your `vite.config.ts`. If that config already has `stuntDouble()`, Storybook needs no
extra setup:

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';
export default { plugins: [react(), stuntDouble()] };
```

```ts
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
};
export default config;
```

If Storybook uses a different Vite config (`framework.options.builder.viteConfigPath`) that does not have the
plugin, add it in `viteFinal`:

```ts
import { mergeConfig } from 'vite';
import { stuntDouble } from 'stunt-double/vite';
// ...
  viteFinal: (c) => mergeConfig(c, { plugins: [stuntDouble()] }),
```

### builder-webpack5 (`@storybook/react-webpack5`)

```ts
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/react-webpack5';
import { withStuntDouble } from 'stunt-double/webpack';
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: { name: '@storybook/react-webpack5', options: {} },
  addons: ['@storybook/addon-webpack5-compiler-babel'],
  webpackFinal: (c) => withStuntDouble(c),
};
export default config;
```

`withStuntDouble` takes the project root from `opts.root`, then `config.context`, then the current directory.
Storybook does not set `context`, so if you run `storybook` from another directory (some monorepo setups),
pass `withStuntDouble(c, { root: '/path/to/app' })`.

The babel compiler addon needs your own babel config (`@babel/preset-env`, `@babel/preset-react` with
`runtime: 'automatic'`, `@babel/preset-typescript`). See the example's `.babelrc.json`.

## Which mistake fails where

"Exit 1" means the command exits non-zero, and the output contains the `[Fx]` line. Every cell below was
observed by `tests/storybook.test.mjs` unless it is marked *not tested*.

| # | Mistake | `storybook build`, builder-vite (vite.config or viteFinal) | `storybook build`, builder-webpack5 | `storybook dev` |
|---|---|---|---|---|
| F1a/F1b | Override does not fit the contract (extra required prop, ignores SDK props) | Exit 1 before bundling: `[F1] … TS2322` (type gate, about 150 ms with TS 7) | Exit 1 at `finishModules`: `[F1] … TS2322` (the build runs in `production` mode, so the gate runs) | vite: asynchronous overlay (*not tested*). webpack: **not checked** (development mode has no gate). Covered by `storybook build`, `stunt-double check` and `tsc` |
| F2 | Typo or stray file (`Buton.tsx`) | Exit 1: `[F2] … did you mean "Button"` | Exit 1: `[F2]` (fails before compiling) | vite: the story shows Storybook's error display and the Vite overlay shows the `[F2]` text; defaults never render. webpack: `storybook dev` exits 1 at startup with `[F2]` |
| F3 | Required slot (`Logo`) missing | Exit 1: `[F3]` | Exit 1: `[F3]` | same mechanism as F2 (*not tested separately*) |
| F4 | Two files claim one slot | Exit 1: `[F4]` | Exit 1: `[F4]` | same as F2 (*not tested separately*) |
| F5 | Default export instead of named | Exit 1: `[F5]` | Exit 1: `[F5]` | same as F2 (*not tested separately*) |
| F6a | The installed SDK imports a slot default relatively | Exit 1: `[F6] … Checkout` | Exit 1: `[F6] … Checkout` | same as F2 (*not tested separately*) |
| F6b | A Storybook nobody wired (no plugin or `webpackFinal`) | Exit 1: `[UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- …'` | Exit 1: `Module not found: Error: Can't resolve './STUNT-DOUBLE-NOT-WIRED -- …'` | fails on the same import (*not tested*) |
| F6g | App code imports `@acme/core/original/Button` | Exit 1: `[F6] … original/Button` | Exit 1: `[F6] … original/Button` | same as F2 (*not tested separately*) |
| F7 | Override imports its own slot | Exit 1: `[F7]` | Exit 1: `[F7]` | same as F2 (*not tested separately*) |
| F8 | The SDK resolves its own nested React | Exit 1: `[F8]` | Exit 1: `[F8]` | same as F2 (*not tested separately*) |
| F9c | Async override in a client slot | Exit 1: `[F9]` (type gate) | Exit 1: `[F9]` (type gate) | as F1 |

Nothing in this table reaches runtime, and none of these mistakes needs a `stunt-double check &&` prefix
in front of `storybook build`. In CI, still run `stunt-double check` (or `tsc`) so that F1 is checked even
where only `storybook dev` runs.

## Known gaps

- **Contract errors in `storybook dev` on builder-webpack5.** Development mode does not run the type gate
  (as with webpack-dev-server everywhere, DESIGN.md §14 R3). `storybook build`, `stunt-double check`, `tsc`
  and the IDE catch them.
- **Mistakes made while `storybook dev` runs on builder-webpack5.** The adapter regenerates the shims in
  `watchRun` (they become poisoned) and pushes the error to `compilation.errors`. This has not been tested
  in Storybook's preview, so which overlay shows it is unknown.
- **`bail: true`.** Storybook's builder-webpack5 sets `bail` in production. The adapter therefore reports
  static-validation problems from `compiler.hooks.run`, before anything compiles. If an unrelated module
  error happens first, webpack stops there. The build still fails, but the type-gate and audit messages are
  not printed.
- **Universal tier.** If `@acme/core-slots` is linked to the generated package, a Storybook without the
  adapter still renders your overrides through the link, but nothing validates them (R1). Use the adapter,
  or put `stunt-double check &&` in front of the Storybook script.
- **One package with both builders.** A fresh `npm install` fails with ERESOLVE: @vitejs/plugin-react 6 has
  an optional peer chain that pulls in babel 8, while the webpack babel addon uses babel 7. Use one builder
  per package (as the examples do).
- **`@storybook/addon-webpack5-compiler-swc` 4.0.3.** Its peer range ends at Storybook 10.4, so npm refuses
  to install it with 10.6.1 unless you pass `--legacy-peer-deps`. The examples use the babel addon.
- **Not covered here.** Portable stories and `@storybook/addon-vitest` run under Vitest; see the Vitest
  adapter.
