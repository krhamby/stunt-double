# customer-yarn-pnp

[customer-vite](../customer-vite), installed with Yarn 4 in Plug'n'Play mode: no `node_modules`, packages read
from zip archives, strict dependency boundaries. The stunt-double setup is the same one line in `vite.config.ts`,
plus one PnP-specific choice: **TypeScript 5.9 as the project's `typescript`**. TypeScript 7.0 cannot resolve
modules under PnP (the gate refuses it with `[TS-PNP]`), and Yarn's built-in PnP patch applies only to the package
named `typescript`: an npm alias such as `typescript5` stays unpatched and cannot resolve under PnP either.

```bash
npm run setup                      # at the repository root: builds .packs/
corepack yarn install              # Yarn 4 from "packageManager"
corepack yarn vite build && corepack yarn vite build --ssr src/entry-server.tsx --outDir dist-ssr
corepack yarn node probes/render.mjs
corepack yarn vitest run
```

Vite 8 itself warns that PnP is discouraged and that PnP-specific Vite bugs are no longer actively worked on.
