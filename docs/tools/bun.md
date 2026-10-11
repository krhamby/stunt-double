# stunt-double with Bun 1.4

Verified with **Bun 1.4.2** (bun-types / `@types/bun` 1.4.2), TypeScript 7.0.2, React 19.3.0, Node 22.22.0, on Linux x64.
Example: [`examples/customer-bun`](../../examples/customer-bun). Suite: [`tests/bun.test.mjs`](../../tests/bun.test.mjs).

Bun gives you four commands that touch your overrides, and they do not all run plugins:

| Command | Runs a bundler plugin? | How sockets resolve | Validation |
|---|---|---|---|
| `bun build.ts` (`Bun.build()` in a script) | yes: `stuntDoubleBun()` | plugin `onResolve` | adapter: STA + type gate + audit |
| `bun ./index.html` (dev server) | yes: bunfig `[serve.static] plugins` | plugin `onResolve` | adapter dev mode: poisoned shims + watcher |
| `bun build` CLI | **no** (it cannot load plugins) | the `workspace:*` link | none: `stunt-double check &&` |
| `bun test` with the `stunt-double/bun-test` preload | runtime plugin (`onLoad`) | scoped rewrite of the SDK's socket specifiers | preload: STA + type gate (exit 1) |
| `bun run`, the Bun runtime, `bun test` without the preload | no (a runtime `Bun.plugin` `onResolve` never sees the SDK's bare specifiers [V]) | the link, or tsconfig `paths` | none: `stunt-double check &&` |

## Setup

```jsonc
// package.json
{
  "workspaces": ["sdk-slots"],
  "scripts": {
    "postinstall": "stunt-double gen --no-fail",
    "dev": "bun ./index.html",
    "build": "bun build.ts",
    "test": "bun test"
  },
  "dependencies": { "@acme/core": "…", "@acme/core-slots": "workspace:*" },
  "devDependencies": { "stunt-double": "…", "typescript": "7.0.2", "@types/bun": "1.4.2" }
}
```

```ts
// build.ts — the `bun build` CLI cannot load plugins, so production builds go through Bun.build()
import { stuntDoubleBun } from 'stunt-double/bun';

const sd = stuntDoubleBun(); // options: typecheck (default true), audit (default true), any config key
await Bun.build({ entrypoints: ['./index.html'], outdir: './dist', target: 'browser', minify: true, plugins: [sd] });
```

```toml
# bunfig.toml
[serve.static]                       # the dev server (`bun ./index.html`, Bun.serve HTML routes)
plugins = ["stunt-double/bun"]

[test]                               # bun test
preload = ["stunt-double/bun-test"]
```

### `bun test`: the `stunt-double/bun-test` preload

The Bun runtime has no hook that sees the SDK's bare `@acme/core-slots/<Slot>` imports: a runtime `Bun.plugin`
`onResolve` is never called for them [V]. Only `onLoad` fires, so the preload is a **scoped specifier rewrite for
the test runtime only**: for files inside the installed SDK (and brand layer) packages, the exact
`'@acme/core-slots/<Slot>'` strings of `import`, `export … from` and literal `import()` are replaced with the
absolute shim path (parsed with oxc, string literals only). App code and every other package load untouched; an
unknown slot is left alone and fails on the registry placeholder. Before any test file loads, the preload runs the
generator and awaits the type gate; an injection error throws, and `bun test` exits 1 printing the `[Fx]` lines,
with no test run [V]. Production bundles never use this rewrite: `Bun.build` resolves sockets through `onResolve`.

Zero-code alternative: `bun test --tsconfig-override=<a tsconfig that extends yours and adds
"paths": {"@acme/core-slots/*": [...shim dir...]}>`. It works, but Bun 1.4.2 prints a spurious
`Internal error: directory mismatch for directory "…tsconfig….json", fd 3 … indicates a bug` line on every run,
and it adds no validation (chain `stunt-double check &&`).

```jsonc
// tsconfig.json (compilerOptions) — types follow the shims, and `bun test` also resolves through it
"paths": { "@acme/core-slots/*": ["./sdk-slots/gen/*"] }
// and top-level: "files": ["src/stunt-double.check.ts"]
```

Use `bun install` with **`"workspace:*"`** (plus `"workspaces": ["sdk-slots"]`). `npx stunt-double init` writes this
when it detects Bun. Do not use `"file:./sdk-slots"` with Bun: Bun 1.4.2 *copies* the directory and also tries to
fetch the SDK's `@acme/core-slots` peer from the registry (404 → `bun install` exits 1); the adapter reports the copy
as `[F6] … (a copy …)`. With `workspace:*`, Bun's isolated linker symlinks `sdk-slots/` into the SDK's own
`node_modules/.bun/@acme+core@…/node_modules/@acme/core-slots` [V].

## What the plugin does

| Hook | Bun.build | Dev server |
|---|---|---|
| `setup` | STA (generate); forces `metafile: true`; warms the type gate | generate with poisoned shims; starts a watcher on `src/overrides` |
| `onStart` | regenerate; STA problems → throw; type gate → throw | Bun calls it once only; not used |
| `onResolve` `@acme/core-slots/<Slot>` | → `sdk-slots/gen/<Slot>.jsx` | same |
| `onEnd` | `[F6]` if the SDK/sockets stayed external; AUD on the metafile → delete the written outputs, throw | never called by Bun 1.4.2 |

Bun 1.4.2 [V]: a throw or rejected promise in `setup`, `onStart` or `onEnd` rejects the `Bun.build()` promise
**whether `throw` is `true` or `false`**; it never becomes `{ success: false }`. An unhandled rejection exits
`bun build.ts` with code 1. Bun has already written the outputs when `onEnd` runs, so the audit deletes them.

## Which mistake fails where

`bun build.ts` = the adapter (T1). `bare` = the `bun build` CLI without `stunt-double check &&` (T0 bare), then
running the bundle. Every cell was observed by `tests/bun.test.mjs`.

| # | Mistake | `bun build.ts` | dev server | `stunt-double check` / `bun test` + preload | `bun build` CLI, bare | `bun test`, no preload |
|---|---|---|---|---|---|---|
| F1a/b | props incompatible / ignored | exit 1 (type gate) | stderr only (not blocking) | exit 1 | **builds; renders** | **passes** |
| F1c | memo / forwardRef / class (must pass) | exit 0 | ok | exit 0 | ok | ok |
| F2a | typo `Buton.tsx` | exit 1 | error page (500) + overlay | exit 1 | loud: previous shim imports a missing file | loud |
| F2b | SDK upgrade renames a slot | exit 1 (RENAMED hint) | error page | exit 1 | loud: `Could not resolve "@acme/core-slots/Price"` | loud |
| F3 | required slot missing | exit 1 | error page | exit 1 | loud (RES) | loud |
| F4 | two claims | exit 1 | error page | exit 1 | **builds; renders the previous decision** | **passes** |
| F5 | wrong export | exit 1 (STA) | error page | exit 1 | **builds (exit 0); runtime `ReferenceError: Button is not defined`** | runtime `SyntaxError: export 'Button' not found` |
| F6a | SDK imports a default relatively | exit 1 | error page | exit 1 | **silent SDK default inside `Checkout`** | only the app's own render assertion notices |
| F6b | placeholder instead of the link | exit 1 | error page | exit 1 | loud `STUNT-DOUBLE-NOT-WIRED` | loud `STUNT-DOUBLE-NOT-WIRED` |
| F6f | `file:./sdk-slots` (a copy) | exit 1 | error page | exit 1 | renders a snapshot (stale on the next change) | same |
| F6g | app imports `@acme/core/original/X` | exit 1 | error page | exit 1 | **silent default at that call site** | only the app's own assertion notices |
| F6c | SDK left external (`packages: 'external'`, `external: ['@acme/*']`), target node or bun | exit 1 (`[F6] Bun.build leaves "@acme/core" external`, outputs removed) | — | n/a | builds; fails at boot (`STUNT-DOUBLE-NOT-WIRED` without a link) | n/a |
| — | only the sockets external (`external: ['@acme/core-slots/*']`) | ok: the plugin's `onResolve` wins over `external` | — | n/a | n/a | n/a |
| F6g | another plugin resolves the socket elsewhere | exit 1 (**audit only**) | — | n/a | n/a | n/a |
| F6h | stale shims | regenerated at every `Bun.build` | regenerated live | regenerated (the preload too) | loud (previous shim imports a deleted file) | loud |
| F7 | override renders its own slot | exit 1 | error page | exit 1 | **runtime: Node heap exhausted** | runtime `RangeError: Maximum call stack size exceeded` |
| F8 | duplicate React | exit 1 | error page | exit 1 | **runtime `Invalid hook call`** | runtime `dispatcher.useContext` null |
| F9b | client slot imports `server-only` | exit 1 | error page | exit 1 | runtime throw from `server-only` | runtime |
| F9c | async override in a client slot | exit 1 (type gate) | stderr only | exit 1 | runtime "A component suspended…" | runtime |

In the `check / bun test + preload` column both fail with the same `[Fx]` line (the preload runs the same
generator and gate). So: production builds go through `bun build.ts`, `bun test` gets the preload, and every
script that uses the `bun build` CLI (or `bun test` without the preload) must be `stunt-double check && …` (`stunt-double doctor` flags a `bun build` script without it). CI runs `stunt-double check`.

## Known gaps (Bun 1.4.2)

- The `bun build` CLI cannot load plugins: no STA, no type gate, no audit. F5 is not a bundler error there: the
  bundle references an undeclared binding and crashes at render (R1).
- Plain `bun run` / the Bun runtime has no plugin hook that sees the SDK's bare `@acme/core-slots/*` imports; it
  relies on the link or tsconfig `paths` (either alone is enough [V]; with neither, `Cannot find module` — loud).
  `bun test` gets the preload's scoped rewrite (above).
- Dev server: Bun runs `onStart` once and never `onEnd`, and does not call plugins back on file edits, so the plugin
  watches `src/overrides` itself. Type errors (F1, F9c) are printed to the dev server's stderr, never blocking. The
  error page is Bun's (HTTP 500 + overlay showing `Could not resolve "./STUNT-DOUBLE-ERROR -- [F3] …"`).
- `bun install` with a `bun.lock` keeps the **old** contents of a rebuilt `file:` tarball at the same path, with no
  integrity error [V]. Delete `bun.lock` when you rebuild local tarballs (the test suite always does).
- Bun's metafile marks *unused* re-exports of a `sideEffects: false` package as `external` (never resolved) and
  leaves `outputs[].imports` empty; the external guard therefore confirms each specifier in the emitted code.
- Audit messages name SDK files by their isolated-store realpath (`node_modules/.bun/@acme+core@…/…`).
