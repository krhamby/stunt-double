# @acme/core-slots (placeholder)

This is the **registry placeholder** for the slot ("socket") package of `@acme/core`. The SDK team publishes it
once, as a non-prerelease version (`0.0.1`), so that:

- nobody else can register the name (dependency confusion), and npm / pnpm / Bun auto-install the required peer
  `@acme/core-slots: "*"` of `@acme/core` from the registry: an app never adds it by hand;
- a tool or module graph that was never wired fails at **resolve time** with a message that says how to fix
  it, instead of quietly rendering the SDK defaults:

```
[UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project, ...'
```

Apps never resolve this package in a configured tool: the stunt-double adapter (`stuntDouble()` in
`vite.config.ts`) aliases `@acme/core-slots/<Slot>` to the app's generated shims in `.stunt-double/gen/`. Only the
optional universal tier (`npx stunt-double init --universal`) replaces it, with a link to the app's own
`sdk-slots/` package.
