# stunt-double with Bun 1.4

Verified with **Bun 1.4.2** (`@types/bun` 1.4.2), TypeScript 7.0.2, React 19.3.0, Node 22.22.0, on Linux x64.
Example: [`examples/customer-bun`](../../examples/customer-bun). Suite: [`tests/bun.test.mjs`](../../tests/bun.test.mjs).

## Setup

1. `bun add -d stunt-double`
2. One line in your `Bun.build()` script — the `bun build` CLI cannot load plugins, so production builds go through
   a script (`bun build.ts`):

   ```ts
   import { stuntDoubleBun } from 'stunt-double/bun';

   await Bun.build({ entrypoints: ['./index.html'], outdir: './dist', plugins: [stuntDoubleBun()] });
   ```

3. Your overrides in `src/overrides/<Slot>.tsx`.

The dev server and `bun test` do not read your build script, so each takes one line in `bunfig.toml`:

```toml
[serve.static]                       # `bun ./index.html` (Bun.serve HTML routes)
plugins = ["stunt-double/bun"]

[test]                               # `bun test`
preload = ["stunt-double/bun-test"]
```

No link, no tsconfig edit, no `.gitignore` edit, no config file, no postinstall. Generated files go to
`.stunt-double/`, which ignores itself. `stuntDoubleBun()` options: `typecheck` and `audit` (both default `true`),
plus any `stunt-double.config.json` key.

| Command | stunt-double code that runs | How the SDK's `@acme/core-slots/<Slot>` imports resolve |
|---|---|---|
| `bun build.ts` | `stuntDoubleBun()`: validation, type gate, post-bundle audit | plugin `onResolve` → `.stunt-double/gen/<Slot>.jsx` |
| `bun ./index.html` (dev) | the same plugin in dev mode: poisoned shims + its own watcher | plugin `onResolve` |
| `bun test` | the `stunt-double/bun-test` preload: validation + type gate | the preload's scoped rewrite (below) |
| `bun build` CLI, `bun run`, `bun test` without the preload | **none** | natively: the registry placeholder → loud `STUNT-DOUBLE-NOT-WIRED` |

### `bun test`: the `stunt-double/bun-test` preload

The Bun runtime has no hook that sees the SDK's bare `@acme/core-slots/<Slot>` imports: a runtime `Bun.plugin`
`onResolve` is never called for them [V]. Only `onLoad` fires, so the preload is a **scoped specifier rewrite for
the test runtime only**: in files inside the installed SDK (and brand layer) packages, the exact
`'@acme/core-slots/<Slot>'` strings of `import`, `export … from` and literal `import()` are replaced with the
absolute shim path (parsed with oxc; string literals only). App code and every other package load untouched; an
unknown slot is left alone and fails on the registry placeholder. Before any test file loads, the preload runs the
generator and awaits the type gate; an injection error throws, and `bun test` exits 1 printing the `[Fx]` lines,
with no test run [V]. Production bundles never use this rewrite.

Zero-code alternative: `bun test --tsconfig-override=<a tsconfig that extends yours and adds
"paths": {"@acme/core-slots/*": ["<shim dir>/*"]}>`. It works, but Bun 1.4.2 prints a spurious
`Internal error: directory mismatch for directory "…", fd 3 … indicates a bug` line on every run, and it adds no
validation (chain `stunt-double check &&`).

### Tools without the plugin: the universal tier

For the `bun build` CLI or plain `bun run`, run `npx stunt-double init --universal`: on Bun it adds
`"@acme/core-slots": "workspace:*"`, `"workspaces": ["sdk-slots"]` and a committed `sdk-slots/package.json` stub;
generated files then live in `sdk-slots/`. After `bun install`, Bun's isolated linker symlinks `sdk-slots/` into the
SDK's own `node_modules/.bun/@acme+core@…/node_modules/@acme/core-slots` [V]. Prefix those scripts with
`stunt-double check &&` (it also fills `sdk-slots/gen/`; right after `init` + `bun install` the directory is empty
and the CLI fails loudly with `Could not resolve "@acme/core-slots/Button"` [V]). `stunt-double doctor` flags a
`bun build` script without the prefix (and no longer misreads `bun build.ts` as the CLI).

Do not use `"file:./sdk-slots"` with Bun: Bun 1.4.2 resolves the SDK's `@acme/core-slots` peer from the registry,
never from the `file:` line, so the SDK still sees the placeholder (and the `file:` dependency itself is a copy, not
a link). Every stunt-double command reports it: `[F6] @acme/core resolves @acme/core-slots to … (the registry
placeholder …), not sdk-slots/. Use … Bun "workspace:*"` [V].

## What the plugin does

| Hook | Bun.build | Dev server |
|---|---|---|
| `setup` | STA (generate); forces `metafile: true`; warms the type gate | generate with poisoned shims; starts a watcher on `src/overrides` |
| `onStart` | regenerate; STA problems → throw; type gate → throw | Bun calls it once only; not used |
| `onResolve` `@acme/core-slots/<Slot>` | → the generated shim | same |
| `onEnd` | `[F6]` if the SDK stayed external; AUD on the metafile → delete the written outputs, throw | never called by Bun 1.4.2 |

Bun 1.4.2 [V]: a throw or rejected promise in `setup`, `onStart` or `onEnd` rejects the `Bun.build()` promise
**whether `throw` is `true` or `false`**; it never becomes `{ success: false }`. An unhandled rejection exits
`bun build.ts` with code 1. Bun has already written the outputs when `onEnd` runs, so a failed audit deletes them.
Metafile paths are relative to the working directory even when `root` is set; the plugin never uses `root`.

## Which mistake fails where

Columns: `bun build.ts`, the dev server, `stunt-double check` and `bun test` with the preload run on the three-step
project. The last two columns run **without any stunt-double code** on a universal-tier project (T0 without
`stunt-double check &&`): the `bun build` CLI plus a run of its bundle, and `bun test` without the preload. Every
cell was observed by `tests/bun.test.mjs`.

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
| F6b | a tool never wired (no link, no plugin) | — | — | — | loud `STUNT-DOUBLE-NOT-WIRED` | loud `STUNT-DOUBLE-NOT-WIRED` |
| F6c | SDK left external (`packages: 'external'`, `external: ['@acme/*']`), target node or bun | exit 1 (`[F6] Bun.build leaves "@acme/core" external`, outputs removed) | — | n/a | n/a | n/a |
| — | only the sockets external (`external: ['@acme/core-slots/*']`) | ok: the plugin's `onResolve` wins over `external` | — | n/a | n/a | n/a |
| F6f | universal tier wired with `file:./sdk-slots` | exit 1 | error page | exit 1 | loud `STUNT-DOUBLE-NOT-WIRED` | loud |
| F6g | app imports `@acme/core/original/X` | exit 1 | error page | exit 1 | **silent default at that call site** | only the app's own assertion notices |
| F6g | another plugin resolves the socket elsewhere | exit 1 (**audit only**) | — | n/a | n/a | n/a |
| F6h | stale shims | regenerated at every `Bun.build` | regenerated live | regenerated (the preload too) | loud (previous shim imports a deleted file) | loud |
| F7 | override renders its own slot | exit 1 | error page | exit 1 | **runtime: Node heap exhausted** | runtime `RangeError: Maximum call stack size exceeded` |
| F8 | duplicate React | exit 1 | error page | exit 1 | **runtime `Invalid hook call`** | runtime `dispatcher.useContext` null |
| F9b | client slot imports `server-only` | exit 1 | error page | exit 1 | runtime throw from `server-only` | runtime |
| F9c | async override in a client slot | exit 1 (type gate) | stderr only | exit 1 | runtime "A component suspended…" | runtime |

## Known gaps (Bun 1.4.2)

- The `bun build` CLI cannot load plugins: no STA, no type gate, no audit. F5 is not a bundler error there: the
  bundle references an undeclared binding and crashes at render (R1). Use `bun build.ts`.
- `bun test` needs the bunfig preload line, and the dev server its plugin line: Bun has no single config that the
  build script, the dev server and the test runner all read.
- Dev server: Bun runs `onStart` once and never `onEnd`, and does not call plugins back on file edits, so the plugin
  watches `src/overrides` itself. Type errors (F1, F9c) are printed to the dev server's stderr, never blocking. The
  error page is Bun's (HTTP 500 + overlay showing `Could not resolve "./STUNT-DOUBLE-ERROR -- [F3] …"`).
- `bun install` with a `bun.lock` keeps the **old** contents of a rebuilt `file:` tarball at the same path, with no
  integrity error [V]. Delete `bun.lock` when you rebuild local tarballs (the test suite always does).
- Bun's metafile marks *unused* re-exports of a `sideEffects: false` package as `external` (never resolved) and
  leaves `outputs[].imports` empty; the external guard therefore confirms each specifier in the emitted code.
- Audit messages name SDK files by their isolated-store realpath (`node_modules/.bun/@acme+core@…/…`).
