# Next.js 16 (Turbopack and webpack)

```js
// next.config.mjs
import { withStuntDouble } from 'stunt-double/next';

export default withStuntDouble({ /* your Next config, or a (phase, ctx) function */ });
```

`withStuntDouble()` returns an async config function of Next's phase.

| Phase | What happens |
|---|---|
| `next build` (config load) | validates `src/overrides` and runs the contract type check **before compiling**: any injection mistake fails the build. Next's own type check does not include stunt-double's check file, so the adapter runs the gate itself; `typescript.ignoreBuildErrors` cannot skip it |
| `next dev` | a mistake writes poisoned shims, so every request shows the report (Next's error overlay, HTTP 500); an in-process watcher regenerates on override changes, so adding, removing, fixing or editing an override works without a restart |
| both, Turbopack | `turbopack.resolveAlias`: one exact, `./`-relative alias per slot to `.stunt-double/gen/<Slot>.jsx` (Turbopack has no resolver plugins and silently ignores absolute alias targets) |
| both, `--webpack` | the [webpack adapter](webpack.md) per compiler: aliases, missing exports as errors, the post-bundle audit |
| both | the SDK is added to `transpilePackages`, so the server bundle contains it; `[F6]` if `serverExternalPackages` lists it |

**Client and server.** Shims of client slots carry `"use client"` (`rsc: "auto"` turns it on when `next` is installed); value-slot shims never do, so a value slot works in server and client components alike.

**The default tsconfig is `strict: false`.** That makes plain TypeScript accept narrowed function parameters. stunt-double's contract check does not: see [F1](../errors.md#f1--contract-mismatch).

Options: `withStuntDouble(config, { typecheck, audit, ...anyConfigKey })`.

**Verified with** next 16.4.0 (App Router; Turbopack and `--webpack`), TypeScript 7.0.2: `tests/next.test.mjs` and `tests/next-webpack.test.mjs` run the shared catalogue, the Next-family scenarios (`serverExternalPackages`, `ignoreBuildErrors`) and the universal tier (a plain `next.config.mjs` with `transpilePackages` and the package link). `next dev` was checked by hand: typo → HTTP 500 with the report, fix → 200, override removed → the SDK default renders, restored → the override renders, all without a restart.
