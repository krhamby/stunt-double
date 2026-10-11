# Next.js 16 (Turbopack and `--webpack`)

`stunt-double/next` wraps your Next config. It covers the App Router (including Server Components), the Pages
Router, `next build` with Turbopack (the default) or `--webpack`, and `next dev` both ways.

## Setup

1. Install: `npm i -D stunt-double`
2. Wrap your config:

   ```js
   // next.config.mjs
   import { withStuntDouble } from 'stunt-double/next';

   export default withStuntDouble({
     // ...your config (an object, or a (phase, ctx) => config function)
   });
   ```

3. Put overrides in `src/overrides/`: `Button.tsx` exporting `Button`, and so on.

That's all: no tsconfig edits, no scripts, no extra dependency. `next build`, `next dev` and `next start` work as
before. Generated files go to `.stunt-double/`, which ignores itself in git.

Overrides don't need `"use client"`. The generated shim for a client slot carries the directive, so a Server
Component can import the SDK barrel and render `<Checkout>` while your hook-using override runs on the client.

Options (second argument): `typecheck: false` skips the type gate in `next build`, `watch: false` turns off the
dev watcher, `audit: false` turns off the webpack bundle audit. Any `stunt-double.config.json` key also works
here. An unknown option is a `[CFG]` error.

### What the wrapper does

| When | What |
|---|---|
| Config load (`next build`, `next dev`) | Validates the overrides and writes the shims. **Any injection mistake throws**, so the command exits 1 before compiling |
| `next dev` | Watches `src/overrides` and the config: adding, removing or swapping an override rewrites a shim, which the dev server picks up; a mistake turns the shims into an error the dev server shows. Under Turbopack a dev-only loader also re-validates each override file, and every file it imports (helpers added later too), as Turbopack compiles it, so a save that makes an override render itself fails that module instead of hanging the dev server |
| `transpilePackages` | Adds the SDK, brand layers and the slot package. Without it the Pages Router would load them natively in Node, where slots cannot be redirected (with the registry placeholder installed, `next build --webpack` would load it and fail) |
| Turbopack | One `turbopack.resolveAlias` entry: `'@acme/core-slots/*': './.stunt-double/gen/*.jsx'`. The target is relative on purpose: Turbopack silently ignores absolute targets |
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

| # | Mistake | `next build` (Turbopack) | `next build --webpack` | `next dev` (both) |
|---|---|---|---|---|
| F1a/b | Override doesn't fit the contract / ignores SDK props | Type gate: exit 1, `[F1] Button (src/overrides/Button.tsx): TS2322 …` | same | Printed in the `next dev` terminal (not the overlay); clears with "slot contracts OK again" |
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
| F9c | Async override in a client slot | Type gate: exit 1, `[F9] Logo (src/overrides/Logo.tsx): client slot override must not be an async component` | same | Printed in the `next dev` terminal |
| X1 | `typescript.ignoreBuildErrors: true` | Allowed: the type gate still runs (F1 still fails the build) | same | |
| — | TS 7 with `experimental.useTypeScriptCli: false` | Exit 1 natively ("TypeScript 7.0.2 does not provide the compiler API…") | same | |

A mistake present when `next dev` starts fails startup (exit 1). Mistakes made while it runs show up as Next's own
"Module not found: Can't resolve './STUNT-DOUBLE-ERROR -- [F2] …'" overlay and an HTTP 500.

Next prints the type gate's failure as `Failed to run runAfterProductionCompile: stunt-double: 1 injection error …`
followed by the `[Fx]` lines. The gate runs after Next has compiled (Next has no earlier async build hook), so a
contract mistake costs one compile; `npx stunt-double check` gives the same answer in about a second.

## Dev server

| | Turbopack | webpack |
|---|---|---|
| Add / remove / swap an override | Applied live, ~0.2–0.3 s | Applied live, ~0.4–1.6 s |
| Typo → HTTP 500 with the poison text, cleared on fix | yes (see the known gap below) | yes |

The shims live in `.stunt-double/gen/`. Turbopack picks up content changes in that dot directory (verified for
build and dev), and the alias target never changes, so no restart is needed.

## Known gaps

- **Turbopack dev keeps a stale error on App Router pages after a Pages Router page saw it.** If a mistake is live
  while a Pages Router route is requested, App Router routes keep returning that 500 after you fix it, until you
  request the Pages Router route again (or restart). This is Next 16.4 behaviour for any compile error in a
  module shared by both routers, not specific to stunt-double; `next dev --webpack` recovers on its own.
- **No post-bundle audit under Turbopack.** Turbopack has no plugin API. A config wrapper applied *after*
  `withStuntDouble` that overwrites `turbopack.resolveAlias['@acme/core-slots/*']` would go unnoticed. Apply
  `withStuntDouble` last (outermost).
- **Contract mistakes don't reach the browser in `next dev`.** F1 and F9c print in the dev server's terminal and
  fail `next build`, but the page keeps rendering. Next has no hook for pushing an error to its overlay.
  For squiggles in your editor too, run `npx stunt-double init --editor`.
- **`next start` imports `next.config.mjs`, and with it `stunt-double/next`.** Keep `stunt-double` installed
  where you run `next start`, or deploy the `output: 'standalone'` server, which embeds the serialized config. The
  wrapper does not validate or rewrite anything under `next start`: it serves the build that was validated when
  it was built. A custom server (`next({ dev: false })`) with a config *object* still validates at startup; pass a
  config function (`withStuntDouble((phase) => ({ ... }))`) to skip that too.
