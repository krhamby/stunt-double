/**
 * `bun test` preload (bunfig.toml `[test] preload = ["stunt-double/bun-test"]`). Side-effect module: runs STA and
 * the type gate (throws on injection errors, so `bun test` exits 1) and registers a runtime plugin that points
 * the SDK's socket imports at the generated shims. It exports nothing.
 */
export {};
