# Other bundlers and tools: the universal tier

stunt-double has adapters for the Vite family, the webpack family, Next.js, esbuild, Jest and Metro. Any
other tool (Parcel, Farm, a bundler released next year, your company's in-house build script, plain Node)
uses the **universal tier**: no plugin, only standard package resolution.

It works because the SDK renders every overridable component through a bare *socket* import such as
`@acme/core-slots/Button`, and your project answers that import with a linked package, `sdk-slots/`, whose
`exports` point at generated one-line shims. Any tool that follows package `exports` and symlinks (or Yarn
PnP) picks up your overrides, in your code *and* inside the SDK. A tool that does not see the link resolves
the SDK team's registry placeholder instead, and fails with a message that says what to do. It never quietly
renders the SDK defaults.

## Setup

1. Install and wire the project (the link line depends on your package manager, see
   [package-managers.md](package-managers.md)):

   ```bash
   npm i @acme/core
   npm i -D stunt-double typescript
   npx stunt-double init
   npm install
   ```

2. **Prefix every build with the gate.** Without an adapter, no stunt-double code runs inside the tool, so
   the build script has to run it first:

   ```jsonc
   // package.json
   "scripts": {
     "postinstall": "stunt-double gen --no-fail",      // shims exist right after install (fresh clones, IDE)
     "build": "stunt-double check && <your tool's build command>"
   }
   ```

   `stunt-double check` regenerates the shims, runs every static check and the contract type check, and exits
   non-zero on any injection mistake. Make it a required CI step as well.

3. If the tool runs server code in Node (SSR, prerendering), make sure it **bundles** `@acme/core` instead of
   leaving it to Node. Vite without the adapter, for example, needs `ssr: { noExternal: ['@acme/core'] }`. If
   you forget, Node fails loudly (it refuses the `.jsx` shims, or hits the placeholder); it never renders
   defaults.

What a tool must support: package `exports` (`"./*"` subpath patterns), symlinks resolved to their real path
(or Yarn PnP), and a JS parser that accepts `.jsx` files containing plain ESM. Your overrides are `.tsx`, so
the tool also needs whatever TypeScript/JSX transform it already uses for your own code.

## Worked example: an adapter-less tool

[`examples/customer-node`](../../examples/customer-node) runs the same app as the Vite example under a tool
that knows nothing about stunt-double: Node's own ESM loader plus a 30-line transpile-only module hook
([`tool/hooks.mjs`](../../examples/customer-node/tool/hooks.mjs), sucrase for TS/JSX). All package
resolution is Node's.

```bash
npm run render        # stunt-double check && node --import ./tool/register.mjs tool/render.mjs
```

The server-rendered output shows the project's `Button`, `PriceTag` and `Logo` both where the app renders
them and inside the SDK's own `<Checkout>`. Replace the `sdk-slots` link with the registry placeholder and:

```text
$ npm run render:bare
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/node_modules/@acme/core-slots/STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project, this tool has no stunt-double adapter, or it externalizes @acme core -- run npx stunt-double doctor' …

$ npm run render
stunt-double: 1 injection error (@acme/core@1.0.0)
  [F6] @acme/core resolves @acme/core-slots to node_modules/@acme/core-slots (the registry placeholder: the link is missing or was replaced by an auto-installed peer), not sdk-slots/. Use npm "file:", pnpm "link:", Yarn "portal:", Bun "workspace:*", then reinstall.
```

The same app is also built by Vite 8 **without** the stunt-double plugin under npm, pnpm, Yarn PnP and Bun
(see [package-managers.md](package-managers.md)); those runs produced the table below.

## Which mistakes fail where

"Chained" means the build script is `stunt-double check && <build>`. "Bare" means the tool runs alone.
Observed with Vite 8.3.4 without the plugin (npm 10.9.4, pnpm 12.11.2, Yarn 4.18.1 PnP, Bun 1.4.2) and with
the Node loader above, TypeScript 7.0.2.

| Mistake | Chained (`stunt-double check &&`) | Bare tool |
|---|---|---|
| F1 override does not fit the contract (extra required prop, narrowed union, wrong `ref`, async, not a component, fewer props) | exit 1, `[F1]` / `[F9]` | **builds; wrong at runtime** (only a project `tsc` that includes `src/stunt-double.check.ts` catches it) |
| F2 typo'd or stray file in `src/overrides/` | exit 1, `[F2] … did you mean "Button"?` | **builds; the file is silently unused** |
| F3 required slot has no implementation | exit 1, `[F3]` | exit 1: the tool cannot resolve the shim's target |
| F4 two files claim one slot | exit 1, `[F4]` | **builds with the previous decision** |
| F5 wrong export (default instead of named) | exit 1, `[F5]` | exit 1 in Vite/Rolldown (`MISSING_EXPORT`) and Node (`does not provide an export named 'PriceTag'`); depends on the tool (runtime-only in Bun's bundler and Metro) |
| F6g app code imports `@acme/core/original/X` | exit 1, `[F6]` | **builds; that call site renders the SDK default** |
| F7 override imports its own slot (`import { Button } from '@acme/core'`) | exit 1, `[F7]` | **builds; infinite render at runtime (Node: out of memory)** |
| Link missing, placeholder installed | exit 1, `[F6] … the registry placeholder` | exit 1, `STUNT-DOUBLE-NOT-WIRED` resolve error |
| Link is a copy / another app's package / Yarn `__virtual__` | exit 1, `[F6]` / `[F8]` | see [package-managers.md](package-managers.md); can render another app's overrides |
| Override added or removed, shims not regenerated (stale) | regenerated by `check` | **builds with the previous decision**; a project `tsc -b` fails with TS2578 |
| SDK externalized by a server graph | — | exit/boot failure (Node refuses `.jsx`, or the placeholder) |

Every bold cell is the reason the chain is **mandatory** in the universal tier: without it, those mistakes are
exactly the runtime failures stunt-double exists to prevent. With an adapter (Vite, webpack, Next, …) the
bare build command already fails on all of them, because the gate lives in the tool's config.

## Known gaps

- **Bare runs are not gated.** If someone runs the tool directly (`npx vite build`, `node …`) instead of the
  chained script, the bold cells above apply. Protect the path to production with CI: `stunt-double check`
  as a required status check.
- **Stale shims.** In the universal tier the shims are regenerated by `postinstall` and by each
  `stunt-double check`, not by the tool. Adding or removing an override and running the bare tool uses the
  previous decision; a project `tsc` reports it (`TS2578` staleness probe).
- **No bundle audit.** The post-bundle audit (an alias or plugin resolving a socket elsewhere, duplicate
  React in the output) only runs inside adapters.
- **No dev overlay.** Use `stunt-double watch -- <dev command>`: it regenerates on change and turns mistakes
  into resolve errors the dev server shows.
