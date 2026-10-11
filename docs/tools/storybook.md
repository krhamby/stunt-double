# Storybook

stunt-double works in Storybook 10 with both builders. Stories render your overrides in app code and inside
SDK components, and `storybook build` exits non-zero on every injection mistake below.

**Verified with:** storybook / @storybook/react-vite / @storybook/react-webpack5 10.6.1, vite 8.3.4,
@vitejs/plugin-react 6.1.2, webpack 5.111.1, @storybook/addon-webpack5-compiler-babel 4.0.1 (babel 7.29.7),
typescript 7.0.2, react 19.3.0, node 22.22.0, npm 10.9.4. Examples:
[`examples/customer-storybook-vite`](../../examples/customer-storybook-vite) and
[`examples/customer-storybook-webpack`](../../examples/customer-storybook-webpack). Tests:
[`tests/storybook-vite.test.mjs`](../../tests/storybook-vite.test.mjs),
[`tests/storybook-vite-final.test.mjs`](../../tests/storybook-vite-final.test.mjs) and
[`tests/storybook-webpack.test.mjs`](../../tests/storybook-webpack.test.mjs).

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

"Exit 1" means the command exits non-zero and its output contains the `[Fx]` line. The three suites
`tests/storybook-vite.test.mjs` (plugin from vite.config), `tests/storybook-vite-final.test.mjs`
(`viteFinal`) and `tests/storybook-webpack.test.mjs` (`webpackFinal`) run the whole shared mistake
catalogue (`tests/mutations/`) against the real `storybook build`. Every cell below was observed in all
three, unless the cell names a builder.

| # | Mistake | `storybook build` (all three setups) | `storybook dev` |
|---|---|---|---|
| F1a, F1b, F1b-upgrade, F9c | Override does not fit the contract (extra required prop, ignores SDK props, SDK 1.1.0 widens a hand-typed contract, async override) | Exit 1: `[F1] … TS2322` / `[F9]` from the type gate. builder-vite fails before bundling; builder-webpack5 fails in `finishModules`, because `storybook build` runs webpack in `production` mode. Also with TypeScript 5.9 | vite: `[F1]` in the terminal, from the asynchronous gate. webpack: **not checked**, because development mode runs no gate (R3). `storybook build`, `stunt-double check` and `tsc` catch it |
| F1c (5 shapes) | `React.FC`, `memo`, `forwardRef`, class, returns `children` | Passes, and the overrides render | |
| F2a, F2a-stray, F2b | Typo, stray file, slot renamed by SDK 2.0.0 | Exit 1: `[F2] … did you mean "Button"` / `RENAMED` | Live typo: `[F2]` in the terminal (vite: also on the overlay), and the story renders **no** slot, never the SDK default |
| F3a, F3b | Required slot missing (also: a new one added by SDK 2.0.0) | Exit 1: `[F3] required slot …` | as F2 (*not tested separately*) |
| F4 | Two files claim one slot | Exit 1: `[F4]` | as F2 (*not tested separately*) |
| F5a, F5b | Default export, or wrong export name | Exit 1: `[F5]` | as F2 (*not tested separately*) |
| CFG | Typo in a stunt-double config key | Exit 1: `[CFG] unknown key` | |
| F6a | The installed SDK imports a slot default relatively | Exit 1: `[F6] … Checkout.js imports the default of slot "Button" directly` | |
| F6b | A Storybook nobody wired (no plugin or `webpackFinal`) | Exit 1. vite: `[UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- …'`. webpack: `Module not found: … './STUNT-DOUBLE-NOT-WIRED -- …'` | |
| F6c-ssr | `ssr.external` lists the SDK (builder-vite only) | Exit 1: `[F6] … environment "ssr" externalizes @acme/core` | |
| F6g | App code imports `@acme/core/original/Button` | Exit 1: `[F6] … outside src/overrides` | |
| F6g-alias | A user alias aims a socket at the default (builder-vite only) | Prevented: the adapter's alias wins, and the overrides render | |
| F6h, UPG-minor | Override added or removed with no regeneration; SDK 1.1.0 adds an optional slot | Passes: the adapter regenerates at every start | Live: removing or restoring an override switches what renders, with no restart (both builders) |
| F7a–F7d | Override reaches its own slot (socket, barrel, helper, namespace) | Exit 1: `[F7]` | |
| F8 | The SDK resolves its own nested React | Exit 1: `[F8]` | |
| F9b | Client-slot override imports `server-only` | Exit 1: `[F9]` | |

The table shows only the dev scenarios that were tested. Separately, by hand: builder-webpack5
`storybook dev` started with an F2 mistake already present exits 1 at startup with `[F2]`, because
Storybook fails the first compilation.

Nothing in this table reaches runtime, and none of these mistakes needs a `stunt-double check &&` prefix
in front of `storybook build`. In CI, still run `stunt-double check` (or `tsc`) so that F1 is checked even
where only `storybook dev` runs.

## Known gaps

- **Contract errors in `storybook dev` on builder-webpack5.** Development mode does not run the type gate
  (as with webpack-dev-server everywhere, DESIGN.md §14 R3). `storybook build`, `stunt-double check`, `tsc`
  and the IDE catch them.
- **`bail: true`.** Storybook's builder-webpack5 sets `bail` in production. The adapter therefore reports
  static-validation problems from `compiler.hooks.run`, before anything compiles. If an unrelated module
  error happens first, webpack stops there. The build still fails, but the type-gate and audit messages are
  not printed.
- **Universal tier.** If `@acme/core-slots` is linked to the generated package, a Storybook without the
  adapter still renders your overrides through the link, but nothing validates them (R1; not tested here). Use the adapter,
  or put `stunt-double check &&` in front of the Storybook script.
- **One package with both builders.** A fresh `npm install` fails with ERESOLVE: @vitejs/plugin-react 6 has
  an optional peer chain that pulls in babel 8, while the webpack babel addon uses babel 7. Use one builder
  per package (as the examples do).
- **`@storybook/addon-webpack5-compiler-swc` 4.0.3.** Its peer range ends at Storybook 10.4, so npm refuses
  to install it with 10.6.1 unless you pass `--legacy-peer-deps`. The examples use the babel addon.
- **Not covered here.** Portable stories and `@storybook/addon-vitest` run under Vitest; see the Vitest
  adapter.
