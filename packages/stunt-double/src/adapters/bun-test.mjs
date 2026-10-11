// stunt-double/bun-test: `bun test` preload. bunfig.toml:
//
//   [test]
//   preload = ["stunt-double/bun-test"]
//
// The Bun runtime has no hook that sees the SDK's bare '@acme/core-slots/<Slot>' imports (a runtime Bun.plugin
// onResolve is never called for them [V 1.4.2]), so this preload is a SCOPED SPECIFIER REWRITE for the test
// runtime only: an onLoad on the SDK's (and brand layers') own files replaces the exact socket specifiers in
// import / export-from / literal dynamic-import strings with the absolute shim path. App code and every other
// package load untouched. Unknown slots are left alone (they hit the registry placeholder: loud).
//
// Before any test file loads it runs STA (generate, onError 'throw') and awaits the type gate: an injection
// error makes the preload throw, and `bun test` exits 1 with the [Fx] lines.
import fs from 'node:fs';
import path from 'node:path';
import { rewriteSockets } from './bun-rewrite.mjs';
import { generate, StuntDoubleError } from '../core/generate.mjs';
import { runTypeGate } from '../core/typegate.mjs';
import { formatWarnings } from '../core/diagnostics.mjs';
import { esc } from '../core/util.mjs';

const root = path.resolve(process.env.STUNT_DOUBLE_ROOT ?? process.cwd());
const p = generate({ root, onError: 'throw' });
if (p.warnings.length) console.warn(formatWarnings(p));
const gate = await runTypeGate(p);
if (!gate.ok) throw new StuntDoubleError(gate.message, gate.lines ?? []);

const dirs = [p.sdk.realDir, ...p.layers.map((l) => l.realDir)];
const filter = new RegExp(`^(?:${dirs.map(esc).join('|')})[\\\\/].*\\.(?:m?js|jsx)$`);
Bun.plugin({
  name: 'stunt-double:bun-test',
  setup(build) {
    build.onLoad({ filter }, (args) => {
      const src = fs.readFileSync(args.path, 'utf8');
      const contents = rewriteSockets(args.path, src, p.sdk.slotPackage, p.shimFile, p.slots) ?? src;
      return { contents, loader: /\.jsx$/.test(args.path) ? 'jsx' : 'js' };
    });
  },
});
