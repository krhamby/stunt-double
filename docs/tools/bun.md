# Bun 1.4 (bundler)

`stuntDoubleBun()` is a plugin for Bun's bundler, `Bun.build()`:

```ts
// scripts/build.ts  (run with: bun scripts/build.ts)
import { stuntDoubleBun } from 'stunt-double/bun';

const result = await Bun.build({ entrypoints: ['./src/main.tsx'], outdir: './dist', plugins: [stuntDoubleBun()] });
if (!result.success) process.exit(1);
```

| Hook | What happens |
|---|---|
| plugin setup | validates `src/overrides` and writes `.stunt-double/` |
| `onStart` (every build) | regenerates; validation errors, `[F6]` for `packages: "external"` or an `external` entry matching the SDK, and the contract type check throw the report: `Bun.build()` fails (exit 1) and nothing is written |
| `onResolve` | `@acme/core-slots/<Slot>` → `.stunt-double/gen/<Slot>.jsx` |
| `onEnd` | the post-bundle graph audit of the metafile (the plugin turns `metafile` on) |

Bun's bundler reports a missing export only at runtime, so stunt-double's static export check (F5) is what catches it at build time.

**Not covered by the plugin:** Bun's runtime and dev server. Runtime plugins never see bare specifiers, so a plugin cannot redirect the SDK's slot imports there. Use the universal tier (`npx stunt-double init --universal`, a `"workspace:*"` link with `"workspaces": ["sdk-slots"]`) and run `stunt-double check &&` first.

**Verified with** bun 1.4.2, TypeScript 7.0.2 and 5.9.3: `tests/bun.test.mjs` runs the shared catalogue and the universal tier against `examples/customer-bun` (installed with npm, built with Bun).
