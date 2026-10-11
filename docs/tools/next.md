# Next.js 16 (Turbopack and `--webpack`)

`stunt-double/next` wraps your Next config. It covers the App Router (including Server Components), the Pages
Router, `next build` with Turbopack (the default) or `--webpack`, and `next dev` both ways.

## Setup

```sh
npm i -D stunt-double
npx stunt-double init        # or do the steps below by hand
```

```js
// next.config.mjs
import { withStuntDouble } from 'stunt-double/next';

export default withStuntDouble({
  // ...your config (an object, or a (phase, ctx) => config function)
});
```

```jsonc
// tsconfig.json: add these two entries next to what Next writes
{
  "compilerOptions": {
    "paths": { "@acme/core-slots/*": ["./sdk-slots/gen/*"] }
  },
  "files": ["src/stunt-double.check.ts"]
}
```

```jsonc
// package.json
{
  "scripts": {
    "postinstall": "stunt-double gen --no-fail",
    "dev": "stunt-double watch -- next dev",   // add --webpack after `next dev` if you use webpack
    "build": "next build"
  },
  "dependencies": { "@acme/core-slots": "file:./sdk-slots" }
}
```

Put overrides in `src/overrides/` (`Button.tsx` exporting `Button`, and so on). They don't need
`"use client"`: the generated shim for a client slot carries the directive, so a Server Component can import the
SDK barrel and render `<Checkout>` while your hook-using override runs on the client.

### What the wrapper does

| When | What |
|---|---|
| Config load (`next build`, `next dev`) | Validates the overrides and writes the shims. **Any injection mistake throws**, so the command exits 1 before compiling |
| `transpilePackages` | Adds the SDK, brand layers and the slot package. Without it the Pages Router would load them natively in Node, where slots cannot be redirected (with the registry placeholder installed, `next build --webpack` would load it and fail) |
| Turbopack | One `turbopack.resolveAlias` entry: `'@acme/core-slots/*': './sdk-slots/gen/*.jsx'`. The target is relative on purpose: Turbopack silently ignores absolute targets |
| webpack (`--webpack`) | Exact aliases to the shims, `exportsPresence: 'error'`, the decision fingerprint folded into the persistent cache version, and a post-bundle audit (bypassed sockets, duplicate SDK) reported as a build error |
| Type gate (`next build` only) | `compiler.runAfterProductionCompile` runs the slot contract check on both bundlers; a failure fails the build with `[F1]` / `[F9]` lines. Your own `runAfterProductionCompile` still runs first. `typescript.ignoreBuildErrors` does not switch it off |

If you set `typescript.tsconfigPath`, the wrapper checks that file instead of `tsconfig.json`.

## Verified with

next 16.4.0 (Turbopack and `--webpack`), react / react-dom 19.3.0, typescript 7.0.2 (Next's default
`experimental.useTypeScriptCli: true`) and 5.9.3 (CLI and programmatic API), node 22.22.0, Chromium (Playwright
1.56.1). The example app is [`examples/customer-next`](../../examples/customer-next); the suite is
`tests/next.test.mjs`.

Observed on both bundlers: the prerendered HTML of the App Router page, the client page and the Pages Router page
carries the overrides in app-level *and* SDK-internal positions; the client chunks carry them; the replaced
default (`PriceTag`) is absent from every output file; in Chromium the pages hydrate with no console errors or
hydration warnings and the SDK's own buttons are interactive.

## Which mistakes fail where

"Config load" means `next build` and `next dev` both exit 1 before compiling, with the `[Fx]` message.

| # | Mistake | `next build` (Turbopack) | `next build --webpack` | `stunt-double watch -- next dev` |
|---|---|---|---|---|
| F1a/b | Override doesn't fit the contract / ignores SDK props | Type gate: exit 1, `[F1] Button (src/overrides/Button.tsx): TS2322 …` | same | Not reported (IDE squiggle; `next dev` does not type-check) |
| F2 | Typo or stray file in `src/overrides` | Config load | Config load | HTTP 500 + overlay with the poison text; clears on fix |
| F3 | Required slot missing | Config load | Config load | HTTP 500 + overlay |
| F4 | Slot claimed twice | Config load | Config load | HTTP 500 + overlay |
| F5 | Wrong export (default vs named) | Config load | Config load | HTTP 500 + overlay |
| F6g | App code imports `@acme/core/original/X` | Config load | Config load | HTTP 500 + overlay |
| F6 audit | A later plugin re-aliases a socket elsewhere | **Not caught** (no Turbopack hook) | Exit 1, `[F6] … not in the bundle` | — |
| F7 | Override imports its own slot | Config load | Config load | HTTP 500 + overlay |
| F9a | Hook-using override without `"use client"` | Renders (the shim carries the directive) | same | same |
| F9a′ | Shim directive switched off (`"rsc": false`) | Exit 1 natively at prerender ("Attempted to call useTheme() from the server") | same | |
| F9b | `server-only` imported by a client-slot override (directly or via a helper) | Config load | Config load | HTTP 500 + overlay |
| F9c | Async override in a client slot | Type gate: exit 1, `[F9] Logo (src/overrides/Logo.tsx): client slot override must not be an async component` | same | Not reported (IDE) |
| X1 | `typescript.ignoreBuildErrors: true` | Allowed: the type gate still runs (F1 still fails the build) | same | |
| X2 | App tsconfig does not include the check file | Allowed: the type gate has its own program | same | |
| — | TS 7 with `experimental.useTypeScriptCli: false` | Exit 1 natively ("TypeScript 7.0.2 does not provide the compiler API…") | same | |

A mistake present when `next dev` starts fails startup (exit 1). Mistakes made while it runs show up as Next's own
"Module not found: Can't resolve './STUNT-DOUBLE-ERROR -- [F2] …'" overlay and an HTTP 500.

Next prints the type gate's failure as `Failed to run runAfterProductionCompile: stunt-double: 1 injection error …`
followed by the `[Fx]` lines. The gate runs after Next has compiled (Next has no earlier async build hook), so a
contract mistake costs one compile; `npx stunt-double check` gives the same answer in about a second.

## Dev server

| | Turbopack | webpack |
|---|---|---|
| Add / remove / swap an override (with `stunt-double watch`) | Applied live, ~0.2–0.3 s | Applied live, ~0.4–5 s |
| Typo → HTTP 500 with the poison text, cleared on fix | yes (see the known gap below) | yes |
| Without `stunt-double watch` | Nothing regenerates. Removing an override gives a loud 500, but a new override or a typo'd stray file is **ignored until you restart** `next dev`. Use `watch` | The wrapper regenerates on each rebuild, so add / remove / swap / typo all work without `watch` |

The shims live in `sdk-slots/gen/` at the project root. Turbopack picks up their content changes there; they do
not need to move under `src/`.

## Known gaps

- **Turbopack dev keeps a stale error on App Router pages after a Pages Router page saw it.** If a mistake is live
  while a Pages Router route is requested, App Router routes keep returning that 500 after you fix it, until you
  request the Pages Router route again (or restart). This is Next 16.4 behaviour for any compile error in a
  module shared by both routers, not specific to stunt-double; `next dev --webpack` recovers on its own.
- **No post-bundle audit under Turbopack.** Turbopack has no plugin API. A config wrapper applied *after*
  `withStuntDouble` that overwrites `turbopack.resolveAlias['@acme/core-slots/*']` would go unnoticed. Apply
  `withStuntDouble` last (outermost).
- **`next dev` does not type-check.** Contract mistakes (F1, F9c) appear in the IDE and fail `next build` /
  `stunt-double check`, but not the dev server.
- **`next start` imports `next.config.mjs`, and with it `stunt-double/next`.** Keep `stunt-double` installed
  where you run `next start`, or deploy the `output: 'standalone'` server, which embeds the serialized config. The
  wrapper does not validate or rewrite anything under `next start`: it serves the build that was validated when
  it was built. A custom server (`next({ dev: false })`) with a config *object* still validates at startup; pass a
  config function (`withStuntDouble((phase) => ({ ... }))`) to skip that too.
