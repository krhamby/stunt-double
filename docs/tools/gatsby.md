# stunt-double with Gatsby 5

Gatsby builds with webpack 5, so it uses the webpack adapter (`stunt-double/webpack`) through `onCreateWebpackConfig`. Every Gatsby stage is wrapped: `develop`, `develop-html`, `build-javascript` and `build-html`. That means the browser bundle and the HTML that `gatsby build` server-renders both get the overrides.

## Verified versions

| Package | Version |
|---|---|
| `gatsby` | 5.16.1 (webpack 5.98.0) |
| `typescript` | 7.0.2 (the type gate) |
| `react` / `react-dom` | 19.3.0 |
| Node | 22.22 |

Reference app: [`examples/customer-gatsby/`](../../examples/customer-gatsby/). Tests: `npm test -- gatsby` ([tests/gatsby.test.mjs](../../tests/gatsby.test.mjs)).

## Setup

Setup takes three steps:

1. `npm i -D stunt-double`
2. Add one hook to `gatsby-node`.
3. Write your overrides in `src/overrides/<Slot>.tsx`.

```js
// gatsby-node.mjs
import { withStuntDouble } from 'stunt-double/webpack';

export const onCreateWebpackConfig = ({ actions, getConfig }) => {
  actions.replaceWebpackConfig(withStuntDouble(getConfig()));
};
```

You don't need tsconfig edits, a postinstall, an `@acme/core-slots` dependency or a `stunt-double check &&` prefix: the type gate runs inside `gatsby build`. Generated files go to `.stunt-double/`.

Two plain Gatsby 5 requirements apply here too. Neither is specific to stunt-double:

- The site must not be `"type": "module"`. Gatsby's generated HTML renderer is CommonJS, and `gatsby build` fails with `require is not defined in ES module scope`. Name the config files `gatsby-config.mjs` / `gatsby-node.mjs` instead.
- If your components don't `import React`, use `jsxRuntime: 'automatic'` in `gatsby-config`. Otherwise you get `React is not defined` while building static HTML.

## Which mistake fails where

Every `[Fx]` line appears under Gatsby's `ERROR #98123 WEBPACK.BUILD-JAVASCRIPT` (or `#98124`), and `gatsby build` exits 1.

On an interactive terminal, Gatsby's default ink logger wraps messages at 80 columns. In CI (`CI=1`, the yurnalist logger) they stay on one line. Every row was observed in the test suite.

| # | Mistake | `gatsby build` | `gatsby develop` (Chromium, `gatsby-fast-refresh` overlay) |
|---|---|---|---|
| F1a / F1b | Override props incompatible with the contract, or the override ignores contract props, or a 1.1.0 upgrade widens the contract | exit 1, TYP `[F1] …` | F1a: overlay; clears on fix |
| F1c | `React.FC`, `memo`, `forwardRef`, class component, or an override that returns its children | passes and renders | |
| F2a | Typo or stray file | exit 1, STA `[F2]` | overlay; clears on fix |
| F2b / F3b | SDK 2.0.0 renames PriceTag or adds a required Footer | exit 1, STA `[F2]` / `[F3]` | |
| F3a | Required slot missing | exit 1, STA `[F3]` | overlay; clears on fix |
| F4, F5a/b, CFG | Two claims, a wrong export, a config-key typo | exit 1, STA `[F4]` / `[F5]` / `[CFG]` | F5a: overlay; clears on fix |
| F6a | SDK imports a slot default directly (`1.0.0-bad-relative`) | exit 1, STA `[F6]` | |
| F6b | `gatsby-node` without the adapter | exit 1, RES `Can't resolve './STUNT-DOUBLE-NOT-WIRED -- …'` | |
| F6c | A RegExp `externals` entry captures `@acme/core` in the `build-html` stage | exit 1, `[F6] "@acme/core" is external in this node14.15 build …` | |
| F6e | Warm `.cache/webpack`, override removed or re-added | correct. The fingerprint is folded into the filesystem-cache `version` of `build-javascript` and `build-html` | |
| F6g | App imports `@acme/core/original/X`, or a plugin redirects a socket | exit 1, STA `[F6]` / AUD `[F6] … is not in the bundle` | |
| F6h | Override added or removed since the last generation | prevented: regenerated at every start | override removed or re-added renders live, without a restart |
| F7a–d, F8, F9b | Self-import, duplicate React, `server-only` in a client slot | exit 1, STA `[F7]` / `[F8]` / `[F9]` | F7: overlay; clears on fix |
| F9c | Async override in a client slot | exit 1, TYP `[F9]` | |

Timing (4 CPUs):
- **Failing build:** about 12 s.
- **Passing build:** about 30 s (cold `.cache`).
- **Full suite:** about 13 minutes. That is over the harness's 10-minute target, because Gatsby builds are slow.

The TypeScript 5.9 rerun and the universal tier are not run for Gatsby. They exercise no Gatsby-specific code, and the Rsbuild, webpack and Rspack suites run them with the same adapter.

## Known gaps

1. **`webpack-node-externals` can't be used with Gatsby.** Externalizing `node_modules` in the `build-html` stage breaks Gatsby's own HTML renderer under React 19 (`TypeError: Cannot read properties of undefined (reading 'ContextRegistry')`). The crash comes from React internals, not from stunt-double code, and the adapter still kept `@acme/core` bundled (no `require("@acme/core")` in `render-page.js`). The shared "node-externals must pass" scenario is skipped for Gatsby with that reason. A RegExp external that captures the SDK is still caught (F6c above).

2. **Removing an override is slower to show in `gatsby develop`.** The SDK default renders without a restart, but it took about 10 s to appear in the browser. Adding an override back, or a mistake reaching the overlay, took about 1 s. The times are from the test run and include its 1.5 s stability hold.
