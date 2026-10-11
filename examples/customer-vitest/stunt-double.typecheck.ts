import { generate, runTypeGate } from 'stunt-double/core';

// Opt-in Vitest globalSetup: run the slot contract type gate before any test, so `vitest run` itself exits 1
// on [F1]/[F9] (Vitest never type-checks; the plugin only PRINTS contract errors in Vitest). ~0.2-0.3 s with
// TypeScript 7. Without it, CI must run `stunt-double check` (or `tsc`), as the "ci" script does.
export default async function stuntDoubleTypeGate() {
  const r = await runTypeGate(generate({ onError: 'throw' }));
  if (!r.ok) throw new Error(r.message);
}
